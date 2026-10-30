// R01: the API's own composition of the engine's registry: every demo tool on chat, nothing on
// voice (voice turns run in the worker, whose allowlist is its own).
import { describe, expect, it } from 'vitest'

import { API_ALLOWLIST, createRegistry } from '../src/tools.js'

describe('api tools', () => {
  it('R01 CORE-10: the API advertises the demo pack on chat and nothing on voice', () => {
    expect(API_ALLOWLIST).toEqual({ chat: 'all' })
    const registry = createRegistry()
    expect(registry.anthropicTools({ role: 'member' }, 'chat').map((t) => t.name)).toEqual([
      'create_note',
      'get_item',
      'search_items',
    ])
    expect(registry.anthropicTools({ role: 'admin' }, 'voice')).toEqual([])
  })
})
