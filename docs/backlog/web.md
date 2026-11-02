# Backlog — web

Ids: WEB-16 (next free)

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

### WEB-12 · Low · A deploy while a page is open breaks the lazy LiveKit chunk (R-W9)

- **Check:** Confirmed, narrowed (R-W9, verified 2026-10-30)
- **Where:** `apps/web/vite.config.ts` (`registerType: 'autoUpdate'`), `useVoiceCall.ts`
  (`import('livekit-client')`), `main.tsx`
- **What happens:** the old `index-*.js` imports `vendor-livekit-<oldhash>.js`; while the old
  service worker controls the page the precache serves it, but once the new worker activates (a
  second tab, a navigation, the 24 h update check) the old chunk is gone from cache and server
  and the first call click fails with `start_failed`
- **Fix direction:** a `vite:preloadError` listener in `main.tsx` that reloads the page;
  optionally `onNeedRefresh` instead of `autoUpdate`

### WEB-14 · Low · Accessibility gaps in the shell (R-W11)

- **Check:** Confirmed (R-W11)
- **Where:** `ChatPanel.tsx` mobile drawer (no `role="dialog"`, focus trap or Escape);
  `Toast.tsx` (click-only dismiss); `MessageList.tsx` (the streamed answer is not in a live
  region; `Spinner` without `label` there, in `ProtectedRoute.tsx` and `LoginPage.tsx`);
  `index.html` `<html lang="hr">` never follows the switch; the manifest `description` is
  Croatian only
- **What happens:** keyboard and screen-reader users cannot close the drawer or hear the answer
  arrive
- **Fix direction:** dialog semantics with a focus trap and Escape, `aria-live="polite"` on the
  streaming bubble, labelled spinners, `document.documentElement.lang` set on language change

### WEB-15 · Low · The store, auth context, voice hook and services have no tests; `isChatEvent` checks only `type` (R-W12)

- **Check:** Confirmed (R-W12)
- **Where:** `hooks/useChatStore.ts`, `contexts/AuthContext.tsx`, `hooks/useVoiceCall.ts`,
  `services/chatService.ts`, `lib/api.ts` (`ApiHttpError` mapping, non-JSON bodies);
  `types/api.ts` `isChatEvent`; the built service worker's `NetworkOnly` routes
- **What happens:** web coverage is 28 %; `WEB-4`, `WEB-5`, `WEB-7` and `WEB-9` have nowhere to
  put their failing test; a `delta` without `text` renders "undefined"
  (`lib/normalizeMessages.ts`); nothing asserts the built `sw.js` has `NetworkOnly` for the two
  origins
- **Fix direction:** a store harness over a fake `fetch` (the SSE fixtures exist) and a fake
  supabase-js; a shape check per event type in `isChatEvent`; a build-output grep for the two
  routes

## Resolved

### WEB-4 · High · A failed turn on an existing conversation is wiped, with the typed text (R-W1)

- Fixed 2026-10-30 on fix/web-review: the post-stream reload appends the stream's client-only tail (its error rows, and the typed row when no event arrived) after the canonical rows; tests `WEB-4` in `useChatStore.test.ts`.

### WEB-5 · High · A transient profile re-read failure at token refresh signs the user out of the UI (R-W2)

- Fixed 2026-10-30 on fix/web-review: a failed profile read keeps the session and the previous profile and is retried with a backoff (5 s, 15 s, 60 s); without a previous profile the form says `network`; only a missing row signs out. Tests `WEB-5` in `AuthContext.test.tsx`.

### WEB-6 · Medium · Conversation and session loads are capped at 1000 rows, and the leaf goes stale (R-W3)

- Fixed 2026-10-30 on fix/web-review: `listSessions` and `loadSession` page with `range()` (1000 per page) until a short page, ordered by `updated_at desc, id desc` and `created_at asc, id asc`; the API's bounded history was not used because it is the model's 200-row context window behind a service-role-only function, not what a reader of the conversation should see. Tests `WEB-6` in `chatService.test.ts`.

### WEB-7 · Medium · A foreign or deleted conversation id renders as an empty new conversation (R-W4)

- Fixed 2026-10-30 on fix/web-review: when a selected session has no rows the store reads the `ai_sessions` row by id (`findSession`, `maybeSingle`) and a null is `messagesStatus = 'not_found'`, rendered as a not-found state with the composer disabled; an owned empty session stays ready. Tests `WEB-7` in `useChatStore.test.ts` and `chatService.test.ts`.

### WEB-8 · Low · The call banner says "Poziv u tijeku" twice (R-W5)

- Fixed 2026-10-30 on fix/web-review: `call.banner` no longer starts with the `call.live` words in hr and en; test `WEB-8` in `locales.test.ts` (which also pins identical key sets, `I01`). <!-- needs native review -->

### WEB-9 · Low · Stopping or leaving a brand-new conversation plants the interrupted marker in the fresh view (R-W6)

- Fixed 2026-10-30 on fix/web-review: the store counts view replacements (new conversation, select, user change) and a stream whose view was replaced ends without touching it; a plain stop still leaves the typed row and the marker. Tests `WEB-9` in `useChatStore.test.ts`.

### WEB-10 · Low · `useVoiceCall`: a closed tab never ends the call; tracks are removed without `detach()`; `TrackUnsubscribed` is unhandled (R-W7)

- Fixed 2026-10-30 on fix/web-review: a `pagehide` listener ends the call through `endVoiceCall(id, { keepalive: true })`; tracks are kept and `detach()`ed before their elements are removed; `TrackUnsubscribed` detaches its track. Tests `WEB-10` in `useVoiceCall.test.ts` (livekit-client is a scripted module there: WebRTC has no wire a fetch fake could answer).

### WEB-11 · Low · No stall detection on the chat stream (R-W8)

- Fixed 2026-11-02 on fix/web-review: `readSseBody` races every read against a stall clock (`stallMs`, reset by any chunk, keepalive comments included) and throws `SseStallError` after cancelling the body; `streamMessage` passes 45 s (three missed keepalives) and the store renders it as the `stream_stalled` inline error. Tests `WEB-11` in `sse.test.ts`, `chatService.test.ts` and `useChatStore.test.ts`.

### WEB-13 · Low · The language switcher swallows a failed `updateLanguage` (R-W10)

- Fixed 2026-11-02 on fix/web-review: `setLanguage` puts i18next back on the previous language when `updateLanguage` fails and rethrows; the switcher shows the `common.language_save_failed` toast (hr/en). Test `WEB-13` in `AuthContext.test.tsx`.
