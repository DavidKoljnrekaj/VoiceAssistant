// The Microsoft token store: `user_integrations` through the service client, every query by
// `user_id` and `provider` (invariant 6). `tokenFor` hands a tool the user's current access
// token, refreshing it when less than five minutes are left; a refresh Microsoft refuses marks
// the row `reauth_required` and every later call says so until the user reconnects. Tokens are
// sealed before they are written and opened only here; none is ever logged.
import { errorReason, log } from '@va/core'
import type { DbClient } from '@va/db'

import { open, seal, tokenAad, type IntegrationsKeys } from '../crypto.js'
import { integrations } from '../db.js'
import { IntegrationError } from '../errors.js'
import { MicrosoftOAuthError, type MicrosoftOAuth, type TokenSet } from './oauth.js'

const PROVIDER = 'microsoft'
const TAG = '[integrations]'
/** An access token with less than this left is refreshed before use. */
export const REFRESH_MARGIN_MS = 5 * 60_000
/** The ceiling of one PostgREST call, so a stalled database never wedges the shared refresh. */
const DB_TIMEOUT_MS = 10_000

export interface TokenForOptions {
  signal?: AbortSignal
  /** Refresh even when the stored token looks valid (Graph answered 401 with it). */
  forceRefresh?: boolean
}

export interface TokenStore {
  /**
   * The user's current Microsoft access token. Throws `IntegrationError`: `not_connected` (no
   * row, or disconnected), `reauth_required` (Microsoft refused the refresh), `refresh_failed`
   * (Microsoft unavailable; try later), `misconfigured` (Microsoft refused our client: the
   * secret expired), `token_unreadable` (a key is missing), `store_failed`. A caller's abort
   * rejects with the abort.
   */
  tokenFor(service: DbClient, userId: string, options?: TokenForOptions): Promise<string>
  /** The callback's write: one row per user, sealed, `active`. */
  saveConnection(
    service: DbClient,
    userId: string,
    connection: { account: string; tokens: TokenSet },
    signal?: AbortSignal,
  ): Promise<void>
  /** Revokes the row and deletes both tokens. Idempotent. */
  disconnect(service: DbClient, userId: string, signal?: AbortSignal): Promise<void>
}

export interface TokenStoreConfig {
  keys: IntegrationsKeys
  oauth: MicrosoftOAuth
  clock?: () => Date
}

