// Bearer token → identity. A missing header is refused before any database or model call; the
// profile is re-read with the service role on every request (`authenticateToken`), never
// trusted from the token's claims. The token itself is never logged.
import { createMiddleware } from 'hono/factory'

import { authenticateToken, isAuthError, log } from '@va/core'

import type { AppEnv } from '../deps.js'
import { fail } from '../errors.js'

export function bearer(header: string | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '')
  const token = m?.[1]?.trim()
  return token ? token : null
}

export const authMiddleware = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const jwt = bearer(c.req.header('authorization'))
    if (!jwt) return fail(c, 'unauthorized')
    const started = performance.now()
    const result = await authenticateToken(jwt)
    if (isAuthError(result)) {
      log('warn', '[api]', 'auth refused', { request_id: c.get('requestId'), code: result.error.code })
      return fail(c, result.error.code, result.status)
    }
    c.set('ctx', result)
    c.set('jwt', jwt)
    c.set('authMs', Math.round(performance.now() - started))
    await next()
  })
