// The worker's composition of the engine's registry: the packs it serves and what a caller may
// reach by voice. Default-deny per channel: only the tools named here are advertised and
// dispatchable on voice, every one read-only (asserted at load), and no other channel is named
// (an absent channel gets nothing). A tool joins this list in a reviewed diff whose commit says
// why its output is safe to read aloud: no ids spoken, at most five items, plain numbers.
import { type ChannelAllowlist, ToolRegistry } from '@va/core'
import { demoPack } from '@va/tools-demo'

// search_items: at most five names with category and price, no ids; get_item: one item's
// name, category, price and a clipped description, no id (both shape their output for voice).
const SPOKEN_TOOLS = ['search_items', 'get_item'] as const

/** One list for the two spoken channels: the phone (Part 11) hears exactly what the in-app
 * call hears. The readOnly assertion at load covers both keys. */
export const VOICE_ALLOWLIST: ChannelAllowlist = {
  voice: SPOKEN_TOOLS,
  phone: SPOKEN_TOOLS,
}

export function createRegistry(): ToolRegistry {
  return new ToolRegistry([demoPack], VOICE_ALLOWLIST)
}
