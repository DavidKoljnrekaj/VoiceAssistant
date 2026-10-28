// W05–W08, W10–W12, W14: a turn through `AssistantAgent.llmNode`, the stream LiveKit reads,
// the rows written after the answer, and the gates. Assertions are on what is spoken, the rows,
// and the requests sent; the loop itself is tested in @va/core.
import { describe, expect } from 'vitest'

import { CHANNEL_ALLOWLIST, FALLBACK_BETA, MESSAGES_HR } from '@va/core'
import {
  answer,
  awaitHandlerEvent,
  blocksOf,
  callTools,
  clientOf,
  handlerEvents,
  refusal,
  TEST_ALLOWLIST,
  TEST_PACK,
  toolResultSentToModel,
  toolUse,
} from '@va/core/test'
import { demoPack } from '@va/tools-demo'

import {
  anthropic,
  ask,
  db,
  FILLER,
  FLUSH,
  logs,
  openCall,
  rowsOf,
  scenario,
  TOKENS,
  uuid,
} from './harness.js'

const kinds = (sessionId: string) => rowsOf(sessionId).map((r) => r.turn_kind)

describe('a spoken turn', () => {
  scenario(
    'W05 filler then answer, in order, with a flush after the filler; the tool ran as the caller',
    async () => {
      anthropic.script(
        callTools(toolUse('search_items', { query: 'stol' })),
        answer('Imamo dva stola. Radni stol košta tristo dvadeset eura.'),
      )
      const call = await openCall()
      const out = await (await ask(call, 'Koji stolovi postoje?')).done
      expect(out.chunks[0]).toBe(FILLER)
      expect(out.chunks[1]).toBe(FLUSH)
      expect(out.paragraphs).toEqual([FILLER, 'Imamo dva stola. Radni stol košta tristo dvadeset eura.'])
      expect(out.text).not.toContain('\n\n')

      const read = db.requestsTo('demo_items', 'GET')
      expect(read).toHaveLength(1)
      expect(clientOf(read[0]!)).toBe('user')
      expect(read[0]!.headers.get('Authorization')).toBe(`Bearer ${TOKENS.member}`)
      const result = toolResultSentToModel(1, toolUseIdOf(0)) as {
        items: unknown[]
        total: number
      }
      // 'stol' matches Radni stol, Stolna lampa and Uredska stolica.
      expect(result.total).toBe(3)
      expect(result.items).toHaveLength(3)
      // Voice output: no ids to read aloud.
      expect(Object.keys(result.items[0] as object)).toEqual(['name', 'category', 'price'])
      expect(anthropic.calls[1]!.body.messages.at(-1)!.role).toBe('user')
    },
  )

  scenario(
    'W06 a tool outside the voice allowlist is refused at dispatch even when the model names it',
    async () => {
      expect(CHANNEL_ALLOWLIST.voice).not.toContain('create_note')
      anthropic.script(
        callTools(toolUse('create_note', { item_id: uuid(501), text: 'zapamti' })),
        answer('To ne mogu u glasovnom razgovoru.'),
      )
      const call = await openCall()
      const out = await (await ask(call, 'Zapiši napomenu.')).done
      expect(out.paragraphs).toEqual([FILLER, 'To ne mogu u glasovnom razgovoru.'])
      const result = toolResultSentToModel(1, toolUseIdOf(0)) as { error: string }
      expect(result.error).toBe('tool execution failed: tool refused: not_permitted_on_channel')
      expect(db.rows('demo_notes')).toHaveLength(0)
      expect(db.requestsTo('demo_notes')).toHaveLength(0)
      expect(
        logs.some((l) => l.line.includes('tool refused at dispatch') && l.line.includes('create_note')),
      ).toBe(true)
      // The request advertised only the allowlisted tools.
      expect(anthropic.calls[0]!.body.tools!.map((t) => t.name)).toEqual(['get_item', 'search_items'])
    },
  )

  scenario(
    'W07 the rows are written after the answer, chained, newest row first for the next turn',
    async () => {
      anthropic.script(
        callTools(toolUse('search_items', { query: 'lampa' })),
        answer('Stolna lampa košta pedeset eura.'),
        answer('Nema na čemu.'),
      )
      const call = await openCall()
      expect(rowsOf(call.sessionId)).toHaveLength(0)
      const first = await (await ask(call, 'Koliko košta lampa?')).done
      expect(first.text).toContain('pedeset eura')
      await call.session.settle()

      const rows = rowsOf(call.sessionId)
      expect(kinds(call.sessionId)).toEqual(['user', 'assistant', 'tool_result', 'assistant'])
      expect(rows[0]!.parent_id).toBeNull()
      for (let i = 1; i < rows.length; i++) expect(rows[i]!.parent_id).toBe(rows[i - 1]!.id)
      expect(rows.map((r) => r.created_at)).toEqual([...rows.map((r) => r.created_at)].sort())
      expect(blocksOf(rows[0]!.content, 'text')[0]!.text).toBe('Koliko košta lampa?')
      expect(blocksOf(rows[1]!.content, 'tool_use')).toHaveLength(1)
      expect(rows[1]).toMatchObject({
        model: 'claude-sonnet-5-5',
        stop_reason: 'tool_use',
        input_tokens: 120,
      })
      expect(blocksOf(rows[3]!.content, 'text')[0]!.text).toBe('Stolna lampa košta pedeset eura.')
      // One insert for the whole turn, with the session id on every row.
      const inserts = db.requestsTo('ai_messages', 'POST')
      expect(inserts).toHaveLength(1)
      expect(
        (inserts[0]!.body as Array<{ session_id: string }>).every((r) => r.session_id === call.sessionId),
      ).toBe(true)
      expect(clientOf(inserts[0]!)).toBe('service')

      await (
        await ask(call, 'Hvala.', [
          { role: 'user', text: 'Koliko košta lampa?' },
          { role: 'assistant', text: 'Stolna lampa košta pedeset eura.' },
        ])
      ).done
      await call.session.settle()
      const after = rowsOf(call.sessionId)
      expect(after.map((r) => r.turn_kind)).toEqual([
        'user',
        'assistant',
        'tool_result',
        'assistant',
        'user',
        'assistant',
      ])
      expect(after[4]!.parent_id).toBe(rows[3]!.id)
      expect(after[5]!.parent_id).toBe(after[4]!.id)
      // The model got the call's own context, not the rows.
      expect(anthropic.calls[2]!.body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    },
  )

  scenario(
    'W08 a stream cancel (barge-in) aborts the loop and persists the synthetic tool_result',
    async () => {
      anthropic.script(callTools(toolUse('gate', { key: 'g' })))
      const call = await openCall({ packs: [TEST_PACK], allowlist: TEST_ALLOWLIST })
      const handle = await ask(call, 'Pričekaj.')
      await awaitHandlerEvent('start:g')
      await handle.cancel()
      const out = await handle.done
      expect(out.paragraphs).toEqual([FILLER])
      expect(handlerEvents).toContain('aborted:g')
      await call.session.settle()
      expect(kinds(call.sessionId)).toEqual(['user', 'assistant', 'tool_result'])
      const result = blocksOf(rowsOf(call.sessionId)[2]!.content, 'tool_result')[0]!
      expect(result.is_error).toBe(true)
      expect(JSON.parse(result.content as string)).toEqual({ error: 'cancelled before the tool returned' })
      expect(anthropic.calls).toHaveLength(1)
      expect(logs.some((l) => l.line.includes('tool round aborted'))).toBe(true)
    },
  )

  scenario('W10 the voice model profile is on every request', async () => {
    anthropic.script(callTools(toolUse('search_items', { query: 'a' })), answer('Da.'))
    const call = await openCall()
    await (
      await ask(call, 'Ima li artikala?')
    ).done
    expect(anthropic.calls).toHaveLength(2)
    for (const c of anthropic.calls) {
      expect(c.body).toMatchObject({
        model: 'claude-sonnet-5-5',
        max_tokens: 1024,
        stream: true,
        thinking: { type: 'between_tools' },
        output_config: { effort: 'low' },
        fallbacks: 'default',
      })
      expect(c.headers.get('anthropic-beta')).toContain(FALLBACK_BETA)
      expect(c.body.tools!.every((t) => t.strict === true)).toBe(true)
      expect(c.body.tools!.at(-1)!.cache_control).toEqual({ type: 'ephemeral' })
      const system = c.body.system as Array<{ text: string; cache_control?: unknown }>
      expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' })
      expect(system[2]!.text).toMatch(/^Danas je .*2026\.$/)
    }
  })

  scenario('W11 a model error is spoken and the stream ends; only the user row is written', async () => {
    anthropic.script({ error: { status: 500, type: 'api_error', message: 'boom' } })
    const call = await openCall()
    const out = await (await ask(call, 'Halo?')).done
    expect(out.text).toBe(MESSAGES_HR.model_error)
    await call.session.settle()
    expect(kinds(call.sessionId)).toEqual(['user'])
    expect(logs.some((l) => l.line.includes('model call failed'))).toBe(true)
  })

  scenario('W12 a refusal with nothing spoken says the one-sentence decline', async () => {
    anthropic.script(refusal())
    const call = await openCall()
    const out = await (await ask(call, 'Nešto neprimjereno.')).done
    expect(out.text).toBe(MESSAGES_HR.model_refused)
    await call.session.settle()
    expect(kinds(call.sessionId)).toEqual(['user', 'assistant'])
  })

  scenario('W14 the turn cap per call is spoken as rate_limited and reaches no model', async () => {
    anthropic.script(answer('Prvi.'))
    const call = await openCall({ maxTurns: 1 })
    expect((await (await ask(call, 'Jedan.')).done).text).toBe('Prvi.')
    const out = await (await ask(call, 'Dva.')).done
    expect(out.text).toBe(MESSAGES_HR.rate_limited)
    expect(anthropic.calls).toHaveLength(1)
    expect(logs.some((l) => l.line.includes('turn limit reached'))).toBe(true)
  })

  scenario('W14b an expired identity is spoken as unauthorized and reaches no model', async () => {
    const call = await openCall()
    await call.identity.ctx()
    // The stored JWT stops being valid (GoTrue rejects it) and the cache interval passes.
    db.rows('voice_calls')[0]!.access_token = 'tok-nobody'
    call.clock.ms += 60_000
    const out = await (await ask(call, 'Halo?')).done
    expect(out.text).toBe(MESSAGES_HR.unauthorized)
    expect(anthropic.calls).toHaveLength(0)
  })

  scenario('W05b the demo pack is what the worker registers', async () => {
    expect(demoPack.tools.map((t) => t.name)).toEqual(['search_items', 'get_item', 'create_note'])
  })
})

/** The id of the tool_use the model made in call `call`, as the next request echoes it. */
function toolUseIdOf(call: number): string {
  const uses = blocksOf(anthropic.calls[call + 1]!.body.messages.at(-2)!.content, 'tool_use')
  return String(uses[0]!.id)
}
