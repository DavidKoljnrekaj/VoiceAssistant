// R01: the API's own composition of the engine's registry: every demo and mail tool on chat,
// nothing on voice (voice turns run in the worker, whose allowlist is its own).
import { describe, expect, it } from 'vitest'

import { API_ALLOWLIST, createRegistry } from '../src/tools.js'

describe('api tools', () => {
  it('R01 CORE-10: the API advertises the demo and mail packs on chat and nothing on voice', () => {
    expect(API_ALLOWLIST).toEqual({ chat: 'all' })
    const registry = createRegistry()
    expect(registry.anthropicTools({ role: 'member' }, 'chat').map((t) => t.name)).toEqual([
      'create_note',
      'get_item',
      'list_calendar',
      'list_mail',
      'read_mail',
      'search_items',
      'search_mail',
    ])
    // Part 13b: the mail pack's rules reach the chat prompt whether or not Outlook is configured.
    expect(registry.domainRules()).toHaveLength(1)
    expect(registry.anthropicTools({ role: 'admin' }, 'voice')).toEqual([])
  })
})
