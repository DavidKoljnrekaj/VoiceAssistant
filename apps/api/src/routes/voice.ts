// The voice call lifecycle endpoints. The browser calls them with its normal session, exactly
// as it calls /chat; what it gets back is a LiveKit join token, never the call token.
import { Hono } from 'hono'
import { z } from 'zod'

import type { AppDeps, AppEnv } from '../deps.js'
import { fail } from '../errors.js'
import { endCall, refreshCall, startCall } from '../voice/calls.js'

const idSchema = z.uuid()

export function voiceRoute(deps: AppDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .post('/voice/sessions', async (c) => {
      const result = await startCall(deps, c.get('ctx'), c.get('jwt'), c.get('requestId'))
      if (!result.ok) return fail(c, result.code)
      return c.json(result.value)
    })
    .post('/voice/sessions/:id/refresh', async (c) => {
      const id = idSchema.safeParse(c.req.param('id'))
      if (!id.success) return fail(c, 'not_found')
      const result = await refreshCall(c.get('ctx'), id.data, c.get('jwt'), c.get('requestId'))
      if (!result.ok) return fail(c, result.code)
      return c.json({ ok: true })
    })
    .post('/voice/sessions/:id/end', async (c) => {
      const id = idSchema.safeParse(c.req.param('id'))
      if (!id.success) return fail(c, 'not_found')
      const result = await endCall(c.get('ctx'), id.data, c.get('requestId'))
      if (!result.ok) return fail(c, result.code)
      return c.json({ ok: true })
    })
}
