// The tool pack the engine scenarios run against: small, deterministic tools whose behaviour the
// tests control (a gate the test opens, a handler that fails, one that throws, one per role, one
// that writes). The demo pack's own loop scenario lives in @va/tools-demo.
import { z } from 'zod'

import { defineTool, type ToolPack } from '../tools/define.js'
import type { ChannelAllowlist } from '../tools/registry.js'

/** `start:<key>`, `end:<key>`, `aborted:<key>` as the gate tool sees them; cleared by `reset()`. */
export const handlerEvents: string[] = []
const waiters: Array<{ event: string; resolve: () => void }> = []

function record(event: string): void {
  handlerEvents.push(event)
  for (const w of waiters.splice(0)) {
    if (w.event === event) w.resolve()
    else waiters.push(w)
  }
}

/** Resolves when the gate tool records `event` (immediately if it already has). */
export function awaitHandlerEvent(event: string): Promise<void> {
  if (handlerEvents.includes(event)) return Promise.resolve()
  return new Promise((resolve) => waiters.push({ event, resolve }))
}

interface Gate {
  open: (value: unknown) => void
  promise: Promise<unknown>
}
const gates = new Map<string, Gate>()

function gate(key: string): Gate {
  let g = gates.get(key)
  if (!g) {
    let open!: (value: unknown) => void
    const promise = new Promise<unknown>((resolve) => {
      open = resolve
    })
    g = { open, promise }
    gates.set(key, g)
  }
  return g
}

/** Lets the `gate` tool called with this key return `value`. May be called before the tool runs. */
export function openGate(key: string, value: unknown = { key }): void {
  gate(key).open(value)
}

export function resetTestTools(): void {
  handlerEvents.length = 0
  waiters.length = 0
  gates.clear()
}

export const echo = defineTool({
  name: 'echo',
  description: 'Returns the text it is given.',
  input: z.object({ text: z.string().describe('Text to echo.') }),
  requiredRoles: ['admin', 'member'],
  readOnly: true,
  async handler(input, ctx) {
    return { echoed: input.text, role: ctx.role }
  },
})

export const whoami = defineTool({
  name: 'whoami',
  description: 'Reads the current user profile through the user client.',
  input: z.object({}),
  requiredRoles: ['admin', 'member'],
  readOnly: true,
  async handler(_input, ctx, _extras, signal) {
    const { data, error } = await ctx.userClient
      .from('users')
      .select('email, role')
      .eq('id', ctx.userId)
      .abortSignal(signal)
      .single()
    if (error) throw new Error(`whoami failed: ${error.code}`)
    return data
  },
})

export const gateTool = defineTool({
  name: 'gate',
  description: 'Waits until the test opens the gate with this key.',
  input: z.object({ key: z.string().describe('Gate key.') }),
  requiredRoles: ['admin', 'member'],
  readOnly: true,
  async handler(input, _ctx, _extras, signal) {
    record(`start:${input.key}`)
    const abort = new Promise<never>((_, reject) => {
      const onAbort = () => {
        record(`aborted:${input.key}`)
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
    const value = await Promise.race([gate(input.key).promise, abort])
    record(`end:${input.key}`)
    return value
  },
})

export const fail = defineTool({
  name: 'fail',
  description: 'Returns an error envelope.',
  input: z.object({}),
  requiredRoles: ['admin', 'member'],
  readOnly: true,
  async handler() {
    return { error: 'nothing here' }
  },
})

export const boom = defineTool({
  name: 'boom',
  description: 'Throws.',
  input: z.object({}),
  requiredRoles: ['admin', 'member'],
  readOnly: true,
  async handler() {
    throw new Error('kaboom')
  },
})

export const adminOnly = defineTool({
  name: 'admin_only',
  description: 'Admins only.',
  input: z.object({}),
  requiredRoles: ['admin'],
  readOnly: true,
  async handler() {
    return { secret: 42 }
  },
})

export const writeNote = defineTool({
  name: 'write_note',
  description: 'A write tool: never on voice.',
  input: z.object({ text: z.string().describe('Note text.') }),
  requiredRoles: ['admin', 'member'],
  readOnly: false,
  async handler(input) {
    return { written: input.text }
  },
})

export const TEST_PACK: ToolPack = {
  name: 'test',
  tools: [echo, whoami, gateTool, fail, boom, adminOnly, writeNote] as ToolPack['tools'],
}

export const TEST_ALLOWLIST: ChannelAllowlist = {
  chat: 'all',
  voice: ['echo', 'whoami', 'gate'],
}
