// The flat error envelope for pre-stream failures: `{ error: { code, message } }` with a real
// status. The codes and Croatian messages come from the catalogue in @va/core.
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { type ErrorCode, MESSAGES_HR } from '@va/core'

export const STATUS: Partial<Record<ErrorCode, ContentfulStatusCode>> = {
  bad_request: 400,
  message_too_long: 400,
  unauthorized: 401,
  no_profile: 403,
  session_not_found: 404,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
  voice_dispatch_failed: 502,
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string }
}

export function errorBody(code: ErrorCode): ErrorBody {
  return { error: { code, message: MESSAGES_HR[code] } }
}

export function fail(
  c: Context,
  code: ErrorCode,
  status: ContentfulStatusCode = STATUS[code] ?? 500,
): Response {
  return c.json(errorBody(code), status)
}

/** A `Response` carrying the envelope, for code that has no `Context` at hand. */
export function failResponse(code: ErrorCode, status: number = STATUS[code] ?? 500): Response {
  return new Response(JSON.stringify(errorBody(code)), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
