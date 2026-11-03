// `isChatEvent` as the client's shape guard: an event whose required fields are missing or of
// the wrong type is dropped, never rendered as "undefined" (WEB-15).
import { describe, expect, it } from 'vitest'

import { isChatEvent } from './api'

describe('isChatEvent', () => {
  it('T01: accepts each of the eight events with the fields docs/API.md lists', () => {
    const valid = [
      { type: 'session', session_id: 's1' },
      { type: 'delta', text: 'Bok' },
      { type: 'turn', role: 'assistant', text: 'Dobar dan', message_id: 'a1' },
      { type: 'tool_call', tool: 'search_items', input: { q: 'x' }, tool_use_id: 'tu1' },
      { type: 'tool_result', tool: 'search_items', output: [], tool_use_id: 'tu1', is_error: false },
      {
        type: 'confirm',
        confirmation_id: 'c1',
        tool: 'create_note',
        tool_use_id: 'tu1',
        summary: 'Zabilježit ću…',
        expires_at: '2026-11-03T10:05:00Z',
      },
      { type: 'done', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } },
      { type: 'error', code: 'request_timeout', message: 'Isteklo je vrijeme.' },
    ]
    for (const event of valid) expect(isChatEvent(event), JSON.stringify(event)).toBe(true)
  })

  it('WEB-15: drops an event with a known type but a missing or mistyped required field', () => {
    const invalid = [
      { type: 'delta' },
      { type: 'delta', text: 42 },
      { type: 'turn', role: 'assistant', text: 'x' },
      { type: 'turn', role: 'assistant', message_id: 'a1' },
      { type: 'tool_call', tool: 'search_items' },
      { type: 'tool_result', tool: 'search_items', tool_use_id: 'tu1', is_error: 'no' },
      { type: 'session' },
      { type: 'error', code: 'x' },
      { type: 'error', message: 'x' },
      { type: 'confirm', confirmation_id: 'c1', tool: 'create_note', tool_use_id: 'tu1' },
    ]
    for (const event of invalid) expect(isChatEvent(event), JSON.stringify(event)).toBe(false)
  })

  it('T02: drops unknown types and non-objects', () => {
    expect(isChatEvent({ type: 'mystery' })).toBe(false)
    expect(isChatEvent({})).toBe(false)
    expect(isChatEvent(null)).toBe(false)
    expect(isChatEvent('delta')).toBe(false)
  })
})
