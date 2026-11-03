// C30–C33: the write protocol over HTTP. A pending write shows up as a `confirm` event after
// its `tool_result`, with a row in `tool_confirmations`; the next turn carries `confirm` or
// `decline`; a wrong id is 400 `confirmation_invalid`.
import { describe, expect } from 'vitest'

import { answer, callTools, ITEMS, toolUse } from '@va/core/test'

import { anthropic, call, chat, db, flatError, scenario, TOKENS, USERS } from './harness.js'

const NOTE = { item_id: ITEMS.desk.id, text: 'Naručiti dva.' }

async function pendingNote(): Promise<{ sessionId: string; id: string; toolUseId: string }> {
  anthropic.script(callTools(toolUse('create_note', NOTE)), answer('Želite li da zabilježim?'))
  const sse = await chat({ session_id: null, message: 'Zabilježi: naručiti dva radna stola' })
  const types = sse.events.map((e) => e.data.type).filter((t) => t !== 'delta')
  expect(types).toEqual(['session', 'tool_call', 'tool_result', 'confirm', 'turn', 'done'])
  const confirm = sse.events.find((e) => e.data.type === 'confirm')!.data as Record<string, string>
  const toolUseId = (sse.events.find((e) => e.data.type === 'tool_call')!.data as Record<string, string>)
    .tool_use_id!
  return {
    sessionId: (sse.events[0]!.data as unknown as { session_id: string }).session_id,
    id: confirm.confirmation_id!,
    toolUseId,
  }
}

describe('POST /chat with the write protocol', () => {
  scenario(
    'C30 a confirmed write previews: tool_result (pending, no id), then confirm with the id; a pending row; no note',
    async () => {
      const { sessionId, id, toolUseId } = await pendingNote()
      expect(id).toMatch(/^[0-9a-f-]{36}$/)
      const rows = db.rows('tool_confirmations')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id,
        session_id: sessionId,
        user_id: USERS.member.id,
        tool: 'create_note',
        summary: 'Zabilježit ću uz artikl "Radni stol": "Naručiti dva."',
        outcome: 'pending',
      })
      expect(db.rows('demo_notes')).toHaveLength(0)
      const stored = db
        .rows('ai_messages')
        .find((m) => m.session_id === sessionId && m.turn_kind === 'tool_result')!
      expect(JSON.stringify(stored.content)).not.toContain(id)
      expect(JSON.stringify(stored.content)).toContain('pending_confirmation')
      expect(anthropic.calls.every((c) => !JSON.stringify(c.body).includes(id))).toBe(true)
      expect(toolUseId).toBeTruthy()
    },
  )

  scenario(
    'C31 the next turn with confirm runs the write once: the note exists, the row is executed, no second confirm',
    async () => {
      const { sessionId, id } = await pendingNote()
      anthropic.script(callTools(toolUse('create_note', NOTE)), answer('Zabilježeno.'))
      const sse = await chat({ session_id: sessionId, message: 'Da.', confirm: id })
      expect(sse.events.map((e) => e.data.type).filter((t) => t !== 'delta')).toEqual([
        'session',
        'tool_call',
        'tool_result',
        'turn',
        'done',
      ])
      expect(db.rows('demo_notes')).toHaveLength(1)
      expect(db.rows('tool_confirmations')[0]).toMatchObject({
        id,
        outcome: 'executed',
        confirmed_at: expect.any(String),
        settled_at: expect.any(String),
      })
      const updates = db.requestsTo('tool_confirmations', 'PATCH')
      expect(updates.length).toBeGreaterThanOrEqual(2)
      for (const u of updates) {
        expect(u.params.get('session_id')).toBe(`eq.${sessionId}`)
        expect(u.params.get('user_id')).toBe(`eq.${USERS.member.id}`)
      }
      // Used: confirming again is refused before the stream.
      const again = await call('/chat', { session_id: sessionId, message: 'Da.', confirm: id })
      expect(await flatError(again)).toMatchObject({ status: 400, code: 'confirmation_invalid' })
      expect(db.rows('demo_notes')).toHaveLength(1)
    },
  )

  scenario(
    'C33 two identical tool_uses in one confirmed turn write once: the second consume finds the id used',
    async () => {
      const { sessionId, id } = await pendingNote()
      anthropic.script(
        callTools(toolUse('create_note', NOTE), toolUse('create_note', NOTE)),
        answer('Zabilježeno.'),
      )
      const sse = await chat({ session_id: sessionId, message: 'Da.', confirm: id })
      const results = sse.events.filter((e) => e.data.type === 'tool_result')
      expect(results).toHaveLength(2)
      expect(db.rows('demo_notes')).toHaveLength(1)
      // One executed, the other previewed again (a fresh confirmation for the user to answer).
      const outputs = results.map((r) => r.data.output as Record<string, unknown>)
      expect(outputs.filter((o) => 'id' in o)).toHaveLength(1)
      expect(outputs.filter((o) => o.pending_confirmation === true)).toHaveLength(1)
      expect(sse.events.filter((e) => e.data.type === 'confirm')).toHaveLength(1)
      expect(
        db
          .rows('tool_confirmations')
          .map((r) => r.outcome)
          .sort(),
      ).toEqual(['executed', 'pending'])
    },
  )

  scenario(
    'C32 decline settles the row and the turn runs as a plain one; a wrong, foreign or doubled id is refused before the stream',
    async () => {
      const { sessionId, id } = await pendingNote()
      anthropic.script(answer('U redu, neću.'))
      const sse = await chat({ session_id: sessionId, message: 'Ne.', decline: id })
      expect(sse.events.map((e) => e.data.type).filter((t) => t !== 'delta')).toEqual([
        'session',
        'turn',
        'done',
      ])
      expect(db.rows('tool_confirmations')[0]).toMatchObject({
        id,
        outcome: 'declined',
        settled_at: expect.any(String),
      })
      expect(db.rows('demo_notes')).toHaveLength(0)

      expect(
        await flatError(await call('/chat', { session_id: sessionId, message: 'Da.', confirm: id })),
      ).toMatchObject({
        status: 400,
        code: 'confirmation_invalid',
      })
      expect(
        await flatError(
          await call('/chat', {
            session_id: sessionId,
            message: 'Da.',
            confirm: '00000000-0000-4000-8000-000000000001',
          }),
        ),
      ).toMatchObject({
        status: 400,
        code: 'confirmation_invalid',
      })
      expect(
        await flatError(
          await call('/chat', { session_id: sessionId, message: 'Da.', confirm: id, decline: id }),
        ),
      ).toMatchObject({
        status: 400,
        code: 'bad_request',
      })
      expect(
        await flatError(await call('/chat', { session_id: null, message: 'Da.', confirm: id })),
      ).toMatchObject({
        status: 400,
        code: 'bad_request',
      })
      expect(
        await flatError(await call('/chat', { session_id: sessionId, message: 'Da.', confirm: 'nope' })),
      ).toMatchObject({
        status: 400,
        code: 'bad_request',
      })
      // Another user cannot confirm it.
      expect(
        await flatError(
          await call(
            '/chat',
            { session_id: sessionId, message: 'Da.', confirm: id },
            { token: TOKENS.admin },
          ),
        ),
      ).toMatchObject({
        status: 404,
        code: 'session_not_found',
      })
    },
  )
})
