// The chat services against the fake backend (src/test/fake-backend.ts): PostgREST for the two
// reads, the API for the stream and the mutations. The real supabase-js and lib/api.ts run; the
// assertions are on the requests sent and on what the service returns or throws.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { supabase } from '../../../lib/supabase'
import {
  API_ORIGIN,
  apiError,
  type FakeBackend,
  type FakeGoTrue,
  fakeGoTrue,
  fakeTable,
  installFakeBackend,
  json,
  openSse,
  type Row,
  sseResponse,
} from '../../../test/fake-backend'
import { ApiHttpError, type ChatEvent } from '../../../types/api'
import {
  deleteSession,
  findSession,
  listSessions,
  loadSession,
  renameSession,
  streamMessage,
} from './chatService'

const S1 = '11111111-1111-4111-8111-111111111111'

let backend: FakeBackend
let gotrue: FakeGoTrue

const session = (id: string, channel: string, updatedAt: string): Row => ({
  id,
  user_id: 'user-1',
  title: null,
  channel,
  created_at: updatedAt,
  updated_at: updatedAt,
  context_summary: null,
  summary_through_message_id: null,
})

const message = (id: string, parentId: string | null, createdAt: string, role = 'user'): Row => ({
  id,
  session_id: S1,
  role,
  turn_kind: role,
  content: [{ type: 'text', text: id }],
  parent_id: parentId,
  created_at: createdAt,
  stop_reason: null,
  model: null,
})

beforeAll(async () => {
  backend = installFakeBackend()
  gotrue = fakeGoTrue(backend, { id: 'auth-1', email: 'ana@example.com' })
  await supabase.auth.signInWithPassword({ email: 'ana@example.com', password: 'pw' })
})
beforeEach(() => {
  backend.requests.length = 0
})
afterEach(() => {
  /* routes registered by a test are shadowed by the next test's registrations */
})
afterAll(async () => {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  backend.restore()
})

describe('chatService reads', () => {
  it('C01: listSessions reads the chat sessions newest first, as the user', async () => {
    fakeTable(backend, 'ai_sessions', [
      session('s-old', 'chat', '2026-10-01T00:00:00Z'),
      session('s-voice', 'voice', '2026-10-03T00:00:00Z'),
      session('s-new', 'chat', '2026-10-02T00:00:00Z'),
    ])
    const rows = await listSessions()
    expect(rows.map((r) => r.id)).toEqual(['s-new', 's-old'])
    const [request] = backend.sent('GET', '/rest/v1/ai_sessions')
    expect(request?.url.searchParams.get('channel')).toBe('eq.chat')
    expect(request?.url.searchParams.get('order')).toMatch(/^updated_at\.desc/)
    expect(request?.headers.get('authorization')).toBe(`Bearer ${gotrue.tokens[0]}`)
    expect(request?.headers.get('apikey')).toBe('test-anon-key')
  })

  it('C02: loadSession reads the session rows oldest first, and a failed read throws', async () => {
    const table = fakeTable(backend, 'ai_messages', [
      message('m2', 'm1', '2026-10-01T00:00:02Z', 'assistant'),
      message('m1', null, '2026-10-01T00:00:01Z'),
      { ...message('other', null, '2026-10-01T00:00:00Z'), session_id: 'another' },
    ])
    const rows = await loadSession(S1)
    expect(rows.map((r) => r.id)).toEqual(['m1', 'm2'])
    const [request] = backend.sent('GET', '/rest/v1/ai_messages')
    expect(request?.url.searchParams.get('session_id')).toBe(`eq.${S1}`)
    expect(request?.url.searchParams.get('order')).toMatch(/^created_at\.asc/)

    table.failNext(500, { message: 'boom', code: 'XX000' })
    await expect(loadSession(S1)).rejects.toMatchObject({ code: 'XX000' })
  })
})

describe('chatService.findSession (WEB-7)', () => {
  it('WEB-7: reads one session by id and answers null when RLS shows none', async () => {
    fakeTable(backend, 'ai_sessions', [session(S1, 'chat', '2026-10-01T00:00:00Z')])
    const found = await findSession(S1)
    expect(found?.id).toBe(S1)
    const [request] = backend.sent('GET', '/rest/v1/ai_sessions')
    expect(request?.url.searchParams.get('id')).toBe(`eq.${S1}`)
    expect(request?.headers.get('authorization')).toBe(`Bearer ${gotrue.tokens[0]}`)
    expect(await findSession('22222222-2222-4222-8222-222222222222')).toBeNull()
  })
})

describe('chatService paging (WEB-6)', () => {
  const at = (i: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, 0) + i * 1000).toISOString()

  it('WEB-6: a conversation longer than one page is read whole, in a stable order, so the leaf is the newest row', async () => {
    const rows = Array.from({ length: 1203 }, (_, i) =>
      message(`m${String(i).padStart(4, '0')}`, i === 0 ? null : `m${String(i - 1).padStart(4, '0')}`, at(i)),
    )
    fakeTable(backend, 'ai_messages', rows)
    const loaded = await loadSession(S1)
    expect(loaded).toHaveLength(1203)
    expect(loaded.at(-1)?.id).toBe('m1202')
    const requests = backend.sent('GET', '/rest/v1/ai_messages')
    expect(requests.map((r) => r.url.searchParams.get('order'))).toEqual([
      'created_at.asc,id.asc',
      'created_at.asc,id.asc',
    ])
    expect(requests.map((r) => [r.url.searchParams.get('offset'), r.url.searchParams.get('limit')])).toEqual([
      ['0', '1000'],
      ['1000', '1000'],
    ])
  })

  it('WEB-6: the session list pages the same way, newest activity first', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) =>
      session(`s${String(i).padStart(4, '0')}`, 'chat', at(i)),
    )
    fakeTable(backend, 'ai_sessions', rows)
    const loaded = await listSessions()
    expect(loaded).toHaveLength(1001)
    expect(loaded[0]?.id).toBe('s1000')
    expect(loaded.at(-1)?.id).toBe('s0000')
    const requests = backend.sent('GET', '/rest/v1/ai_sessions')
    expect(requests.map((r) => r.url.searchParams.get('order'))).toEqual([
      'updated_at.desc,id.desc',
      'updated_at.desc,id.desc',
    ])
    expect(requests.map((r) => r.url.searchParams.get('offset'))).toEqual(['0', '1000'])
  })
})

