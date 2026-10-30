// The chat's services: the SSE client for `POST /chat`, the session list and history reads through
// supabase-js (RLS), and the two mutations through the API. Services throw; nothing returns an
// empty list in place of an error (invariant 10).
import { apiFetch, apiJson } from '../../../lib/api'
import { supabase } from '../../../lib/supabase'
import { type ChatEvent, isChatEvent } from '../../../types/api'
import type { MessageRow, SessionRow } from '../../../types/database'
import { readSseBody } from '../lib/sse'

export type SessionSummary = Pick<SessionRow, 'id' | 'title' | 'channel' | 'created_at' | 'updated_at'>

/**
 * PostgREST answers at most `max_rows` (1000, `supabase/config.toml`) per request, so both reads
 * page with `range()` until a short page, in an order made stable by the id (WEB-6). Without this
 * a long conversation lost its newest rows and the leaf went stale.
 */
const PAGE_SIZE = 1000

/** Reads every page of a query; `page(from, to)` runs one request for that range. */
async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
}

/** The user's chat sessions, newest activity first. Voice calls are sessions too and are left out. */
export async function listSessions(): Promise<SessionSummary[]> {
  return readAllPages((from, to) =>
    supabase
      .from('ai_sessions')
      .select('id, title, channel, created_at, updated_at')
      .eq('channel', 'chat')
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  )
}

/** Every row of a session, oldest first; the branch is derived by `normalizeFromPersistedRows`. */
export async function loadSession(sessionId: string): Promise<MessageRow[]> {
  return readAllPages((from, to) =>
    supabase
      .from('ai_messages')
      .select('id, session_id, role, turn_kind, content, parent_id, created_at, stop_reason')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  await apiJson<{ ok: true }>(`/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export async function deleteSession(sessionId: string): Promise<void> {
  await apiJson<{ ok: true }>(`/sessions/${sessionId}`, { method: 'DELETE' })
}

export interface StreamMessageArgs {
  sessionId: string | null
  message: string
  parentMessageId: string | null
  /** `location.pathname` at send time; the API prepends it in memory, never in the row. */
  route: string | null
  signal: AbortSignal
  onEvent: (event: ChatEvent) => void
}

/**
 * One streamed turn. A non-OK status throws ApiHttpError before any event; after that every
 * frame reaches `onEvent` until `done` or `error` closes the stream. Aborting the signal is the
 * cancel: the server reads the closed connection (docs/API.md → Cancellation).
 */
export async function streamMessage(args: StreamMessageArgs): Promise<void> {
  const response = await apiFetch('/chat', {
    method: 'POST',
    body: JSON.stringify({
      session_id: args.sessionId,
      message: args.message,
      ...(args.parentMessageId ? { parent_message_id: args.parentMessageId } : {}),
      ...(args.route ? { client_context: { route: args.route } } : {}),
    }),
    signal: args.signal,
  })
  if (!response.body) throw new Error('empty stream body')
  await readSseBody(response.body, (payload) => {
    if (isChatEvent(payload)) args.onEvent(payload)
  })
}
