// The messages the engine takes for a voice turn. LiveKit's chat context supplies only the new
// user turn (what Soniox heard); the history is the call's own rows, kept in worker memory by
// `CallSession` as the loop wrote them (user text, assistant blocks including `tool_use`, the
// `tool_result` rows). Landmark fed the model LiveKit's text-only context instead, and the model,
// seeing numbers in its earlier answer with no lookup behind them, retracted the answer on the
// next question (VOICE-5). The context is caller-influenced input (speech-to-text output is an
// injection surface), so it is read narrowly: the trailing user items only, no system items.
import { assembleHistory, type HistoryRow, type InMemoryMessage, type MessageRow } from '@va/core'

/** Messages (rows) of the call the model sees at most. */
export const MAX_MESSAGES = 20
/** Rough token ceiling for the call's history (chars / 4); the voice prompt keeps answers short. */
export const HISTORY_CEILING_TOKENS = 20_000

/** What this module reads of a LiveKit `ChatItem`: `ChatMessage` has `type: 'message'`, a role
 * and `textContent`; function calls and handoffs have other types and are skipped. */
export interface ChatItemLike {
  type: string
  role?: string
  textContent?: string | undefined
}

/**
 * The user turn to answer: the trailing user messages of the context, merged. Null when the
 * context does not end on a user message with text (nothing to answer).
 */
export function userTurnOf(items: readonly ChatItemLike[]): string | null {
  const texts: string[] = []
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.type !== 'message') continue
    if (item.role !== 'user') break
    const text = (item.textContent ?? '').trim()
    if (text) texts.unshift(text)
  }
  return texts.length > 0 ? texts.join('\n') : null
}

export type CallRow = MessageRow & { id: string }

/**
 * The call's history for the model: at most `MAX_MESSAGES` rows, cut on a turn boundary (a
 * `turn_kind: 'user'` row first; the newest turn is always whole, even when it alone is longer),
 * assembled by the engine (unanswered `tool_use` repaired, empty rows dropped, oldest turns
 * dropped above the ceiling).
 */
export function callHistory(rows: readonly CallRow[], maxMessages = MAX_MESSAGES): InMemoryMessage[] {
  let start = rows.length
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.turn_kind !== 'user') continue
    if (start < rows.length && rows.length - i > maxMessages) break
    start = i
  }
  const kept: HistoryRow[] = rows.slice(start).map((r) => ({
    id: r.id,
    role: r.role,
    turn_kind: r.turn_kind,
    content: r.content,
  }))
  return assembleHistory(kept, { hardCeilingTokens: HISTORY_CEILING_TOKENS })
}
