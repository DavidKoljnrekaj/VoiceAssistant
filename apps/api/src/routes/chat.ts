// POST /chat: the pre-stream pipeline under the pre-stream deadline, then the SSE stream. Every
// failure before the stream is a flat error with a real status; from `: ready` on, failures are
// `error` events.
import { Hono } from 'hono'

import { channelSettings, log } from '@va/core'

import { prepareChat } from '../chat/prepare.js'
import { streamChatResponse } from '../chat/stream.js'
import { PRE_STREAM_TIMEOUT_MS } from '../deadline.js'
import type { AppDeps, AppEnv } from '../deps.js'
import { fail } from '../errors.js'

export function chatRoute(deps: AppDeps): Hono<AppEnv> {
  const settings = channelSettings('chat', {
    AI_CHAT_MODEL: deps.env.AI_CHAT_MODEL,
    AI_CHAT_EFFORT: deps.env.AI_CHAT_EFFORT,
  })
  return new Hono<AppEnv>().post('/chat', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return fail(c, 'bad_request')
    }
    const started = performance.now()
    const ctx = c.get('ctx')
    const requestId = c.get('requestId')
    // Auth and prepare share the pre-stream budget; every prepare query carries the signal, so a
    // hung PostgREST request is released rather than raced.
    const budgetMs = Math.max(PRE_STREAM_TIMEOUT_MS - c.get('authMs'), 1)
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), budgetMs)
    let prep: Awaited<ReturnType<typeof prepareChat>>
    try {
      prep = await prepareChat({ ctx, body, settings, now: deps.clock(), requestId, signal: deadline.signal })
    } finally {
      clearTimeout(timer)
    }
    if (deadline.signal.aborted) {
      log('error', '[api]', 'pre-stream timeout', {
        request_id: requestId,
        user_id: ctx.userId,
        step: 'prepare',
        timeout_ms: PRE_STREAM_TIMEOUT_MS,
        budget_ms: budgetMs,
      })
      return fail(c, 'internal_error')
    }
    if (prep instanceof Response) return prep
    return streamChatResponse({
      deps,
      ctx,
      prep,
      settings,
      requestId,
      reqSignal: c.req.raw.signal,
      timings: { authMs: c.get('authMs'), prepareMs: Math.round(performance.now() - started) },
    })
  })
}
