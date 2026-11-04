// The worker's composition of the engine's registry: the packs it serves and what a caller may
// reach by voice. Default-deny per channel: only the tools named here are advertised and
// dispatchable on voice, every one read-only (asserted at load), and no other channel is named
// (an absent channel gets nothing). A tool joins this list in a reviewed diff whose commit says
// why its output is safe to read aloud: no ids spoken, at most five items, plain numbers.
import { type ChannelAllowlist, ToolRegistry } from '@va/core'
import type { TokenStore } from '@va/integrations'
import { demoPack } from '@va/tools-demo'
import { createMailPack, MAIL_READ_TOOLS } from '@va/tools-mail'

import { mailTokenProvider } from './mail.js'

// search_items: at most five names with category and price, no ids; get_item: one item's
// name, category, price and a clipped description, no id (both shape their output for voice).
// The four mail reads (Part 13b), each read-only and shaped for the ear on voice and phone:
// list_mail and search_mail at most five messages with the sender's name (never an address),
// the subject, the time and a 120-character preview; read_mail the new text clipped to 600
// characters with names only; list_calendar at most five live events, times only. They carry
// short refs (m1 …) for chaining, which the pack's prompt rules say are never spoken.
const SPOKEN_TOOLS = ['search_items', 'get_item', ...MAIL_READ_TOOLS] as const

/** One list for the two spoken channels: the phone (Part 11) hears exactly what the in-app
 * call hears. The readOnly assertion at load covers both keys. */
export const VOICE_ALLOWLIST: ChannelAllowlist = {
  voice: SPOKEN_TOOLS,
  phone: SPOKEN_TOOLS,
}

/** The mail pack is always registered, so the prompt and the tools are the same in every
 * deployment; without a token store (no MS_ variables) its tools answer outlook_unavailable.
 * `graphFetch` is the tests' fake Graph. */
export function createRegistry(tokens: TokenStore | null = null, graphFetch?: typeof fetch): ToolRegistry {
  const mail = createMailPack({
    token: mailTokenProvider(tokens),
    ...(graphFetch ? { fetch: graphFetch } : {}),
  })
  return new ToolRegistry([demoPack, mail], VOICE_ALLOWLIST)
}
