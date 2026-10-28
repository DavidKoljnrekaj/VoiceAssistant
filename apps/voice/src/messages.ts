// The call's chat context (LiveKit keeps it in the worker's memory) turned into the messages the
// engine takes. Ported from Landmark's `voice-llm/messages.ts`. The context is caller-influenced
// input (speech-to-text output is an injection surface), so it is bounded and cleaned here:
//
//   - every system item is dropped: the system prompt is built by @va/core and cannot be
//     negotiated;
//   - only user and assistant text is kept (the call context never sees the engine's tool calls),
//     consecutive items of one role are merged;
//   - at most MAX_MESSAGES are kept, cut so the first is a user turn (the API requires it; it
//     also drops the greeting);
//   - the last message must be the user's, or there is nothing to answer.
import type { InMemoryMessage } from '@va/core'

export const MAX_MESSAGES = 20

/** What this module reads of a LiveKit `ChatItem`: `ChatMessage` has `type: 'message'`, a role
 * and `textContent`; function calls and handoffs have other types and are skipped. */
export interface ChatItemLike {
  type: string
  role?: string
  textContent?: string | undefined
}

/** Anthropic messages for the loop, or null when there is no user turn to answer. */
export function toAnthropicMessages(items: readonly ChatItemLike[]): InMemoryMessage[] | null {
  const merged: Array<{ role: 'user' | 'assistant'; text: string }> = []
  for (const item of items) {
    if (item.type !== 'message') continue
    if (item.role !== 'user' && item.role !== 'assistant') continue
    const text = (item.textContent ?? '').trim()
    if (!text) continue
    const last = merged[merged.length - 1]
    if (last && last.role === item.role) last.text += `\n${text}`
    else merged.push({ role: item.role, text })
  }
  let kept = merged.slice(-MAX_MESSAGES)
  const firstUser = kept.findIndex((m) => m.role === 'user')
  if (firstUser === -1) return null
  kept = kept.slice(firstUser)
  if (kept[kept.length - 1]!.role !== 'user') return null
  return kept.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.text }] }))
}

/** The text of the user turn the engine answers: the last message's single text block. */
export function userTextOf(messages: InMemoryMessage[]): string {
  const last = messages[messages.length - 1]!
  return (last.content[0] as unknown as { text: string }).text
}
