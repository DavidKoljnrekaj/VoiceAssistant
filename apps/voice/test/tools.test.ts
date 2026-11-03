// W20: the worker's own composition of the engine's registry: the voice allowlist lives here,
// names only read-only demo tools, and the read-only-or-confirmed assertion still runs at load.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineTool, type ToolPack, ToolRegistry } from '@va/core'
import { demoPack } from '@va/tools-demo'

import { createRegistry, VOICE_ALLOWLIST } from '../src/tools.js'

describe('voice tools', () => {
  it('W20 CORE-10: the worker names its voice tools; every one is read-only; an unknown or a write tool fails at load', () => {
    // Part 11: the phone channel hears exactly what the in-app call hears, from one list.
    expect(VOICE_ALLOWLIST).toEqual({
      voice: ['search_items', 'get_item'],
      phone: ['search_items', 'get_item'],
    })
    expect(VOICE_ALLOWLIST.phone).toBe(VOICE_ALLOWLIST.voice)
    const registry = createRegistry()
    expect(registry.select({ role: 'member' }, 'voice').map((t) => t.name)).toEqual([
      'get_item',
      'search_items',
    ])
    expect(registry.select({ role: 'member' }, 'phone').map((t) => t.name)).toEqual([
      'get_item',
      'search_items',
    ])
    expect(registry.select({ role: 'member' }, 'voice').every((t) => t.readOnly)).toBe(true)
    // The worker serves voice only: nothing is advertised for chat from this process.
    expect(registry.select({ role: 'admin' }, 'chat')).toEqual([])
    expect(() => new ToolRegistry([], VOICE_ALLOWLIST)).toThrow(/unknown tool: search_items/)
    // Part 12: create_note is a confirmed write, so the registry would admit it on a spoken
    // channel; the worker's allowlist still names no write (Part 13 decides the first). A plain
    // write without the protocol is refused at load, on either spoken channel.
    expect(() => new ToolRegistry([demoPack], { voice: ['create_note'] })).not.toThrow()
    expect(VOICE_ALLOWLIST.voice).not.toContain('create_note')
    const plainWrite = defineTool({
      name: 'plain_write',
      description: 'Writes without asking.',
      input: z.object({}),
      requiredRoles: ['admin', 'member'],
      readOnly: false,
      async handler() {
        return {}
      },
    })
    const plainPack: ToolPack = { name: 'plain', tools: [plainWrite] as ToolPack['tools'] }
    expect(() => new ToolRegistry([plainPack], { voice: ['plain_write'] })).toThrow(
      /writes without confirmation: plain_write/,
    )
    expect(() => new ToolRegistry([plainPack], { phone: ['plain_write'] })).toThrow(
      /writes without confirmation: plain_write/,
    )
  })
})
