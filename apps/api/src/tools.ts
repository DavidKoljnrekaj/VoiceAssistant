// The API's composition of the engine's registry: the packs it serves (demo, mail) and what
// each channel may see. Default-deny per channel: this process answers chat, so chat gets every registered
// tool its role allows and no other channel is named (an absent channel gets nothing). Voice
// turns run in the worker, whose allowlist is `apps/voice/src/tools.ts`.
import { type ChannelAllowlist, ToolRegistry } from '@va/core'
import type { TokenStore } from '@va/integrations'
import { demoPack } from '@va/tools-demo'
import { createMailPack } from '@va/tools-mail'

import { mailTokenProvider } from './mail.js'

export const API_ALLOWLIST: ChannelAllowlist = { chat: 'all' }

/** The mail pack is always registered, so the prompt and the tools are the same in every
 * deployment; without a token store (no MS_ variables) its tools answer outlook_unavailable.
 * `graphFetch` is the tests' fake Graph. */
export function createRegistry(tokens: TokenStore | null = null, graphFetch?: typeof fetch): ToolRegistry {
  const mail = createMailPack({
    token: mailTokenProvider(tokens),
    ...(graphFetch ? { fetch: graphFetch } : {}),
  })
  return new ToolRegistry([demoPack, mail], API_ALLOWLIST)
}
