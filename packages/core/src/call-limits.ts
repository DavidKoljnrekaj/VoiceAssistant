// The call budget of the spoken channels, counted from the rows that already exist: 20 calls per
// user per day across voice and phone (`ai_sessions` in either channel), and 3 live calls
// globally (`voice_calls` rows neither expired nor idle, the worker's own definition of a live
// row, the caller's own row left out: a start replaces it). Shared by the API (`POST
// /voice/sessions`) and the voice worker (a phone call starts in the worker, Part 11). A failing
// count fails OPEN and logs loudly: a flaky query must not lock users out. Known race: N
// concurrent starts can all pass (docs/backlog/api.md API-1).
import { type DbClient, VOICE_CALL_IDLE_MS } from '@va/db'

import { log } from './log.js'

export const CALLS_PER_DAY = 20
export const CONCURRENT_CALLS = 3
const DAY_MS = 24 * 60 * 60_000

/** The channels a call is counted in. */
export const SPOKEN_CHANNELS = ['voice', 'phone'] as const

export type CallLimitVerdict =
  { ok: true } | { ok: false; reason: 'calls_per_day' | 'concurrent_calls'; count: number; limit: number }

export async function checkCallLimits(
  service: DbClient,
  userId: string,
  now: Date,
  requestId: string,
  tag: string,
): Promise<CallLimitVerdict> {
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString()
  const [calls, live] = await Promise.all([
    service
      .from('ai_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('channel', [...SPOKEN_CHANNELS])
      .gte('created_at', dayAgo),
    service
      .from('voice_calls')
      .select('id', { count: 'exact', head: true })
      // The caller's own live call is the one this start replaces, so it does not count; left
      // out here rather than deleted first, so a refused start writes nothing (API-8, V-4).
      .neq('user_id', userId)
      .gt('expires_at', now.toISOString())
      // The idle window, shared with the sweep (`@va/db`): a quiet row counts as absent.
      .gt('last_seen_at', new Date(now.getTime() - VOICE_CALL_IDLE_MS).toISOString()),
  ])
  if (calls.error || live.error) {
    log('error', tag, 'voice rate limit count failed; allowing request', {
      request_id: requestId,
      user_id: userId,
      code: calls.error?.code ?? live.error?.code ?? null,
    })
    return { ok: true }
  }
  if ((calls.count ?? 0) >= CALLS_PER_DAY) {
    return { ok: false, reason: 'calls_per_day', count: calls.count ?? 0, limit: CALLS_PER_DAY }
  }
  if ((live.count ?? 0) >= CONCURRENT_CALLS) {
    return { ok: false, reason: 'concurrent_calls', count: live.count ?? 0, limit: CONCURRENT_CALLS }
  }
  return { ok: true }
}
