// POST /chat: the pre-stream pipeline, then the SSE stream. Every failure before the stream is a
// flat error with a real status; from `: ready` on, failures are `error` events.
import { Hono } from 'hono'

import { channelSettings } from '@va/core'

import { prepareChat } from '../chat/prepare.js'
import { streamChatResponse } from '../chat/stream.js'
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
    const prep = await prepareChat({ ctx, body, settings, now: deps.clock(), requestId })
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
