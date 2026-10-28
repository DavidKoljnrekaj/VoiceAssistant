// X-Request-Id in (when the client sends one) and out (always), on every response including the
// streamed one. The id is in every log line of the request.
import { createMiddleware } from 'hono/factory'
import { requestId } from 'hono/request-id'

import type { AppEnv } from '../deps.js'

export const HEADER = 'X-Request-Id'

export const requestIdMiddleware = () => {
  const inner = requestId({ headerName: HEADER, limitLength: 128 })
  return createMiddleware<AppEnv>(async (c, next) => {
    await inner(c, async () => {
      await next()
      c.res.headers.set(HEADER, c.get('requestId'))
    })
  })
}
