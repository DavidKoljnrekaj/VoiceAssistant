// The services the PWA talks to, answered in memory over `globalThis.fetch`: GoTrue (password and
// refresh grants, `/user`, `/logout`), PostgREST (`eq.` filters, `order`, `offset`/`limit`, PATCH
// with `return=representation`) and the API (`/chat` as SSE, the session mutations). The real
// supabase-js and the real `lib/api.ts` run on top (the rule: fakes stand in for the services,
// never for the SDKs). Every request is recorded so tests assert on what was sent.
import { env } from '../lib/env'
import { supabase } from '../lib/supabase'

export interface RecordedRequest {
  method: string
  url: URL
  headers: Headers
  body: unknown
  keepalive: boolean
}

export type RouteHandler = (req: RecordedRequest) => Response | Promise<Response>

export interface FakeBackend {
  requests: RecordedRequest[]
  /** Registers a handler; the newest registration for a matching prefix wins. */
  route(method: string, origin: string, pathPrefix: string, handler: RouteHandler): void
  /** Requests whose path (on any origin) starts with `prefix`. */
  sent(method: string, prefix: string): RecordedRequest[]
  restore(): void
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

/** A flat API error envelope, as `docs/API.md` → Errors states it. */
export const apiError = (status: number, code: string, message: string): Response =>
  json({ error: { code, message } }, status)

async function record(input: RequestInfo | URL, init: RequestInit | undefined): Promise<RecordedRequest> {
  const request = input instanceof Request ? input : new Request(input, init)
  const text = await request.clone().text()
  let body: unknown = text
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      /* not JSON: kept as text */
    }
  }
  return {
    method: request.method,
    url: new URL(request.url),
    headers: request.headers,
    body: text.length === 0 ? null : body,
    keepalive: init?.keepalive === true || (input instanceof Request && input.keepalive),
  }
}

/** Like a real `fetch`: an abort while the body is being read errors the body with AbortError. */
function abortable(response: Response, signal: AbortSignal | undefined): Response {
  if (!signal || !response.body) return response
  const reader = response.body.getReader()
  const abortError = () => new DOMException('The operation was aborted.', 'AbortError')
  let settled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      return new Promise<void>((resolve) => {
        const onAbort = () => {
          if (!settled) {
            settled = true
            controller.error(abortError())
          }
          void reader.cancel().catch(() => {})
          resolve()
        }
        if (signal.aborted) return onAbort()
        signal.addEventListener('abort', onAbort, { once: true })
        reader.read().then(
          ({ done, value }) => {
            signal.removeEventListener('abort', onAbort)
            if (settled) return resolve()
            if (done) {
              settled = true
              controller.close()
            } else controller.enqueue(value)
            resolve()
          },
          (error: unknown) => {
            signal.removeEventListener('abort', onAbort)
            if (!settled) {
              settled = true
              controller.error(error)
            }
            resolve()
          },
        )
      })
    },
    cancel: () => reader.cancel().catch(() => {}),
  })
  return new Response(body, { status: response.status, headers: response.headers })
}

/** Replaces `globalThis.fetch` with a router. Unrouted requests answer 404 with the path in the body. */
export function installFakeBackend(): FakeBackend {
  const original = globalThis.fetch
  const routes: { method: string; origin: string; prefix: string; handler: RouteHandler }[] = []
  const requests: RecordedRequest[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = await record(input, init)
    requests.push(req)
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    for (let i = routes.length - 1; i >= 0; i--) {
      const r = routes[i]!
      if (r.method === req.method && r.origin === req.url.origin && req.url.pathname.startsWith(r.prefix)) {
        return abortable(await r.handler(req), init?.signal ?? undefined)
      }
    }
    return new Response(`no fake route for ${req.method} ${req.url.pathname}`, { status: 404 })
  }) as typeof fetch
  return {
    requests,
    route: (method, origin, prefix, handler) => {
      routes.push({ method, origin, prefix, handler })
    },
    sent: (method, prefix) =>
      requests.filter((r) => r.method === method && r.url.pathname.startsWith(prefix)),
    restore: () => {
      globalThis.fetch = original
    },
  }
}

// ---------------------------------------------------------------------------------------------
// GoTrue
// ---------------------------------------------------------------------------------------------

const b64url = (s: string): string => Buffer.from(s).toString('base64url')

