// The error catalogue and the SDK mapping, exercised with the real SDK against the fake API so
// the classes under test are the ones the loop will catch.
import { describe, expect, it } from 'vitest'

import { type ErrorCode, mapAnthropicError, MESSAGES_HR } from './errors.js'
import { anthropicClient, anthropic, reset } from './test/harness.js'

const REQUEST = {
  model: 'claude-opus-5-5',
  max_tokens: 64,
  messages: [{ role: 'user' as const, content: 'Bok' }],
}

async function failing(status: number, type: string): Promise<unknown> {
  reset()
  anthropic.script({ error: { status, type, message: 'scripted' } })
  return await anthropicClient()
    .messages.create(REQUEST)
    .then(() => undefined)
    .catch((e: unknown) => e)
}

describe('mapAnthropicError', () => {
  it.each([
    [429, 'rate_limit_error', 'model_rate_limited', false],
    [401, 'authentication_error', 'model_auth_failed', true],
    [400, 'invalid_request_error', 'model_bad_request', true],
    [500, 'api_error', 'model_error', true],
    [529, 'overloaded_error', 'model_rate_limited', false],
  ] as const)('X01: HTTP %i maps to %s', async (status, type, code, shouldLog) => {
    const err = await failing(status, type)
    expect(err).toBeInstanceOf(Error)
    expect(mapAnthropicError(err)).toEqual({ code, message: MESSAGES_HR[code], shouldLog })
  })

  it('X02: a connection failure maps to model_unreachable', async () => {
    reset()
    anthropic.script({ connectionError: true })
    const err = await anthropicClient()
      .messages.create(REQUEST)
      .catch((e: unknown) => e)
    expect(mapAnthropicError(err)).toMatchObject({ code: 'model_unreachable', shouldLog: false })
  })

  it('X03: a request timeout maps to model_timeout, checked before the connection error', async () => {
    reset()
    anthropic.script({ hangUntilAborted: true })
    const err = await anthropicClient({ timeout: 20 })
      .messages.create(REQUEST)
      .catch((e: unknown) => e)
    expect(mapAnthropicError(err)).toMatchObject({ code: 'model_timeout', shouldLog: false })
  })

  it('X04: anything else is model_error and logged', () => {
    expect(mapAnthropicError(new Error('boom'))).toEqual({
      code: 'model_error',
      message: MESSAGES_HR.model_error,
      shouldLog: true,
    })
  })

  it('X05: every code has a non-empty Croatian message', () => {
    const codes = Object.keys(MESSAGES_HR) as ErrorCode[]
    expect(codes).toHaveLength(19)
    for (const code of codes) expect(MESSAGES_HR[code].length).toBeGreaterThan(5)
  })
})
