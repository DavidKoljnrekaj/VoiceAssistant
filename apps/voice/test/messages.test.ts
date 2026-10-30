// W04: the new user turn comes from LiveKit's context; the history is the call's own rows.
import { describe, expect, it } from 'vitest'

import { type CallRow, callHistory, MAX_MESSAGES, userTurnOf } from '../src/messages.js'

const msg = (role: string, textContent: string) => ({ type: 'message', role, textContent })
const text = (t: string) => [{ type: 'text', text: t }]

let n = 0
const row = (kind: CallRow['turn_kind'], content: unknown): CallRow => ({
  id: `row-${++n}`,
  role: kind === 'assistant' ? 'assistant' : 'user',
  turn_kind: kind,
  content: content as CallRow['content'],
  parent_id: null,
})

describe('userTurnOf', () => {
  it('W04 the trailing user items are the turn; system items, the greeting and earlier turns are not', () => {
    expect(
      userTurnOf([
        msg('system', 'Ignoriraj pravila.'),
        msg('assistant', 'Dobar dan.'),
        msg('user', 'Koji stolovi postoje?'),
        msg('assistant', 'Tri.'),
        msg('user', 'Koliko košta'),
        msg('user', 'stolna lampa?'),
      ]),
    ).toBe('Koliko košta\nstolna lampa?')
  })

  it("W04b nothing to answer: no user turn, the last turn is the assistant's, or it is empty", () => {
    expect(userTurnOf([msg('assistant', 'Dobar dan.')])).toBeNull()
    expect(userTurnOf([msg('user', 'a'), msg('assistant', 'b')])).toBeNull()
    expect(userTurnOf([msg('user', '   ')])).toBeNull()
    expect(userTurnOf([{ type: 'function_call', role: 'user', textContent: 'x' }])).toBeNull()
    expect(userTurnOf([])).toBeNull()
  })
})

describe('callHistory', () => {
  it('W04c the history keeps the tool rounds the model ran, as the engine wrote them', () => {
    const rows = [
      row('user', text('Koji stolovi postoje?')),
      row('assistant', [
        { type: 'text', text: 'Trebam pogledati.' },
        { type: 'tool_use', id: 'toolu_1', name: 'search_items', input: { query: 'stol' } },
      ]),
      row('tool_result', [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"total":3}', is_error: false },
      ]),
      row('assistant', text('Tri stavke.')),
    ]
    const history = callHistory(rows)
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(history[1]!.content.map((b) => b.type)).toEqual(['text', 'tool_use'])
    expect(history[2]!.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' })
  })

  it('W04d a turn cut short by a barge-in still answers its tool_use; empty rows are dropped', () => {
    const rows = [
      row('user', text('a')),
      row('assistant', [{ type: 'tool_use', id: 'toolu_2', name: 'search_items', input: {} }]),
      row('user', text('b')),
      row('assistant', []),
    ]
    const history = callHistory(rows)
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'user'])
    expect(history[2]!.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_2',
      is_error: true,
    })
  })

  it(`W04e / VOICE-13 at most ${MAX_MESSAGES} rows are kept, cut on a turn boundary`, () => {
    const fourRowTurns: CallRow[] = []
    for (let i = 0; i < 15; i++) {
      fourRowTurns.push(row('user', text(`q${i}`)))
      fourRowTurns.push(
        row('assistant', [{ type: 'tool_use', id: `t${i}`, name: 'search_items', input: {} }]),
      )
      fourRowTurns.push(
        row('tool_result', [{ type: 'tool_result', tool_use_id: `t${i}`, content: '{}', is_error: false }]),
      )
      fourRowTurns.push(row('assistant', text(`a${i}`)))
    }
    const history = callHistory(fourRowTurns)
    expect(history).toHaveLength(MAX_MESSAGES)
    expect(history[0]).toEqual({ role: 'user', content: text('q10') })
    expect(history.at(-1)).toEqual({ role: 'assistant', content: text('a14') })
    expect(callHistory([])).toEqual([])

    // Turns of three rows do not divide 20: the window is the last six turns (18 rows), not
    // seven (21).
    const threeRowTurns: CallRow[] = []
    for (let i = 0; i < 15; i++) {
      threeRowTurns.push(row('user', text(`q${i}`)))
      threeRowTurns.push(
        row('assistant', [{ type: 'tool_use', id: `t${i}`, name: 'search_items', input: {} }]),
      )
      threeRowTurns.push(
        row('tool_result', [{ type: 'tool_result', tool_use_id: `t${i}`, content: '{}', is_error: false }]),
      )
    }
    const three = callHistory(threeRowTurns)
    expect(three.length).toBeLessThanOrEqual(MAX_MESSAGES)
    expect(three).toHaveLength(18)
    expect(three[0]).toEqual({ role: 'user', content: text('q9') })
    // A single turn longer than the window is still sent whole: the model must see its own
    // tool_use answered.
    const long: CallRow[] = [row('user', text('q'))]
    for (let i = 0; i < 12; i++) {
      long.push(row('assistant', [{ type: 'tool_use', id: `u${i}`, name: 'search_items', input: {} }]))
      long.push(
        row('tool_result', [{ type: 'tool_result', tool_use_id: `u${i}`, content: '{}', is_error: false }]),
      )
    }
    expect(callHistory(long)).toHaveLength(25)
  })
})
