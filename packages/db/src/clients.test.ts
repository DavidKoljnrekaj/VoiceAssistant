// The clients are asserted on the wire: a fake PostgREST answers globalThis.fetch and the test
// checks the request each client sends (.claude/rules/testing.md).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createServiceClient, createUserClient } from './clients.js'
import { resetDbEnvCache } from './env.js'

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54431',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
}

const requests: Request[] = []
const fakePostgrest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  requests.push(new Request(input, init))
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
})

describe('@va/db clients', () => {
  beforeEach(() => {
    Object.assign(process.env, env)
    resetDbEnvCache()
    requests.length = 0
    vi.stubGlobal('fetch', fakePostgrest)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetDbEnvCache()
    for (const key of Object.keys(env)) delete process.env[key]
  })

  it('createUserClient sends the anon key and the user JWT, so RLS applies', async () => {
    const { error } = await createUserClient('user-jwt').from('users').select('id')
    expect(error).toBeNull()
    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request!.url).toBe(`${env.SUPABASE_URL}/rest/v1/users?select=id`)
    expect(request!.headers.get('apikey')).toBe(env.SUPABASE_ANON_KEY)
    expect(request!.headers.get('authorization')).toBe('Bearer user-jwt')
  })

  it('createServiceClient sends the service role key as both apikey and bearer', async () => {
    await createServiceClient().from('ai_sessions').select('id').eq('user_id', 'u1')
    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request!.url).toBe(`${env.SUPABASE_URL}/rest/v1/ai_sessions?select=id&user_id=eq.u1`)
    expect(request!.headers.get('apikey')).toBe(env.SUPABASE_SERVICE_ROLE_KEY)
    expect(request!.headers.get('authorization')).toBe(`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`)
  })

  it('neither client holds a session: the JWT travels per request, nothing is stored', async () => {
    for (const client of [createUserClient('user-jwt'), createServiceClient()]) {
      await expect(client.auth.getSession()).resolves.toMatchObject({ data: { session: null } })
    }
    expect(requests).toHaveLength(0)
  })
})
