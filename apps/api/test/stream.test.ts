// C scenarios: the stream. `: ready` first, `session` second, every event name equals its
// data.type; persist-before-emit; cancellation from the request signal; the timeout.
import { describe, expect, it, vi } from 'vitest'

import { TRUNCATED_HR } from '@va/core'
import {
  answer,
  callTools,
  MSG_TOOL_RESULT,
  MSG_USER,
  SESSION_MEMBER_CHAT,
  text,
  toolUse,
} from '@va/core/test'

import { contextLine } from '../src/chat/route-context.js'
import {
  anthropic,
  buildApp,
  call,
  chat,
  db,
  env,
  flatError,
  logs,
  readSse,
  resetWorld,
  scenario,
  USERS,
} from './harness.js'

const M = USERS.member
const rowsOf = (sessionId: string) => db.rows('ai_messages').filter((m) => m.session_id === sessionId)
const kinds = (sessionId: string) => rowsOf(sessionId).map((m) => m.turn_kind)
const blocks = (content: unknown, type: string) =>
  Array.isArray(content) ? content.filter((b) => b?.type === type) : []

describe('POST /chat stream', () => {
  scenario(
    'C01 ": ready" first, session second, every event: line equals its data.type, headers set',
    async () => {
      anthropic.script(answer('Bok!'))
      const res = await call('/chat', { session_id: null, message: 'Hej' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
      expect(res.headers.get('cache-control')).toBe('no-cache, no-transform')
      expect(res.headers.get('x-accel-buffering')).toBe('no')
      const sse = await readSse(res)
      expect(sse.comments[0]).toBe('ready')
      expect(sse.raw.startsWith(': ready\n\n')).toBe(true)
      expect(sse.events[0]!.data.type).toBe('session')
      for (const e of sse.events) expect(e.event).toBe(e.data.type)
    },
  )

  scenario(
    'C02 a plain answer: deltas, then turn with the row id, then done; rows [user, assistant]',
    async () => {
      anthropic.script(answer('Bok! Kako mogu pomoći?'))
      const sse = await chat({ session_id: null, message: 'Hej' })
      const sessionId = sse.events[0]!.data.session_id as string
      const deltas = sse.events.filter((e) => e.data.type === 'delta').map((e) => e.data.text)
      expect(deltas.length).toBeGreaterThan(1)
      expect(deltas.join('')).toBe('Bok! Kako mogu pomoći?')
      const rows = rowsOf(sessionId)
      expect(kinds(sessionId)).toEqual(['user', 'assistant'])
      expect(sse.types.filter((t) => t !== 'delta')).toEqual(['session', 'turn', 'done'])
      expect(sse.events.find((e) => e.data.type === 'turn')!.data).toEqual({
        type: 'turn',
        role: 'assistant',
        text: 'Bok! Kako mogu pomoći?',
        message_id: rows[1]!.id,
      })
      expect(sse.events.at(-1)!.data).toEqual({
        type: 'done',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 20 },
      })
      expect(rows[0]).toMatchObject({
        turn_kind: 'user',
        parent_id: null,
        content: [{ type: 'text', text: 'Hej' }],
      })
    },
  )

  scenario(
    'C03 the route context is prepended in memory only, never persisted; a bad route adds nothing',
    async () => {
      anthropic.script(answer('ok'), answer('ok'))
      const sse = await chat({
        session_id: null,
        message: 'Što je ovo?',
        client_context: { route: '/items/5?x=1' },
      })
      const sent = anthropic.calls[0]!.body.messages.at(-1)!.content as Array<{ text: string }>
      expect(sent[0]!.text).toBe(`${contextLine('/items/5')}\n\nŠto je ovo?`)
      const row = rowsOf(sse.events[0]!.data.session_id as string)[0]!
      expect(row.content).toEqual([{ type: 'text', text: 'Što je ovo?' }])
      await chat({ session_id: null, message: 'x', client_context: { route: 'javascript:alert(1)' } })
      expect((anthropic.calls[1]!.body.messages.at(-1)!.content as Array<{ text: string }>)[0]!.text).toBe(
        'x',
      )
    },
  )

  scenario(
    "C04 one tool round trip through the user's JWT: tool_call, tool_result after its row, four rows",
    async () => {
      anthropic.script(callTools(toolUse('search_items', { query: 'stol' })), answer('Tri stavke.'))
      const sse = await chat({ session_id: null, message: 'Koji stolovi postoje?' })
      const sessionId = sse.events[0]!.data.session_id as string
      expect(sse.types.filter((t) => t !== 'delta')).toEqual([
        'session',
        'tool_call',
        'tool_result',
        'turn',
        'done',
      ])
      const result = sse.events.find((e) => e.data.type === 'tool_result')!.data
      expect(result).toMatchObject({ tool: 'search_items', is_error: false, output: { total: 3 } })
      expect(kinds(sessionId)).toEqual(['user', 'assistant', 'tool_result', 'assistant'])
      const read = db.requestsTo('demo_items', 'GET')[0]!
      expect(read.headers.get('authorization')).toBe('Bearer tok-member')
    },
  )

  it('C05 the 90 s request timeout: keepalives every 15 s, then error(request_timeout), rows [user]', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      resetWorld()
      anthropic.script({ hangUntilAborted: true })
      const res = await call('/chat', { session_id: null, message: 'x' })
      const reading = readSse(res, 0)
      await vi.advanceTimersByTimeAsync(90_000)
      const sse = await reading
      expect(sse.comments[0]).toBe('ready')
      expect(sse.comments.filter((c) => c === 'keepalive').length).toBeGreaterThanOrEqual(5)
      expect(sse.events.map((e) => e.data.type)).toEqual(['session', 'error'])
      expect(sse.events[1]!.data).toMatchObject({ code: 'request_timeout' })
      expect(kinds(sse.events[0]!.data.session_id as string)).toEqual(['user'])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  scenario(
    'C06 a client abort mid model call: no further rows, no event, one client disconnect log line',
    async () => {
      anthropic.script({ hangUntilAborted: true })
      const controller = new AbortController()
      anthropic.onRequest(() => controller.abort())
      const res = await call('/chat', { session_id: null, message: 'x' }, { signal: controller.signal })
      const sse = await readSse(res)
      expect(sse.events.map((e) => e.data.type)).toEqual(['session'])
      expect(kinds(sse.events[0]!.data.session_id as string)).toEqual(['user'])
      const lines = logs.filter((l) => l.line.includes('"event":"client disconnect"'))
      expect(lines).toHaveLength(1)
      expect(lines[0]!.line).toContain('req.signal')
    },
  )

  scenario(
    'C07 an abort during dispatch: a synthetic tool_result row is persisted and the stream closes cleanly',
    async () => {
      anthropic.script(callTools(toolUse('search_items', { query: 'stol' })))
      const controller = new AbortController()
      db.onRequest((r) => {
        if (r.table === 'demo_items') controller.abort()
      })
      const res = await call('/chat', { session_id: null, message: 'x' }, { signal: controller.signal })
      const sse = await readSse(res)
      expect(sse.events.map((e) => e.data.type)).toEqual(['session', 'tool_call'])
      const sessionId = sse.events[0]!.data.session_id as string
      expect(kinds(sessionId)).toEqual(['user', 'assistant', 'tool_result'])
      const block = blocks(rowsOf(sessionId)[2]!.content, 'tool_result')[0]
      expect(block).toMatchObject({ is_error: true })
      expect(String(block.content)).toContain('cancelled')
    },
  )

  scenario('C08 a persistence failure is an error(persistence_error) event and the stream ends', async () => {
    db.fault(
      (r) =>
        r.table === 'ai_messages' &&
        r.method === 'POST' &&
        (r.body as { turn_kind: string }).turn_kind === 'assistant',
      { status: 500 },
    )
    anthropic.script(answer('izgubljeno'))
    const sse = await chat({ session_id: null, message: 'x' })
    expect(sse.types.filter((t) => t !== 'delta')).toEqual(['session', 'error'])
    expect(sse.events.at(-1)!.data).toMatchObject({ code: 'persistence_error' })
    expect(kinds(sse.events[0]!.data.session_id as string)).toEqual(['user'])
  })

  scenario('C09 the title is backfilled from the opening message on a new session only', async () => {
    anthropic.script(answer('ok'), answer('ok'))
    const long = 'Ovo je vrlo dugačka prva poruka koja ima više od šezdeset znakova u sebi, sigurno.'
    const sse = await chat({ session_id: null, message: long })
    const created = db.rows('ai_sessions').find((s) => s.id === sse.events[0]!.data.session_id)!
    expect(created.title).toBe(long.slice(0, 60).trim())
    await chat({ session_id: SESSION_MEMBER_CHAT, message: 'nastavak' })
    expect(db.rows('ai_sessions').find((s) => s.id === SESSION_MEMBER_CHAT)!.title).toBe('Probni razgovor')
  })

  scenario('C10 a follow-up replays root → leaf and chains the new user row off the leaf', async () => {
    anthropic.script(answer('ok'))
    await chat({ session_id: SESSION_MEMBER_CHAT, message: 'nastavak' })
    const sent = anthropic.calls[0]!.body.messages
    expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'user'])
    expect((sent[3]!.content as Array<{ text: string }>)[0]!.text).toBe('nastavak')
    const newRow = rowsOf(SESSION_MEMBER_CHAT).find((m) => m.turn_kind === 'user' && m.id !== MSG_USER)!
    expect(newRow.parent_id).toBe(MSG_TOOL_RESULT)
    expect(anthropic.rejections).toEqual([])
  })

  scenario(
    'C11 a parent_message_id chains the new user row off that row and replays only its chain',
    async () => {
      anthropic.script(answer('ok'))
      await chat({ session_id: SESSION_MEMBER_CHAT, message: 'grana', parent_message_id: MSG_USER })
      const sent = anthropic.calls[0]!.body.messages
      expect(sent.map((m) => m.role)).toEqual(['user', 'user'])
      const newRow = rowsOf(SESSION_MEMBER_CHAT).find((m) => m.turn_kind === 'user' && m.id !== MSG_USER)!
      expect(newRow.parent_id).toBe(MSG_USER)
      const history = db.requests.find((r) => r.service === 'rpc' && r.table === 'ai_session_history')!
      expect(history.body).toEqual({ p_leaf_id: MSG_USER, p_max_rows: 200 })
    },
  )

  scenario(
    'C12 the model request carries the chat settings: Opus 5.5, no thinking, effort from env, fallbacks with the beta, three system blocks',
    async () => {
      anthropic.script(answer('ok'), answer('ok'))
      await chat({ session_id: null, message: 'x' })
      const call0 = anthropic.calls[0]!
      expect(call0.body).toMatchObject({
        model: 'claude-opus-5-5',
        max_tokens: 8192,
        output_config: { effort: 'medium' },
        fallbacks: 'default',
      })
      expect(call0.body).not.toHaveProperty('thinking')
      expect(call0.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
      const system = call0.body.system as Array<{ text: string; cache_control?: unknown }>
      expect(system).toHaveLength(3)
      expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' })
      expect(system[1]!.text).toContain(M.email)
      expect(system[2]!.text).toMatch(/^Danas je .*2026\.$/)
      expect(call0.body.tools!.map((t) => t.name)).toEqual(['create_note', 'get_item', 'search_items'])
      const tuned = buildApp({ env: { ...env, AI_CHAT_EFFORT: 'high' } })
      await chat({ session_id: null, message: 'x' }, { app: tuned })
      expect(anthropic.calls[1]!.body).toMatchObject({ output_config: { effort: 'high' } })
    },
  )

  scenario(
    'C13 an unanswered tool_use left by a crashed turn is repaired before the model is called',
    async () => {
      const dangling = '00000000-0000-4000-8000-000000000404'
      db.seed('ai_messages', [
        {
          id: dangling,
          session_id: SESSION_MEMBER_CHAT,
          role: 'assistant',
          turn_kind: 'assistant',
          content: [text('Gledam.'), toolUse('search_items', { query: 'x' })],
          parent_id: MSG_TOOL_RESULT,
          stop_reason: 'tool_use',
        },
      ])
      anthropic.script(answer('Nastavljam.'))
      const sse = await chat({ session_id: SESSION_MEMBER_CHAT, message: 'nastavi' })
      expect(anthropic.rejections).toEqual([])
      const sent = anthropic.calls[0]!.body.messages
      expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'user'])
      expect(blocks(sent[4]!.content, 'tool_result')[0]).toMatchObject({ is_error: true })
      expect(sse.types).toContain('done')
      expect(rowsOf(SESSION_MEMBER_CHAT).filter((m) => m.turn_kind === 'tool_result')).toHaveLength(1)
    },
  )

  scenario('C14 a truncated tool call ends with the explanation turn and done', async () => {
    anthropic.script({ content: [toolUse('search_items', { query: 'x' })], stop_reason: 'max_tokens' })
    const sse = await chat({ session_id: null, message: 'x' })
    expect(sse.types).toEqual(['session', 'tool_call', 'tool_result', 'turn', 'done'])
    expect(sse.events[3]!.data.text).toBe(TRUNCATED_HR)
    expect(await flatError(await call('/nowhere'))).toMatchObject({ status: 404, code: 'not_found' })
  })
})
