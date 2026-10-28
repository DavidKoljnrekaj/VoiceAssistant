---
paths:
  - 'apps/api/**'
---

# API (`@va/api`, Hono)

- **Authenticate every request** from `Authorization: Bearer <jwt>` and re-read the profile from the
  database on every request; never trust the token's claims for role or identity.
- **Error envelope.** Pre-stream failures are `{ error: { code, message } }` with a real status:

  | status | code                              |
  | ------ | --------------------------------- |
  | 400    | `bad_request`, `message_too_long` |
  | 401    | `unauthorized`                    |
  | 403    | `no_profile`                      |
  | 404    | `session_not_found`, `not_found`  |
  | 405    | `method_not_allowed`              |
  | 413    | `payload_too_large`               |
  | 429    | `rate_limited`                    |
  | 500    | `internal_error`                  |
  | 502    | `voice_dispatch_failed`           |

  Mid-stream failures are `error` events on the already-open 200 stream.

- **SSE contract:** named events with JSON data; comment lines for keepalive every 15 s;
  `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`. The event
  list and payloads are in `docs/API.md`; changing one changes the web client in the same change.
- **Service-role writes** always filter by `user_id` and/or `session_id`.
- **A pre-stream failure cleans up** anything the request created (a session row, a voice call row).
- **Cancellation:** read the request's abort signal and pass it into the loop. No cancel beacon.
- **Logs:** `request_id`, `user_id`, `session_id`, codes and timings. No message content.
- Rate limits count user turns only (tool-result rows do not count).
