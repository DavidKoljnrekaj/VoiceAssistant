// The API's composition of the engine's registry: the packs it serves and what each channel
// may see. Default-deny per channel: this process answers chat, so chat gets every registered
// tool its role allows and no other channel is named (an absent channel gets nothing). Voice
// turns run in the worker, whose allowlist is `apps/voice/src/tools.ts`.
import { type ChannelAllowlist, ToolRegistry } from '@va/core'
import { demoPack } from '@va/tools-demo'

export const API_ALLOWLIST: ChannelAllowlist = { chat: 'all' }

export function createRegistry(): ToolRegistry {
  return new ToolRegistry([demoPack], API_ALLOWLIST)
}
