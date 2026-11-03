// The chat channel's confirmation store: `tool_confirmations` through the service client, every
// query by `session_id` and `user_id` (invariant 6). The engine issues, consumes and settles
// through the port; `prepareChat` checks a confirm and settles a decline before the stream.
// The table is typed by hand until `/db-types` runs with the migration applied (`REL-11`).
import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  AuthContext,
  ConfirmationStore,
  ConsumeMatch,
  ConsumeResult,
  PendingConfirmation,
} from '@va/core'
import { log } from '@va/core'

type Outcome = 'pending' | 'executed' | 'failed' | 'declined' | 'expired'

type ConfirmationRow = {
  id: string
  session_id: string
  user_id: string
  tool: string
  input_hash: string
  summary: string
  outcome: Outcome
  error_code: string | null
  created_at: string
  expires_at: string
  confirmed_at: string | null
  settled_at: string | null
}

type ConfirmationsDatabase = {
  public: {
    Tables: {
      tool_confirmations: {
        Row: ConfirmationRow
        Insert: Pick<
          ConfirmationRow,
          'session_id' | 'user_id' | 'tool' | 'input_hash' | 'summary' | 'expires_at'
        > &
          Partial<ConfirmationRow>
        Update: Partial<ConfirmationRow>
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

function table(ctx: AuthContext) {
  return (ctx.serviceClient as unknown as SupabaseClient<ConfirmationsDatabase>).from('tool_confirmations')
}

export function dbConfirmationStore(
  ctx: AuthContext,
  sessionId: string,
  clock: () => Date,
): ConfirmationStore {
  const ids = { user_id: ctx.userId, session_id: sessionId }
  return {
    async issue(c: PendingConfirmation) {
      const { data, error } = await table(ctx)
        .insert({
          session_id: sessionId,
          user_id: ctx.userId,
          tool: c.tool,
          input_hash: c.inputHash,
          summary: c.summary,
          expires_at: c.expiresAt,
        })
        .select('id')
        .single()
      if (error || !data) {
        log('error', '[api]', 'confirmation insert failed', { ...ids, code: error?.code ?? null })
        return { id: null, ...(error ? { code: error.code } : {}) }
      }
      return { id: data.id }
    },

    async consume(id: string, match: ConsumeMatch): Promise<ConsumeResult> {
      const now = clock().toISOString()
      // The conditional update is the single-use guarantee: `confirmed_at` is set by the first
      // consume and required null by every later one, so a second request, a doubled tool_use
      // or a replay after a lost settle never runs the handler again (the pgTAP test runs this
      // exact statement twice).
      const { data, error } = await table(ctx)
        .update({ confirmed_at: now })
        .eq('id', id)
        .eq('session_id', match.sessionId)
        .eq('user_id', match.userId)
        .eq('tool', match.tool)
        .eq('input_hash', match.inputHash)
        .eq('outcome', 'pending')
        .is('confirmed_at', null)
        .gt('expires_at', now)
        .select('id')
      if (error) {
        log('error', '[api]', 'confirmation consume failed', { ...ids, code: error.code })
        return 'not_found'
      }
      if (data.length === 1) return 'ok'
      // Zero rows: say why, from the row as it is.
      const { data: row } = await table(ctx)
        .select('outcome, confirmed_at, tool, input_hash, expires_at')
        .eq('id', id)
        .eq('session_id', match.sessionId)
        .eq('user_id', match.userId)
        .maybeSingle()
      if (!row) return 'not_found'
      // Consumed by an earlier request (settled or not yet): used, never twice.
      if (row.confirmed_at !== null || row.outcome !== 'pending') return 'used'
      if (row.expires_at <= now) {
        await table(ctx)
          .update({ outcome: 'expired', settled_at: now })
          .eq('id', id)
          .eq('user_id', ctx.userId)
        return 'expired'
      }
      return 'mismatch'
    },

    async settle(id: string, outcome: 'executed' | 'failed', errorCode?: string) {
      const { error } = await table(ctx)
        .update({ outcome, error_code: errorCode ?? null, settled_at: clock().toISOString() })
        .eq('id', id)
        .eq('session_id', sessionId)
        .eq('user_id', ctx.userId)
      if (error) log('error', '[api]', 'confirmation settle failed', { ...ids, code: error.code })
    },
  }
}

/** Before the stream: is this a pending, unexpired confirmation of this session and user? */
export async function findPendingConfirmation(
  ctx: AuthContext,
  sessionId: string,
  id: string,
  now: Date,
  signal: AbortSignal,
): Promise<'ok' | 'invalid' | 'error'> {
  const { data, error } = await table(ctx)
    .select('id')
    .eq('id', id)
    .eq('session_id', sessionId)
    .eq('user_id', ctx.userId)
    .eq('outcome', 'pending')
    .is('confirmed_at', null)
    .gt('expires_at', now.toISOString())
    .abortSignal(signal)
    .maybeSingle()
  if (error) {
    log('error', '[api]', 'confirmation lookup failed', {
      user_id: ctx.userId,
      session_id: sessionId,
      code: error.code,
    })
    return 'error'
  }
  return data ? 'ok' : 'invalid'
}

/** The user said no: the pending row is settled as declined, once. */
export async function declineConfirmation(
  ctx: AuthContext,
  sessionId: string,
  id: string,
  now: Date,
  signal: AbortSignal,
): Promise<'ok' | 'invalid' | 'error'> {
  const { data, error } = await table(ctx)
    .update({ outcome: 'declined', settled_at: now.toISOString() })
    .eq('id', id)
    .eq('session_id', sessionId)
    .eq('user_id', ctx.userId)
    .eq('outcome', 'pending')
    .is('confirmed_at', null)
    .select('id')
    .abortSignal(signal)
  if (error) {
    log('error', '[api]', 'confirmation decline failed', {
      user_id: ctx.userId,
      session_id: sessionId,
      code: error.code,
    })
    return 'error'
  }
  return data.length === 1 ? 'ok' : 'invalid'
}
