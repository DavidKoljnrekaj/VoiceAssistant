// The Hono app, built from injected dependencies so tests run it in-process (`app.request`)
// against the fakes with a fixed clock. Every route except /health and Microsoft's redirect to
// /integrations/microsoft/callback runs request id, CORS, the body limit and authentication, in
// that order; the callback's identity is its single-use OAuth state.
import { Hono } from 'hono'

import { log } from '@va/core'

import type { AppDeps, AppEnv } from './deps.js'
import { fail } from './errors.js'
import { authMiddleware } from './middleware/auth.js'
import { bodyLimitMiddleware } from './middleware/body-limit.js'
import { corsMiddleware } from './middleware/cors.js'
import { requestIdMiddleware } from './middleware/request-id.js'
import { chatRoute } from './routes/chat.js'
import { healthRoute } from './routes/health.js'
import { integrationsRoute } from './routes/integrations.js'
import { sessionsRoute } from './routes/sessions.js'
import { voiceRoute } from './routes/voice.js'

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requestIdMiddleware())
  app.use('*', corsMiddleware(deps.env))
  app.route('/', healthRoute)

  // A known path with the wrong method is 405, answered before authentication.
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
  const allowed: Record<string, string[]> = {
    '/chat': ['POST'],
    '/sessions/:id': ['PATCH', 'DELETE'],
    '/voice/sessions': ['POST'],
    '/voice/sessions/:id/refresh': ['POST'],
    '/voice/sessions/:id/end': ['POST'],
    '/integrations': ['GET'],
    '/integrations/microsoft': ['DELETE'],
    '/integrations/microsoft/start': ['GET'],
    '/integrations/microsoft/callback': ['GET'],
  }
  for (const [path, methods] of Object.entries(allowed)) {
    app.on(
      METHODS.filter((m) => !methods.includes(m)),
      path,
      (c) => fail(c, 'method_not_allowed'),
    )
  }

  // Not `/integrations/*`: that would put the callback behind a bearer token it cannot carry.
  for (const path of [
    '/chat',
    '/sessions/*',
    '/voice/*',
    '/integrations',
    '/integrations/microsoft',
    '/integrations/microsoft/start',
  ]) {
    app.use(path, bodyLimitMiddleware())
    app.use(path, authMiddleware())
  }
  app.route('/', chatRoute(deps))
  app.route('/', sessionsRoute())
  app.route('/', voiceRoute(deps))
  app.route('/', integrationsRoute(deps))

  app.notFound((c) => fail(c, 'not_found'))
  app.onError((err, c) => {
    log('error', '[api]', 'unhandled error', {
      request_id: c.get('requestId') ?? null,
      reason: err.constructor.name,
    })
    return fail(c, 'internal_error')
  })
  return app
}
