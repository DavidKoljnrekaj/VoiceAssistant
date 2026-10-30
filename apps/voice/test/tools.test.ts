// W20: the worker's own composition of the engine's registry: the voice allowlist lives here,
// names only read-only demo tools, and the read-only assertion still runs at load.
import { describe, expect, it } from 'vitest'

import { ToolRegistry } from '@va/core'
import { demoPack } from '@va/tools-demo'

import { createRegistry, VOICE_ALLOWLIST } from '../src/tools.js'

describe('voice tools', () => {
  it('W20 CORE-10: the worker names its voice tools; every one is read-only; an unknown or a write tool fails at load', () => {
    expect(VOICE_ALLOWLIST).toEqual({ voice: ['search_items', 'get_item'] })
    const registry = createRegistry()
    expect(registry.select({ role: 'member' }, 'voice').map((t) => t.name)).toEqual(['get_item', 'search_items'])
    expect(registry.select({ role: 'member' }, 'voice').every((t) => t.readOnly)).toBe(true)
    // The worker serves voice only: nothing is advertised for chat from this process.
    expect(registry.select({ role: 'admin' }, 'chat')).toEqual([])
    expect(() => new ToolRegistry([], VOICE_ALLOWLIST)).toThrow(/unknown tool: search_items/)
    expect(() => new ToolRegistry([demoPack], { voice: ['create_note'] })).toThrow(/writes: create_note/)
  })
})