describe('chatService mutations', () => {
  it('C03: rename and delete call the API with the session token; a 404 is an ApiHttpError', async () => {
    backend.route('PATCH', API_ORIGIN, '/sessions/', () => json({ ok: true }))
    backend.route('DELETE', API_ORIGIN, '/sessions/', () =>
      apiError(404, 'session_not_found', 'Razgovor nije pronađen.'),
    )
    await renameSession(S1, 'Naslov')
    const [patch] = backend.sent('PATCH', `/sessions/${S1}`)
    expect(patch?.body).toEqual({ title: 'Naslov' })
    expect(patch?.headers.get('authorization')).toBe(`Bearer ${gotrue.tokens[0]}`)
    expect(patch?.headers.get('content-type')).toBe('application/json')
    await expect(deleteSession(S1)).rejects.toMatchObject({
      name: 'ApiHttpError',
      status: 404,
      code: 'session_not_found',
    })
  })
})

describe('chatService.streamMessage', () => {
  it('C04: posts the turn and dispatches every known event, dropping unknown ones', async () => {
    backend.route('POST', API_ORIGIN, '/chat', () =>
      sseResponse([
        { type: 'session', session_id: S1 },
        { type: 'delta', text: 'Dobar dan' },
        { type: 'mystery', payload: 1 },
        { type: 'tool_call', tool: 'search_items', input: {}, tool_use_id: 'tu1' },
        { type: 'tool_result', tool: 'search_items', output: [], tool_use_id: 'tu1', is_error: false },
        { type: 'turn', role: 'assistant', text: 'Dobar dan', message_id: 'a1' },
        { type: 'done', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } },
      ]),
    )
    const events: ChatEvent[] = []
    await streamMessage({
      sessionId: S1,
      message: 'Bok',
      parentMessageId: 'u0',
      route: '/c/' + S1,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })
    const [post] = backend.sent('POST', '/chat')
    expect(post?.body).toEqual({
      session_id: S1,
      message: 'Bok',
      parent_message_id: 'u0',
      client_context: { route: '/c/' + S1 },
    })
    expect(post?.headers.get('authorization')).toBe(`Bearer ${gotrue.tokens[0]}`)
    expect(events.map((e) => e.type)).toEqual([
      'session',
      'delta',
      'tool_call',
      'tool_result',
      'turn',
      'done',
    ])
  })

  it('C05: a new conversation sends session_id null and no parent', async () => {
    backend.route('POST', API_ORIGIN, '/chat', () =>
      sseResponse([{ type: 'done', stop_reason: 'end_turn', usage: {} }]),
    )
    await streamMessage({
      sessionId: null,
      message: 'Bok',
      parentMessageId: null,
      route: null,
      signal: new AbortController().signal,
      onEvent: () => {},
    })
    expect(backend.sent('POST', '/chat')[0]?.body).toEqual({ session_id: null, message: 'Bok' })
  })

  it('C06: a pre-stream envelope is thrown as ApiHttpError before any event', async () => {
    backend.route('POST', API_ORIGIN, '/chat', () => apiError(429, 'rate_limited', 'Previše zahtjeva.'))
    const events: ChatEvent[] = []
    const failure = await streamMessage({
      sessionId: S1,
      message: 'Bok',
      parentMessageId: null,
      route: null,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ApiHttpError)
    expect(failure).toMatchObject({ status: 429, code: 'rate_limited', message: 'Previše zahtjeva.' })
    expect(events).toEqual([])
  })

  it('C07: a non-JSON failure body keeps the generic code and the status', async () => {
    backend.route(
      'POST',
      API_ORIGIN,
      '/chat',
      () => new Response('<html>Bad Gateway</html>', { status: 502 }),
    )
    const failure = await streamMessage({
      sessionId: S1,
      message: 'Bok',
      parentMessageId: null,
      route: null,
      signal: new AbortController().signal,
      onEvent: () => {},
    }).catch((e: unknown) => e)
    expect(failure).toMatchObject({
      name: 'ApiHttpError',
      status: 502,
      code: 'http_error',
      message: 'HTTP 502',
    })
  })

  it('C08: aborting the signal mid-stream rejects with AbortError after the events already read', async () => {
    const stream = openSse()
    backend.route('POST', API_ORIGIN, '/chat', () => stream.response)
    const controller = new AbortController()
    const events: ChatEvent[] = []
    const pending = streamMessage({
      sessionId: S1,
      message: 'Bok',
      parentMessageId: null,
      route: null,
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    })
    stream.send({ type: 'session', session_id: S1 })
    stream.send({ type: 'delta', text: 'Dobar' })
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()
    const failure = await pending.catch((e: unknown) => e)
    expect(failure).toMatchObject({ name: 'AbortError' })
    expect(events.map((e) => e.type)).toEqual(['session', 'delta'])
  })
})
