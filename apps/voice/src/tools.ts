// The worker's composition of the engine's registry: the packs it serves and what a caller may
// reach by voice. Default-deny per channel: only the tools named here are advertised and
// dispatchable on voice, every one read-only (asserted at load), and no other channel is named
// (an absent channel gets nothing). A tool joins this list in a reviewed diff whose commit says
// why its output is safe to read aloud: no ids spoken, at most five items, plain numbers.
import { type ChannelAllowlist, ToolRegistry } from '@va/core'
import { demoPack } from '@va/tools-demo'

export const VOICE_ALLOWLIST: ChannelAllowlist = {
  // search_items: at most five names with category and price, no ids; get_item: one item's
  // name, category, price and a clipped description, no id (both shape their output for voice).
  voice: ['search_items', 'get_item'],
}

export function createRegistry(): ToolRegistry {
  return new ToolRegistry([demoPack], VOICE_ALLOWLIST)
}
