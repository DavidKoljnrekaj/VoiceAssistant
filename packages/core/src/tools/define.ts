// The tool contract. A tool is a zod input schema, a model-facing description, a role gate, a
// truthful `readOnly` flag and a handler that reads as the user and honours its abort signal.
import type { z } from 'zod'

import type { AuthContext, Role } from '../auth.js'
import type { Channel } from '../channel.js'

/** Per-request, non-auth context threaded into every handler. `channel` lets a handler shape
 * its output for the channel (voice: no ids, at most five items, short text). */
export interface ToolHandlerExtras {
  requestId: string
  channel: Channel
  clientContext?: { route?: string }
}

export interface ToolDefinition<I> {
  /** snake_case, unique across every pack a registry holds. */
  name: string
  /** Model-facing English: what it does, when to call it, when not to, non-obvious constraints. */
  description: string
  /** zod 4 object schema; every property has a `.describe()`. Re-validated at dispatch. */
  input: z.ZodType<I>
  requiredRoles: readonly Role[]
  /** True only when the handler never inserts, updates, deletes or calls a writing RPC. Every
   * tool an app names for voice must be read-only; the registry asserts it at construction. */
  readOnly: boolean
  /** The result the model reads, as JSON. `undefined` is persisted as `null`; a value JSON
   * cannot hold (a BigInt, a cycle) becomes an `is_error` result at dispatch. */
  handler(input: I, ctx: AuthContext, extras: ToolHandlerExtras, signal: AbortSignal): Promise<unknown>
}

export interface ToolPack {
  name: string
  tools: ToolDefinition<unknown>[]
  /** Domain rules this pack contributes to the shared prompt block. Reserved: the skeleton's
   * prompt builders use `DOMAIN_RULES_HR` alone; concatenation in pack order comes with the
   * first integration pack. */
  domainRules?: string
}

const NAME = /^[a-z][a-z0-9_]*$/

/** Identity with a construction-time check of the name. Exists so packs get inference of `I`
 * from the schema and a typed handler. */
export function defineTool<I>(def: ToolDefinition<I>): ToolDefinition<I> {
  if (!NAME.test(def.name)) throw new Error(`tool name must be snake_case: ${def.name}`)
  return def
}
