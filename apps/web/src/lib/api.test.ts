// `apiFetch` / `apiJson` against the fake backend: the Authorization header from the session, the
// JSON content type, the flat error envelope as ApiHttpError, and `unauthorized` without a request
// when nobody is signed in.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  API_ORIGIN,
  apiError,
  type FakeBackend,
  fakeGoTrue,
  installFakeBackend,
  json,
} from '../test/fake-backend'
import { apiFetch, apiJson } from './api'
import { supabase } from './supabase'

let backend: FakeBackend

beforeAll(() => {
  backend = installFakeBackend()
  fakeGoTrue(backend, { id: 'auth-1', email: 'ana@example.com' })
})
beforeEach(() => {
  backend.requests.length = 0
})
afterAll(async () => {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  backend.restore()
})

describe('lib/api', () => {
  it('P01: with no session the call fails as unauthorized and nothing is sent', async () => {
    const failure = await apiJson('/voice/sessions', { method: 'POST' }).catch((e: unknown) => e)
    expect(failure).toMatchObject({ name: 'ApiHttpError', status: 401, code: 'unauthorized' })
    expect(backend.sent('POST', '/voice/sessions')).toEqual([])
  })

  it('P02: a signed-in call carries the bearer token and a JSON content type, and apiJson parses the answer', async () => {
    const signedIn = await supabase.auth.signInWithPassword({ email: 'ana@example.com', password: 'pw' })
    backend.route('POST', API_ORIGIN, '/voice/sessions', () =>
      json({ url: 'wss://lk', token: 't', room: 'r', session_id: 's1' }),
    )
    const answer = await apiJson<{ session_id: string }>('/voice/sessions', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(answer.session_id).toBe('s1')
    const [request] = backend.sent('POST', '/voice/sessions')
    expect(request?.url.origin).toBe(API_ORIGIN)
    expect(request?.headers.get('authorization')).toBe(`Bearer ${signedIn.data.session?.access_token}`)
    expect(request?.headers.get('content-type')).toBe('application/json')
  })

  it('P03: a non-OK envelope is thrown as ApiHttpError with its status, code and message', async () => {
    backend.route('GET', API_ORIGIN, '/sessions/', () =>
      apiError(404, 'session_not_found', 'Razgovor nije pronađen.'),
    )
    const failure = await apiFetch('/sessions/x').catch((e: unknown) => e)
    expect(failure).toMatchObject({
      name: 'ApiHttpError',
      status: 404,
      code: 'session_not_found',
      message: 'Razgovor nije pronađen.',
    })
  })

  it('P04: a non-JSON failure body becomes http_error with the status in the message', async () => {
    backend.route('GET', API_ORIGIN, '/health', () => new Response('upstream timeout', { status: 504 }))
    const failure = await apiFetch('/health').catch((e: unknown) => e)
    expect(failure).toMatchObject({
      name: 'ApiHttpError',
      status: 504,
      code: 'http_error',
      message: 'HTTP 504',
    })
  })
})
