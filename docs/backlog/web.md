# Backlog — web

Ids: WEB-4 (next free)

The PWA (`apps/web`): chat, call, auth, i18n, service worker.

## Open

### WEB-1 · Low · The call button needs a per-user feature flag before a trial

- **Check:** Code reading (the button arrives in Part 6)
- **Where:** `apps/web` call button; the API's `POST /voice/sessions`
- **What happens:** Landmark's flag was a compile-time constant, all-or-nothing; a trial with a
  few users on production needs the button (and the endpoint) gated per user or per role
- **Fix direction:** a `users.features` column or a role check in the API, read by the PWA to
  show the button; the API refuses `POST /voice/sessions` for users without it (`not_found`)

### WEB-2 · Low · No live transcript during a voice call

- **Check:** Code reading (Part 6 left it out by plan)
- **Where:** `apps/web/src/components/Chat/ChatPanel.tsx` (the call banner), `useVoiceCall`
- **What happens:** during a call the panel shows only the "Poziv u tijeku" banner; what the
  caller and the agent say appears nowhere until the call's rows are loaded as a conversation
- **Fix direction:** subscribe to the agent's transcription events on the LiveKit room (or the
  worker's data messages) and render them as provisional rows under the banner

### WEB-3 · Low · OQ: tool chip and client-side error labels are Croatian only

- **Check:** Code reading
- **Where:** `apps/web/src/components/Chat/lib/labels.ts`
- **What happens:** with the UI switched to English, chips ("Pretraživanje artikala") and the
  inline failures ("Preimenovanje razgovora nije uspjelo.") stay Croatian, like the model's
  answers and the API's error messages; the plan chose one Croatian label map on purpose
- **Fix direction:** decide whether English users should see English chips; if so, move the two
  maps into the locale files and key `toolLabel` / `errorLabel` through `t()`

## Resolved

Nothing yet.