export function createTokenStore(config: TokenStoreConfig): TokenStore {
  const { keys, oauth } = config
  const clock = config.clock ?? (() => new Date())
  // One refresh per user at a time: concurrent tool calls of one turn share it.
  const inflight = new Map<string, Promise<string>>()
  const aad = (userId: string, column: 'refresh_token_enc' | 'access_token_enc') =>
    tokenAad(userId, PROVIDER, column)

  function unseal(userId: string, column: 'refresh_token_enc' | 'access_token_enc', value: string): string {
    try {
      return open(keys, value, aad(userId, column))
    } catch (e) {
      log('error', TAG, 'token unreadable', {
        user_id: userId,
        provider: PROVIDER,
        column,
        reason: errorReason(e),
      })
      throw new IntegrationError('token_unreadable')
    }
  }

  /** The row as it is now, for a decision: throws for anything that is not an active connection. */
  async function readRow(service: DbClient, userId: string, signal?: AbortSignal) {
    const { data: row, error } = await integrations(service)
      .select('status, refresh_token_enc, access_token_enc, access_expires_at')
      .eq('user_id', userId)
      .eq('provider', PROVIDER)
      .abortSignal(dbSignal(signal))
      .maybeSingle()
    rethrowIfAborted(signal)
    if (error) {
      log('error', TAG, 'token lookup failed', { user_id: userId, provider: PROVIDER, code: error.code })
      throw new IntegrationError('store_failed')
    }
    if (!row || row.status === 'revoked' || !row.refresh_token_enc)
      throw new IntegrationError('not_connected')
    if (row.status === 'reauth_required') throw new IntegrationError('reauth_required')
    return { ...row, refresh_token_enc: row.refresh_token_enc }
  }

  function fresh(row: { access_token_enc: string | null; access_expires_at: string | null }): row is {
    access_token_enc: string
    access_expires_at: string
  } {
    const expiresAt = row.access_expires_at ? Date.parse(row.access_expires_at) : 0
    return row.access_token_enc !== null && expiresAt - clock().getTime() >= REFRESH_MARGIN_MS
  }

  /**
   * The row changed while our refresh was in flight (another process refreshed, the user
   * disconnected or reconnected): hand out what is stored now, never what our stale grant got.
   */
  async function storedAfterRace(service: DbClient, userId: string): Promise<string> {
    const row = await readRow(service, userId)
    if (fresh(row)) return unseal(userId, 'access_token_enc', row.access_token_enc)
    throw new IntegrationError('refresh_failed')
  }

  async function refresh(service: DbClient, userId: string, sealedRefresh: string) {
    const started = clock().getTime()
    let tokens: TokenSet
    try {
      tokens = await oauth.refresh(unseal(userId, 'refresh_token_enc', sealedRefresh))
    } catch (e) {
      if (!(e instanceof MicrosoftOAuthError)) throw e
      if (e.kind === 'invalid_grant') {
        // Compare-and-set on the refresh token that was refused: a reconnect in the meantime
        // wrote another one, and that connection is not marked for something it did not do.
        const { data, error } = await integrations(service)
          .update({
            status: 'reauth_required',
            last_error_code: e.code,
            access_token_enc: null,
            access_expires_at: null,
          })
          .eq('user_id', userId)
          .eq('provider', PROVIDER)
          .eq('status', 'active')
          .eq('refresh_token_enc', sealedRefresh)
          .select('id')
          .abortSignal(dbSignal())
        log('warn', TAG, 'refresh refused, reauth required', {
          user_id: userId,
          provider: PROVIDER,
          code: e.code,
          db_code: error?.code ?? null,
        })
        if (!error && data.length === 0) return await storedAfterRace(service, userId)
        throw new IntegrationError('reauth_required')
      }
      if (e.kind === 'invalid_client') {
        // The client secret expired or was replaced: every user is affected, the operator acts.
        log('error', TAG, 'microsoft refused the client', {
          user_id: userId,
          provider: PROVIDER,
          code: e.code,
        })
        throw new IntegrationError('misconfigured')
      }
      log('warn', TAG, 'refresh failed', { user_id: userId, provider: PROVIDER, kind: e.kind, code: e.code })
      throw new IntegrationError('refresh_failed')
    }
    const { data, error } = await integrations(service)
      .update({
        access_token_enc: seal(keys, tokens.accessToken, aad(userId, 'access_token_enc')),
        access_expires_at: tokens.expiresAt.toISOString(),
        // Microsoft rotates the refresh token on most refreshes; when it does not, the old stays.
        ...(tokens.refreshToken
          ? { refresh_token_enc: seal(keys, tokens.refreshToken, aad(userId, 'refresh_token_enc')) }
          : {}),
        last_error_code: null,
      })
      .eq('user_id', userId)
      .eq('provider', PROVIDER)
      .eq('status', 'active')
      .eq('refresh_token_enc', sealedRefresh)
      .select('id')
      .abortSignal(dbSignal())
    if (error) {
      log('error', TAG, 'refresh not stored', { user_id: userId, provider: PROVIDER, code: error.code })
      throw new IntegrationError('store_failed')
    }
    // Disconnected, reconnected or refreshed elsewhere while ours was in flight.
    if (data.length === 0) return await storedAfterRace(service, userId)
    log('info', TAG, 'token refreshed', {
      user_id: userId,
      provider: PROVIDER,
      ms: clock().getTime() - started,
    })
    return tokens.accessToken
  }

  return {
    async tokenFor(service, userId, options = {}) {
      const row = await readRow(service, userId, options.signal)
      if (!options.forceRefresh && fresh(row)) return unseal(userId, 'access_token_enc', row.access_token_enc)

      // The refresh is shared and runs to completion on its own timeouts, so a rotated refresh
      // token is always stored; a caller that aborts only stops waiting for it.
      let run = inflight.get(userId)
      if (!run) {
        run = refresh(service, userId, row.refresh_token_enc).finally(() => inflight.delete(userId))
        inflight.set(userId, run)
      }
      return await untilAborted(run, options.signal)
    },

    async saveConnection(service, userId, { account, tokens }, signal) {
      if (!tokens.refreshToken) throw new IntegrationError('store_failed')
      const { error } = await integrations(service)
        .upsert(
          {
            user_id: userId,
            provider: PROVIDER,
            account,
            scopes: tokens.scopes,
            refresh_token_enc: seal(keys, tokens.refreshToken, aad(userId, 'refresh_token_enc')),
            access_token_enc: seal(keys, tokens.accessToken, aad(userId, 'access_token_enc')),
            access_expires_at: tokens.expiresAt.toISOString(),
            status: 'active',
            last_error_code: null,
            connected_at: clock().toISOString(),
          },
          { onConflict: 'user_id,provider' },
        )
        .abortSignal(dbSignal(signal))
      rethrowIfAborted(signal)
      if (error) {
        log('error', TAG, 'connection not stored', { user_id: userId, provider: PROVIDER, code: error.code })
        throw new IntegrationError('store_failed')
      }
      log('info', TAG, 'connected', { user_id: userId, provider: PROVIDER })
    },

    disconnect: disconnectMicrosoft,
  }
}

/**
 * Revokes the user's Microsoft connection and deletes our copy of both tokens. Idempotent. It
 * needs no key and no client secret, so it works even when the MS_ variables are gone. Microsoft
 * keeps its sessions until the user or the admin revokes the app (My Apps).
 */
export async function disconnectMicrosoft(
  service: DbClient,
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  const { error } = await integrations(service)
    .update({ status: 'revoked', refresh_token_enc: null, access_token_enc: null, access_expires_at: null })
    .eq('user_id', userId)
    .eq('provider', PROVIDER)
    .abortSignal(dbSignal(signal))
  rethrowIfAborted(signal)
  if (error) {
    log('error', TAG, 'disconnect failed', { user_id: userId, provider: PROVIDER, code: error.code })
    throw new IntegrationError('store_failed')
  }
  log('info', TAG, 'disconnected', { user_id: userId, provider: PROVIDER })
}

/** Every PostgREST call here ends: the caller's signal if any, and our own ceiling regardless. */
function dbSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(DB_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/** postgrest-js turns an abort into an `{ error }`; the caller's abort is an abort, not a store failure. */
function rethrowIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

function untilAborted<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
