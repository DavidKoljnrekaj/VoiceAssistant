# Backlog — web

Ids: WEB-2 (next free)

The PWA (`apps/web`): chat, call, auth, i18n, service worker.

## Open

### WEB-1 · Low · The call button needs a per-user feature flag before a trial

- **Check:** Code reading (the button arrives in Part 6)
- **Where:** `apps/web` call button; the API's `POST /voice/sessions`
- **What happens:** Landmark's flag was a compile-time constant, all-or-nothing; a trial with a
  few users on production needs the button (and the endpoint) gated per user or per role
- **Fix direction:** a `users.features` column or a role check in the API, read by the PWA to
  show the button; the API refuses `POST /voice/sessions` for users without it (`not_found`)

## Resolved

Nothing yet.
