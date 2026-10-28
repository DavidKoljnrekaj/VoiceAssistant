// One registry, one role gate, one channel allowlist. What `select` advertises is exactly what
// `find` resolves at dispatch, so a name the model was never shown cannot run (invariants 4, 5).
import type Anthropic from '@anthropic-ai/sdk'

import type { AuthContext } from '../auth.js'
import type { Channel } from '../channel.js'
import type { ToolDefinition, ToolPack } from './define.js'
import { toAnthropicTool } from './schema.js'

export type ChannelAllowlist = Record<Channel, 'all' | readonly string[]>

/**
 * Default-deny per channel: chat gets every registered tool; voice only what is named here, in
 * a reviewed diff that says why the output is safe to read aloud. Every voice tool is read-only,
 * asserted when the registry is built.
 */
export const CHANNEL_ALLOWLIST: ChannelAllowlist = {
  chat: 'all',
  voice: ['search_items', 'get_item'],
}

export type RefusalReason = 'unknown_tool' | 'not_permitted_for_role' | 'not_permitted_on_channel'

export class ToolRegistry {
  private readonly byName = new Map<string, ToolDefinition<unknown>>()
  private readonly allowlist: ChannelAllowlist
  private readonly advertised = new Map<string, Anthropic.Tool[]>()

  constructor(packs: readonly ToolPack[], allowlist: ChannelAllowlist = CHANNEL_ALLOWLIST) {
    for (const pack of packs) {
      for (const tool of pack.tools) {
        if (this.byName.has(tool.name)) throw new Error(`duplicate tool name: ${tool.name}`)
        this.byName.set(tool.name, tool)
      }
    }
    this.allowlist = allowlist
    assertAllowlist(this.byName, allowlist)
  }

  /** Every registered tool, sorted by name. */
  all(): ToolDefinition<unknown>[] {
    return [...this.byName.values()].sort(byName)
  }

  /** True when a tool with this name is registered at all, whatever the role or channel. */
  exists(name: string): boolean {
    return this.byName.has(name)
  }

  /** The tools this role may use on this channel (role ∩ channel), sorted by name. */
  select(ctx: Pick<AuthContext, 'role'>, channel: Channel): ToolDefinition<unknown>[] {
    const allowed = this.allowlist[channel]
    return this.all().filter(
      (t) => t.requiredRoles.includes(ctx.role) && (allowed === 'all' || allowed.includes(t.name)),
    )
  }

  /** Resolves a name through the same filter as `select`. Undefined for unknown and forbidden
   * alike; `refusalReason` says which. */
  find(ctx: Pick<AuthContext, 'role'>, name: string, channel: Channel): ToolDefinition<unknown> | undefined {
    return this.select(ctx, channel).find((t) => t.name === name)
  }

  /** Why `find` returned undefined, for the dispatch log and the `is_error` result. */
  refusalReason(ctx: Pick<AuthContext, 'role'>, name: string, channel: Channel): RefusalReason | null {
    if (this.find(ctx, name, channel)) return null
    if (!this.byName.has(name)) return 'unknown_tool'
    const tool = this.byName.get(name)!
    if (!tool.requiredRoles.includes(ctx.role)) return 'not_permitted_for_role'
    return 'not_permitted_on_channel'
  }

  /** The `tools` array for a request: deterministic order (by name), `strict: true` on every
   * tool, the last one carrying the cache breakpoint. Built once per role and channel. */
  anthropicTools(ctx: Pick<AuthContext, 'role'>, channel: Channel): Anthropic.Tool[] {
    const key = `${ctx.role}:${channel}`
    let tools = this.advertised.get(key)
    if (!tools) {
      tools = this.select(ctx, channel).map(toAnthropicTool)
      const last = tools.at(-1)
      if (last) last.cache_control = { type: 'ephemeral' }
      this.advertised.set(key, tools)
    }
    return tools
  }
}

/** Throws when an allowlist names a tool that is not registered or that writes. */
export function assertAllowlist(
  tools: ReadonlyMap<string, ToolDefinition<unknown>>,
  allowlist: ChannelAllowlist,
): void {
  for (const [channel, names] of Object.entries(allowlist)) {
    if (names === 'all') continue
    for (const name of names) {
      const tool = tools.get(name)
      if (!tool) throw new Error(`CHANNEL_ALLOWLIST.${channel} names an unknown tool: ${name}`)
      if (!tool.readOnly) throw new Error(`CHANNEL_ALLOWLIST.${channel} names a tool that writes: ${name}`)
    }
  }
}

function byName(a: ToolDefinition<unknown>, b: ToolDefinition<unknown>): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}
