// A stand-in for Microsoft Graph v1.0 over `fetch`, like the Anthropic fake: it answers the
// routes a test registers, records every request (method, path, query, headers, body) and
// injects the faults Graph really produces: 429 with Retry-After, 401 with
// `InvalidAuthenticationToken`, 5xx. It fakes the service, not a client library. Any host
// other than graph.microsoft.com is an error, never the network. The mail routes the tools
// use arrive with them (13b).

export interface GraphCall {
  method: string
  path: string
  query: URLSearchParams
  headers: Headers
  body: unknown
}

export type GraphReply = { status?: number; body?: unknown; headers?: Record<string, string> }
type Handler = (call: GraphCall) => GraphReply

export type GraphFault =
  { status: 429; retryAfter?: string } | { status: 401 } | { status: number; code?: string } | { hang: true }

export class FakeGraph {
  calls: GraphCall[] = []
  /** Requests for a route nobody registered, or to another host. */
  unexpectedCalls = 0
  /** Access tokens Graph accepts; empty means any bearer token. */
  validTokens = new Set<string>()
  private routes: Array<{ method: string; path: string | RegExp; handler: Handler }> = []
  private faults: Array<{ match: (c: GraphCall) => boolean; fault: GraphFault; remaining: number }> = []

  reset(): void {
    this.calls = []
    this.unexpectedCalls = 0
    this.validTokens.clear()
    this.routes = []
    this.faults = []
  }

  /** The `fetch` the code under test is given. */
  readonly fetch: typeof fetch = (input, init) =>
    this.handle(new Request(input, init), init?.signal ?? undefined)

  route(method: string, path: string | RegExp, handler: Handler | GraphReply): void {
    this.routes.push({ method, path, handler: typeof handler === 'function' ? handler : () => handler })
  }

  fault(match: (c: GraphCall) => boolean, fault: GraphFault, times = 1): void {
    this.faults.push({ match, fault, remaining: times })
  }

  private async handle(req: Request, signal: AbortSignal | undefined): Promise<Response> {
    const url = new URL(req.url)
    const text = req.method === 'GET' ? '' : await req.text()
    const call: GraphCall = {
      method: req.method,
      path: url.pathname.replace(/^\/v1\.0/, ''),
      query: url.searchParams,
      headers: req.headers,
      body: text ? JSON.parse(text) : undefined,
    }
    this.calls.push(call)
    if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/')) {
      this.unexpectedCalls++
      return graphError(404, 'fake-graph: unknown host or version')
    }
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
    const f = this.faults.find((x) => x.remaining > 0 && x.match(call))
    if (f) {
      f.remaining--
      const fault = f.fault
      if ('hang' in fault)
        return await new Promise<Response>((_, reject) => {
          const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
          if (signal?.aborted) abort()
          signal?.addEventListener('abort', abort, { once: true })
        })
      if (fault.status === 429)
        return graphError(429, 'TooManyRequests', {
          'Retry-After': 'retryAfter' in fault && fault.retryAfter !== undefined ? fault.retryAfter : '1',
        })
      if (fault.status === 401) return graphError(401, 'InvalidAuthenticationToken')
      return graphError(fault.status, ('code' in fault && fault.code) || 'generalException')
    }
    if (!token || (this.validTokens.size > 0 && !this.validTokens.has(token)))
      return graphError(401, 'InvalidAuthenticationToken')
    const r = this.routes.find(
      (x) =>
        x.method === req.method &&
        (typeof x.path === 'string' ? x.path === call.path : x.path.test(call.path)),
    )
    if (!r) {
      this.unexpectedCalls++
      return graphError(404, 'fake-graph: no route')
    }
    const reply = r.handler(call)
    const status = reply.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status,
      headers: {
        'content-type': 'application/json',
        'request-id': `req-${this.calls.length}`,
        ...reply.headers,
      },
    })
  }
}

function graphError(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message: `fake-graph: ${code}` } }), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req-error', ...headers },
  })
}
