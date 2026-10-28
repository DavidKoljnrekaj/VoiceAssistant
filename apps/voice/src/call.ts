// The caller's identity for one call. The opaque call token from the job metadata resolves,
// through `voice_calls`, to the JWT the API stored for this room; the identity is then built by
// the same `authenticateToken` as chat. It may be cached for at most a minute per call
// (invariant 7); after that the row is read again, which picks up a rotated JWT (refresh) and a
// changed role. The token itself is never logged, only ids.
import { createHash } from 'node:crypto'

import type { DbClient } from '@va/db'

import { authenticateToken, type AuthContext, log } from '@va/core'

import { IDENTITY_CACHE_MAX_MS } from './env.js'

const TAG = '[voice]'
/** A row idle for this long counts as absent (the sweep deletes it; the lookup refuses it first). */
export const IDLE_MS = 3 * 60_000

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export interface CallIdentityOptions {
  /** Identity re-read interval; capped at `IDENTITY_CACHE_MAX_MS`. */
  cacheMs?: number
  /** The clock, for tests. */
  now?: () => number
}

interface CallRow {
  id: string
  session_id: string
  user_id: string
  access_token: string
}

export class CallIdentity {
  private cached: { ctx: AuthContext; at: number } | null = null
  private ended = false
  private readonly cacheMs: number
  private readonly now: () => number
  readonly sessionId: string
  readonly userId: string
  readonly callId: string

  private constructor(
    private readonly service: DbClient,
    private readonly room: string,
    private row: CallRow,
    options: CallIdentityOptions,
  ) {
    this.cacheMs = Math.min(options.cacheMs ?? IDENTITY_CACHE_MAX_MS, IDENTITY_CACHE_MAX_MS)
    this.now = options.now ?? Date.now
    this.callId = row.id
    this.sessionId = row.session_id
    this.userId = row.user_id
  }

  /**
   * The live call this token belongs to, in this room: null for an unknown token, another room,
   * an expired row or one idle for three minutes. A failed lookup throws.
   */
  static async resolve(
    service: DbClient,
    callToken: string,
    room: string,
    options: CallIdentityOptions = {},
  ): Promise<CallIdentity | null> {
    const now = options.now ?? Date.now
    const row = await liveRow(
      service,
      { call_token_hash: sha256Hex(callToken), platform_call_id: room },
      now(),
    )
    if (!row) {
      log('warn', TAG, 'call token refused', { room })
      return null
    }
    return new CallIdentity(service, room, row, options)
  }

  /** The caller's identity, re-read from the stored JWT at most once per cache interval. Throws
   * `unauthorized` / `no_profile` / `internal_error` (the auth codes) and `call_ended` when the
   * row is gone. */
  async ctx(): Promise<AuthContext> {
    if (this.ended) throw new Error('call_ended')
    const at = this.now()
    if (this.cached && at - this.cached.at < this.cacheMs) return this.cached.ctx
    if (this.cached) {
      // The row again: a refresh rotates the JWT, the end deletes the row.
      const row = await liveRow(this.service, { id: this.callId, user_id: this.userId }, at)
      if (!row) throw new Error('call_ended')
      this.row = row
    }
    const result = await authenticateToken(this.row.access_token)
    if ('error' in result) throw new Error(result.error.code)
    if (result.userId !== this.row.user_id) {
      log('error', TAG, 'call user mismatch', { session_id: this.sessionId, room: this.room })
      throw new Error('unauthorized')
    }
    this.cached = { ctx: result, at }
    return result
  }

  /** Bumps `last_seen_at`, off the critical path. (A supabase-js query runs only once it is
   * then-ed.) */
  touch(): void {
    this.service
      .from('voice_calls')
      .update({ last_seen_at: new Date(this.now()).toISOString() })
      .eq('id', this.callId)
      .eq('user_id', this.userId)
      .then(({ error }) => {
        if (error)
          log('error', TAG, 'last_seen_at bump failed', { session_id: this.sessionId, code: error.code })
      })
  }

  /** Deletes the credential. Idempotent: a row already gone is a success. */
  async end(): Promise<void> {
    const { error } = await this.service
      .from('voice_calls')
      .delete()
      .eq('id', this.callId)
      .eq('user_id', this.userId)
    if (error) throw new Error(`voice_calls delete failed: ${error.code}`)
    this.ended = true
    this.cached = null
  }
}

async function liveRow(
  service: DbClient,
  filter: { call_token_hash: string; platform_call_id: string } | { id: string; user_id: string },
  nowMs: number,
): Promise<CallRow | null> {
  let query = service.from('voice_calls').select('id, session_id, user_id, access_token')
  for (const [column, value] of Object.entries(filter)) query = query.eq(column, value)
  const { data, error } = await query
    .gt('expires_at', new Date(nowMs).toISOString())
    .gt('last_seen_at', new Date(nowMs - IDLE_MS).toISOString())
    .maybeSingle()
  if (error) throw new Error(`voice_calls lookup failed: ${error.code}`)
  return data
}
