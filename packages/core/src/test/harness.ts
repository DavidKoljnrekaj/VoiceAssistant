// Routes the engine to the two fakes, in-process. Importing this module sets the Supabase env
// for `@va/db`, routes `globalThis.fetch` for the fake hosts and captures console output into
// `logs`. Set VA_TEST_LOGS=1 to see the log lines live.
import { inspect } from 'node:util'

import Anthropic from '@anthropic-ai/sdk'
import { it } from 'vitest'

import { resetDbEnvCache } from '@va/db'

import { authenticateToken, type AuthContext } from '../auth.js'
import { FakeAnthropic } from './fake-anthropic.js'
import { FakeSupabase, type RecordedRequest } from './fake-supabase.js'
import { ANON_KEY, SERVICE_ROLE_KEY, seedWorld, TOKENS } from './fixtures.js'

export const ANTHROPIC_BASE_URL = 'http://fake-anthropic.test'
export const SUPABASE_URL = 'http://fake-supabase.test'

export const anthropic = new FakeAnthropic()
export const db = new FakeSupabase()

process.env.SUPABASE_URL = SUPABASE_URL
process.env.SUPABASE_ANON_KEY = ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY
process.env.ANTHROPIC_API_KEY = 'sk-ant-fake'
process.env.ANTHROPIC_BASE_URL = ANTHROPIC_BASE_URL
for (const k of ['AI_CHAT_MODEL', 'AI_CHAT_EFFORT', 'AI_VOICE_MODEL', 'AI_VOICE_EFFORT'])
  delete process.env[k]
resetDbEnvCache()

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init)
  const host = new URL(req.url).host
  if (host === 'fake-anthropic.test') return await anthropic.handle(req, init?.signal ?? req.signal)
  if (host === 'fake-supabase.test') return await db.handle(req, init?.signal ?? req.signal)
  return await realFetch(input, init)
}) as typeof fetch

export interface LogLine {
  level: string
  line: string
}
export const logs: LogLine[] = []
const passthrough = process.env.VA_TEST_LOGS === '1'
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[level].bind(console)
  console[level] = (...args: unknown[]) => {
    logs.push({
      level,
      line: args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 5 }))).join(' '),
    })
    if (passthrough) original(...args)
  }
}

/** Fresh fakes, seeded world. `scenario` calls it; call it yourself in a plain `it`. */
export function reset(): void {
  anthropic.reset()
  db.reset()
  logs.length = 0
  seedWorld(db)
}

/**
 * Declare a scenario. It starts from a freshly seeded world and must consume exactly the model
 * turns it scripted: an unscripted call, or a scripted turn left unused, fails the test.
 */
export function scenario(
  name: string,
  fn: () => Promise<void>,
  opts: { allowLeftoverTurns?: boolean } = {},
): void {
  it(name, async () => {
    reset()
    await fn()
    if (anthropic.unexpectedCalls > 0)
      throw new Error(`${anthropic.unexpectedCalls} unscripted Anthropic call(s)`)
    if (!opts.allowLeftoverTurns && anthropic.remaining > 0) {
      throw new Error(`${anthropic.remaining} scripted Anthropic turn(s) never requested`)
    }
  })
}

/** A real SDK client pointed at the fake. */
export function anthropicClient(options: { timeout?: number; maxRetries?: number } = {}): Anthropic {
  return new Anthropic({ apiKey: 'sk-ant-fake', baseURL: ANTHROPIC_BASE_URL, maxRetries: 0, ...options })
}

/** The identity of a seeded user, through the real `authenticateToken` and the fakes. */
export async function authAs(who: keyof typeof TOKENS): Promise<AuthContext> {
  const result = await authenticateToken(TOKENS[who])
  if ('error' in result) throw new Error(`harness: authAs(${who}) failed with ${result.error.code}`)
  return result
}

/** Which Supabase client made a request: the service role, or a user's JWT. */
export function clientOf(r: RecordedRequest): 'service' | 'user' | 'anon' {
  const auth = (r.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (auth === SERVICE_ROLE_KEY) return 'service'
  if (auth === ANON_KEY || !auth) return 'anon'
  return 'user'
}

export function sessionMessages(sessionId: string): Record<string, unknown>[] {
  return db.rows('ai_messages').filter((m) => m.session_id === sessionId)
}

interface AnyBlock {
  type: string
  [k: string]: unknown
}

/** Every block of a given type in a content array. */
export function blocksOf(content: unknown, type: string): AnyBlock[] {
  return Array.isArray(content) ? (content as AnyBlock[]).filter((b) => b?.type === type) : []
}

/** The `tool_result` payload the model was sent for a tool_use id, parsed. */
export function toolResultSentToModel(callIndex: number, toolUseId: string): unknown {
  const call = anthropic.calls[callIndex]
  if (!call) throw new Error(`harness: no Anthropic call at index ${callIndex}`)
  for (const m of call.body.messages) {
    for (const b of blocksOf(m.content, 'tool_result')) {
      if (b.tool_use_id === toolUseId) return JSON.parse(b.content as string)
    }
  }
  throw new Error(`harness: no tool_result for ${toolUseId} in call ${callIndex}`)
}
