import { bodyLimit } from 'hono/body-limit'

import { fail } from '../errors.js'

export const MAX_BODY_BYTES = 64 * 1024

export const bodyLimitMiddleware = () =>
  bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => fail(c, 'payload_too_large') })