/** An unsigned JWT with the given claims; supabase-js only decodes `exp`, it never verifies. */
export function fakeJwt(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.sig`
}

export interface FakeAuthUser {
  id: string
  email: string
}

export interface FakeGoTrue {
  user: FakeAuthUser
  /** How many access tokens were minted (sign-in plus every refresh). */
  tokens: string[]
}

/** Answers the password and refresh grants, `/user` and `/logout` for one user. */
export function fakeGoTrue(backend: FakeBackend, user: FakeAuthUser): FakeGoTrue {
  const origin = new URL(env.VITE_SUPABASE_URL).origin
  const state: FakeGoTrue = { user, tokens: [] }
  const authUser = () => ({
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  })
  const session = () => {
    const token = fakeJwt({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })
    state.tokens.push(token)
    return {
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: `refresh-${state.tokens.length}`,
      user: authUser(),
    }
  }
  backend.route('POST', origin, '/auth/v1/token', (req) => {
    const grant = req.url.searchParams.get('grant_type')
    if (grant === 'password' || grant === 'refresh_token') return json(session())
    return json({ error: 'unsupported_grant_type' }, 400)
  })
  backend.route('GET', origin, '/auth/v1/user', () => json(authUser()))
  backend.route('POST', origin, '/auth/v1/logout', () => new Response(null, { status: 204 }))
  return state
}

/** Routes GoTrue for `user` and signs the real client in, so `lib/api.ts` has a bearer token. */
export async function signInTestUser(backend: FakeBackend, user: FakeAuthUser): Promise<FakeGoTrue> {
  const gotrue = fakeGoTrue(backend, user)
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: 'pw' })
  if (error) throw error
  return gotrue
}

/** Forgets the client's session without a request (the fake backend may already be gone). */
export async function signOutTestUser(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
}

// ---------------------------------------------------------------------------------------------
// PostgREST
// ---------------------------------------------------------------------------------------------

export type Row = Record<string, unknown>

export interface FakeTable {
  rows: Row[]
  /** Makes the next read of this table answer with this status and body. */
  failNext(status: number, body?: unknown): void
}

function applyFilters(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows
  for (const [key, value] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(key)) continue
    const [op, ...rest] = value.split('.')
    const operand = rest.join('.')
    if (op === 'eq') out = out.filter((r) => String(r[key]) === operand)
    else throw new Error(`fake PostgREST: unsupported filter ${key}=${value}`)
  }
  return out
}

function applyOrder(rows: Row[], order: string | null): Row[] {
  if (!order) return rows
  const terms = order.split(',').map((t) => {
    const [column, direction] = t.split('.')
    return { column: column!, desc: direction === 'desc' }
  })
  return rows.slice().sort((a, b) => {
    for (const { column, desc } of terms) {
      const x = String(a[column]),
        y = String(b[column])
      if (x === y) continue
      return (x < y ? -1 : 1) * (desc ? -1 : 1)
    }
    return 0
  })
}

function project(row: Row, select: string | null): Row {
  if (!select || select === '*') return row
  const out: Row = {}
  for (const column of select.split(',')) out[column.trim()] = row[column.trim()]
  return out
}

/**
 * One table. Reads honour `eq.` filters, `order`, `offset`/`limit` and the project's `max_rows`
 * cap of 1000 (`supabase/config.toml`); a PATCH updates the filtered rows and returns them.
 */
export function fakeTable(backend: FakeBackend, name: string, rows: Row[] = []): FakeTable {
  const origin = new URL(env.VITE_SUPABASE_URL).origin
  const table: FakeTable = {
    rows,
    failNext: (status, body) => {
      pendingFailure = { status, body: body ?? { message: 'injected failure', code: 'XX000' } }
    },
  }
  let pendingFailure: { status: number; body: unknown } | null = null
  const path = `/rest/v1/${name}`
  const exact = (req: RecordedRequest) => req.url.pathname === path
  backend.route('GET', origin, path, (req) => {
    if (!exact(req)) return new Response('not found', { status: 404 })
    if (pendingFailure) {
      const f = pendingFailure
      pendingFailure = null
      return json(f.body, f.status)
    }
    const params = req.url.searchParams
    const matched = applyOrder(applyFilters(table.rows, params), params.get('order'))
    const offset = Number(params.get('offset') ?? 0)
    const limit = Math.min(params.get('limit') !== null ? Number(params.get('limit')) : Infinity, 1000)
    const page = matched.slice(offset, offset + limit).map((r) => project(r, params.get('select')))
    return json(page, 200, { 'Content-Range': `${offset}-${offset + page.length - 1}/*` })
  })
  backend.route('PATCH', origin, path, (req) => {
    if (!exact(req)) return new Response('not found', { status: 404 })
    if (pendingFailure) {
      const f = pendingFailure
      pendingFailure = null
      return json(f.body, f.status)
    }
    const patch = req.body as Row
    const matched = applyFilters(table.rows, req.url.searchParams)
    for (const row of matched) Object.assign(row, patch)
    return json(
      matched.map((r) => project(r, req.url.searchParams.get('select'))),
      200,
    )
  })
  return table
}

// ---------------------------------------------------------------------------------------------
// The API's SSE stream
// ---------------------------------------------------------------------------------------------

export interface SseStream {
  response: Response
  /** Writes one frame (`event:` + `data:`) for an event object, as the API does. */
  send(event: { type: string } & Record<string, unknown>): void
  /** Writes a comment frame (`: keepalive`). */
  comment(text: string): void
  close(): void
}

/** A `text/event-stream` response the test feeds frame by frame; `: ready` is written first. */
export function openSse(): SseStream {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      c.enqueue(encoder.encode(': ready\n\n'))
    },
  })
  let closed = false
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    send: (event) => {
      if (closed) return
      controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
    },
    comment: (text) => {
      if (closed) return
      controller.enqueue(encoder.encode(`: ${text}\n\n`))
    },
    close: () => {
      if (closed) return
      closed = true
      controller.close()
    },
  }
}

/** A whole stream at once: `: ready`, every event, then the end of the body. */
export function sseResponse(events: ({ type: string } & Record<string, unknown>)[]): Response {
  const stream = openSse()
  for (const event of events) stream.send(event)
  stream.close()
  return stream.response
}

export const API_ORIGIN = new URL(env.VITE_API_URL).origin
export const SUPABASE_ORIGIN = new URL(env.VITE_SUPABASE_URL).origin
