# Web (`@va/web`)

The installable PWA: a user signs in, types to the assistant and watches the answer stream with
tool progress, browses past conversations, and starts an in-app voice call. Landmark's `AiChat`
module trimmed to the skeleton: no attachments, no edit/regenerate branching, no document cards.
A shell, props-driven and minimal; the final design comes later. The plan is
`docs/plan/06-web-pwa.md`; the rules are `.claude/rules/web.md` and `.claude/rules/i18n.md`.

## Layout

```
apps/web/
├── index.html  vite.config.ts  public/icons/   (icon-192.png, icon-512.png: placeholders)
├── vitest.config.ts  playwright.config.ts  tsconfig.e2e.json   the unit suites; the smoke (docs/TESTING.md)
├── Dockerfile  nginx.conf      the static image (docs/OPS.md → Containers)
├── env.example                 the three VITE_ variables, no values
├── e2e/smoke.spec.ts           the Playwright smoke (E01–E03)
├── e2e/support/                env.ts (loads the build's env), prod-safety.ts (the guard, G01–G04)
├── src/
│   ├── main.tsx  App.tsx  i18n.ts  index.css  vite-env.d.ts
│   ├── i18n.test.ts            I02, WEB-14: the languages; <html lang> follows the switch
│   ├── sw-routes.test.ts       WEB-15: builds the PWA and reads sw.js back (NetworkOnly for both origins)
│   ├── test/                   the unit-test harness: fake-backend.ts (GoTrue, PostgREST, the API's SSE over
│   │                           fetch), fake-chat-service.ts (a scripted chatService for the store tests)
│   ├── lib/env.ts              the three VITE_ variables, validated once with zod
│   ├── lib/env-matrix.test.ts  X03 / X03b: env.ts and the matrix in docs/OPS.md agree
│   ├── lib/supabase.ts         the one browser client (auth, RLS reads from services)
│   ├── lib/api.ts              apiFetch / apiJson: Authorization from the session, ApiHttpError on a non-OK answer
│   ├── lib/api.test.ts         P01–P04
│   ├── lib/featureFlags.ts     VOICE_CALLS_ENABLED (compile-time constant)
│   ├── contexts/AuthContext.tsx   session, profile (users row), loading; signIn / signOut / setLanguage
│   ├── contexts/AuthContext.test.tsx  A01–A06, WEB-5, WEB-13
│   ├── contexts/ToastContext.tsx  transient notices (the call button's failures)
│   ├── services/profileService.ts loadProfile (RLS self-read), updateLanguage (the one client write)
│   ├── pages/LoginPage.tsx
│   ├── components/ui/          Button, Input, Spinner, Alert, ErrorState, ConfirmDialog, Toast (+ Toast.test.tsx), MarkdownView
│   ├── components/Auth/LoginForm.tsx
│   ├── components/Layout/      AppShell (header, main), LanguageSwitcher, ProtectedRoute
│   ├── components/Chat/
│   │   ├── ChatProvider.tsx    context + useChat(); calls useChatStore once
│   │   ├── hooks/useChatStore.ts        the state (below); its tests H01–H07, WEB-4, WEB-7, WEB-9, WEB-11; hooks/useAutoGrowTextarea.ts
│   │   ├── services/chatService.ts      streamMessage (SSE client), listSessions, loadSession, findSession, renameSession, deleteSession; tests C01–C08, WEB-6, WEB-7, WEB-11, V-9
│   │   ├── lib/sse.ts                   the frame parser (pure) and the stall clock; lib/normalizeMessages.ts (rows / events → RenderMessage[]); lib/labels.ts
│   │   ├── ChatPanel.tsx  MessageList.tsx  Message.tsx  ToolChip.tsx  Composer.tsx  SessionList.tsx
│   │   └── components/VoiceCallButton.tsx  hooks/useVoiceCall.ts (tests V01–V02, WEB-10)  services/voiceCallService.ts
│   ├── components/Settings/    SettingsPage.tsx (Y01–Y06)  OutlookConnection.tsx  hooks/useOutlookConnection.ts  services/integrationsService.ts
│   ├── locales/hr/translation.json  locales/en/translation.json  locales.test.ts (I01, WEB-8)
│   └── types/api.ts (the SSE events, isChatEvent, ApiHttpError; tests T01–T02, WEB-15)  types/database.ts (re-exported from @va/db)
└── src/**/*.test.ts            sse (S01–S07, WEB-11), normalizeMessages (N01–N07), labels (L01–L02), env matrix (X03), and the above
```

Layers: components (props-driven) → hooks (state, call services) → services (`fetch` to the API,
supabase-js reads under RLS) → clients. Hooks never import the Supabase client (ESLint). The
only dependency on another workspace package is `@va/db` for its generated types; everything
else reaches the backend over HTTP.

Dependencies (pinned, at least two weeks old when added): react 18.3.1, react-router-dom 7.18.4,
i18next 26.4.5 + react-i18next 17.0.16 + the browser language detector, react-markdown 10.1.0 +
remark-gfm 4.0.1, lucide-react 1.57.0, livekit-client 2.22.4 (dynamic import), supabase-js
2.117.3, zod 4.6.7; dev: Vite 7 with `@vitejs/plugin-react` 5.2.0 (6.x needs Vite 8), Tailwind
4.3.3 via `@tailwindcss/vite`, `vite-plugin-pwa` 2.0.0, and for the tests `@testing-library/react`
16.3.3 (+ `@testing-library/dom` 10.4.2) and `jsdom` 29.1.1 (30.x needs Node 24.15).

## Routes and the shell

`/login` (the form; a signed-in visitor is sent on), `/` (a new conversation),
`/c/:sessionId` (one conversation) and `/settings`, the last three behind `ProtectedRoute`, which
waits for auth to resolve and redirects to `/login` otherwise. `AppShell` is the header (name,
language, the Settings link, sign-out) and the main area; `ChatPanel` owns the rest: the session drawer (always visible from
`md`, a slide-over below), the chat header (title, new conversation, the call button), the call
banner, the message list and the composer. The slide-over is a modal `dialog`: focus moves in,
Tab cycles inside, Escape closes it and focus returns to the menu button.

The route selects the session: `ChatPanel` calls `selectSession` when `:sessionId` changes, and
when a new conversation gets its id from the stream's `session` event it moves the route to
`/c/:id` (replace, and only while that stream runs), so a refresh reopens the same conversation.
Deleting the open conversation navigates to `/` first; the store catches up, never the other way
round.

## Settings: the Outlook connection

`/settings` holds one section for now, Outlook (Part 13a, `docs/MAIL.md`). It reads
`GET /integrations` and shows one of: loading; an error with retry (never "not connected" for a
failed load); not available (the API has no MS_ variables); not connected with **Poveži
Outlook**; expired (`reauth_required`) with **Ponovno poveži**; connected with the account and
**Odspoji** behind the shared confirm dialog, and the note that access at Microsoft is revoked
in My Apps. Connect calls `GET /integrations/microsoft/start` and, if the answer is
`https://login.microsoftonline.com/…`, navigates there (`window.location.assign`); anything else
is refused with a toast. Microsoft returns through the API's callback to
`/settings?connected=1` or `?connect_error=<code>`: the page says which once (a toast; an unknown
code is `errors.unknown`) and drops the query. The connection itself is always read from the
API, never from the query. No token reaches the browser.

## Auth

`AuthContext` mirrors Landmark's shape: the Supabase session from `getSession()` and
`onAuthStateChange` (its own calls deferred out of the callback, which holds supabase-js's
lock), then the `users` profile through `profileService.loadProfile` (RLS self-read); `loading`
until both have resolved. The profile is re-read on `SIGNED_IN`, `TOKEN_REFRESHED` (hourly) and
`USER_UPDATED`. An auth user without a profile is signed out again with `no_profile`, shown on
the login form. A profile read that _fails_ is not "no profile": the session and the previous
profile stay and the read is retried with a backoff (5 s, 15 s, then every 60 s; a
`profileRetryDelaysMs` prop in tests). Without a previous profile (first load, sign-in) the
login form shows `network` until the retry fills the profile in and the route lets the user
through; `signIn` then answers `network`, not `no_profile`. `signIn` maps GoTrue's failures to
`invalid_credentials`, `too_many_requests`, `network` or `unknown`. `setLanguage` switches
i18next first and writes `users.language`; a failed write puts the language back and rethrows,
which the switcher shows as a toast. No Microsoft sign-in in the skeleton; adding a provider is
a button on `LoginForm` and a call in the context.

## State model

`useChatStore` is called once, by `ChatProvider`; consumers use `useChat()`. The state:

| Field                        | What                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions`, `sessionsStatus` | the chat sessions (`channel = 'chat'`, newest activity first); `idle → ready \| error`                                                                                  |
| `currentSessionId`           | the open conversation, null for a new one                                                                                                                               |
| `messages`                   | `RenderMessage[]`: `user`, `assistant` (with `provisional`), `tool` (pending → done / error), `error`, `interrupted`, `confirm` (a write waiting for the user, Part 12) |
| `pendingText`                | the deltas of the assistant block being streamed; null between blocks                                                                                                   |
| `messagesStatus`             | `loading → ready \| error \| not_found` for a selected session                                                                                                          |
| `isStreaming`                | a `POST /chat` is open                                                                                                                                                  |

Actions: `fetchSessions`, `newConversation`, `selectSession`, `sendMessage`,
`answerConfirmation`, `stop`, `renameSession`, `deleteSession`. `sendMessage` pushes an optimistic user row, streams, then
reloads the canonical rows of the session and refetches the list (the API set the title). The
reload keeps the stream's client-only tail after the canonical rows: its error rows and, when
the request failed before any event arrived (the API persists the user row before the first
event), the typed row itself, so a rate limit or an offline send on an existing conversation
leaves the question and the error on screen. Once an event has arrived the canonical user row
stands in for the optimistic one; a connection dropped between the two is Landmark's documented
caveat (the row vanishes on the next reload). `stop()` aborts the fetch's `AbortController`; the
server treats the closed connection as the cancel (`docs/API.md` → Cancellation, no beacon).
The text already streamed stays on screen as a provisional bubble ("Nije spremljeno") with the
"Odgovor prekinut." marker; it was never persisted, so it is gone on reload. A stream whose
view was replaced while it ran (new conversation, another session selected, a user change: the
store counts these as a view epoch) ends without touching the view, so a fresh conversation
never inherits the marker.

`selectSession` with no rows checks the `ai_sessions` row itself (`findSession`,
`maybeSingle`): RLS answers an empty list for another user's or a deleted conversation, which
is `messagesStatus = 'not_found'` (a not-found state, composer disabled), not an empty new
conversation; an owned session without rows is still an empty, ready conversation.

Failures reach the user by one mechanism: an inline `kind: 'error'` row worded from `labels.ts`
(a pre-stream `ApiHttpError`, a network failure, a stalled stream, a failed rename or delete, a
mid-stream `error` event). The two list loads are the exception: a failed session list or
conversation load shows `ErrorState` with a retry, never an empty list. The one state reset on
a changed user happens during render (React's pattern), so no effect sets state synchronously.

**The confirm card (Part 12).** A `confirm` event (after the `tool_result` it belongs to) is a
`kind: 'confirm'` row: `ConfirmCard` shows the tool's summary verbatim with "Potvrdi" and
"Odustani". `answerConfirmation(id, answer)` settles the card (its outcome stays as the record of
what was asked) and sends the next turn with a fixed text ("Da." / "Ne.", `chat.confirm_yes_text`,
`chat.confirm_no_text`) and `confirm` or `decline` in the body; the buttons are disabled while a
stream is open and gone once answered or past `expires_at` (five minutes). On a reload the
session's pending rows of `tool_confirmations` (owner SELECT, `listPendingConfirmations`) follow
the branch as cards, so an unanswered write survives a refresh. A `confirmation_invalid` answer
is an inline error row like any pre-stream failure. N08, N09, H08, K10, K11.

## SSE handling

`chatService.streamMessage` posts `{ session_id, message, parent_message_id?, client_context: {
route } }` with `fetch` and reads the body as a `ReadableStream` (not `EventSource`: POST and
the `Authorization` header are needed). `lib/sse.ts` splits on blank lines, ignores `:` comment
frames (`ready`, `keepalive`), joins several `data:` lines with `\n`, and `readSseBody` parses
each payload as JSON; `isChatEvent` drops anything that is not one of the seven event types in
`docs/API.md` with its required fields present and typed (a `delta` without `text` is dropped,
not rendered). The client dispatches on the JSON's `type` (the `event:` line always equals it).
`readSseBody` races every read against a stall clock that any chunk resets, comment frames
included, so the API's `: keepalive` every 15 s is the liveness tick: 45 s of silence (three
missed keepalives, `STREAM_STALL_MS`) cancels the body and throws `SseStallError`, which the
store shows as the `stream_stalled` inline error and frees the composer.

`normalizeMessages.applyEvent` folds each event into the view: `delta` appends to
`pendingText`; `turn` clears it and appends the canonical assistant row with its `message_id`;
`tool_call` appends a pending chip keyed by `tool_use_id`; `tool_result` flips that chip to done
or error; `done` clears any leftover `pendingText`; `error` appends an error row, and with
`persistence_error` also drops `pendingText` (the block has no row: invariant 1). A pre-stream
non-OK status is thrown as `ApiHttpError(status, code, message)` from the flat envelope.

History is read through supabase-js: `listSessions` (`ai_sessions`, chat only, newest activity
first), `loadSession` (every row of the session, oldest first) and `findSession` (one session
row by id). PostgREST answers at most `max_rows` (1000) per request, so both list reads page
with `range()`, ordered by the timestamp and then the id so pages never overlap or skip;
without that a long conversation lost its newest rows and the leaf went stale. Each page starts
where the rows received so far end, and the read stops on an empty page, not on a short one: a
short page also means a server cap below the client's page, and stopping there truncated the
read again when `max_rows` was lowered (V-9). The price is one empty request per read. The
session list pages newest first, so a session updated between two pages moves to the front and
can appear twice or be missed once; the list is refreshed on every change, so this is cosmetic.
The API's bounded history (`ai_session_history`, 200 rows, service role only) was not used: it
is the model's context window, not what a reader of the conversation should see, and the
PWA's contract is to read under RLS while the API only mutates. `normalizeFromPersistedRows`
takes the newest row as the leaf, walks `parent_id` to the root and renders that branch: user
rows as text, assistant rows as text blocks and `tool_use` chips, `tool_result` rows as chip
status. The walk already supports sibling branches; edit/regenerate is a later part. Rename and
delete go through the API (`PATCH` / `DELETE /sessions/:id`); the client never writes a session
or message row.

## Why the provider sits above the router

`App.tsx` mounts `<ToastProvider><AuthProvider><ChatProvider><BrowserRouter>…`. Route elements
unmount on navigation; state kept inside one would die with it, including an open stream
reader. With the store above the router, a user can start a question, open another conversation
or a later screen, and come back without losing the answer. `ChatPanel` is a consumer only.

## Voice call

Landmark's three files ported with minimal change. `voiceCallService` calls `POST
/voice/sessions` (start), `POST /voice/sessions/:id/refresh` on supabase-js's `TOKEN_REFRESHED`
and `POST /voice/sessions/:id/end` (hang-up, best effort). `useVoiceCall` imports
`livekit-client` on the first call (its own chunk, not loaded with the panel), connects with the
room token, enables the microphone with echo cancellation, noise suppression and auto gain,
attaches the agent's audio tracks to hidden `<audio>` elements (detached again when the track
is unsubscribed or the call ends), derives `agentSpeaking` from `ActiveSpeakersChanged`, and
tears everything down on disconnect, unmount or `pagehide`; the `pagehide` hang-up sends `/end`
with `keepalive: true` so a closed tab releases the credential instead of waiting for the
15-minute cap and the sweep. That hang-up is best-effort (V-8): `apiFetch` takes the bearer
token from `supabase.auth.getSession()`, which supabase-js 2.117.3 exposes only as a promise
(there is no synchronous accessor to prefer; the session lives in the client's storage behind
`_useSession`). With a valid token the lockless client answers from memory in a microtask and
the keepalive request leaves before the page is gone; inside the refresh margin before the
token expires the client refreshes over the network first, and an unloading page may not get
to send `/end`. The credential then expires at the cap and the sweep removes it
(`docs/API.md` → Voice call lifecycle); the room itself ends when the participant leaves.
`VoiceCallButton`
is props-driven (idle / connecting / live with mute and hang-up); microphone denial and a failed
start are toasts. The button renders only with `VOICE_CALLS_ENABLED` (on in this repository; a
per-user gate before a trial is `WEB-1`). During a call the panel shows a "Poziv u tijeku"
banner; the call's own conversation is a `channel = 'voice'` session, which the list leaves out.
A live transcript during the call is `WEB-2`.

## i18n rules

i18next with the browser language detector: the stored preference first (`localStorage`), then
the browser, `hr` default, `en` fallback, `load: 'languageOnly'` so a Croatian browser's `hr-HR`
lands on `hr`. `<html lang>` follows every language change (`i18n.ts`), so assistive technology
reads the UI in the language shown. After sign-in `AuthContext` applies `users.language`; the
switcher calls `setLanguage`, which changes the UI and writes `users.language` through
`profileService` (the one client write RLS allows); a failed write puts the UI back and shows
the `common.language_save_failed` toast. Every visible string goes through `t()`; `common.*` holds shared
strings; keys are added to `hr` and `en` together; domain terms stay untranslated. The chip and
client-side error labels in `labels.ts` are Croatian only, like the model's answers and the
API's error messages (`WEB-3`). The Croatian locale and `labels.ts` are placeholders until a
native speaker reads them (`CORE-1`). The `settings.*` keys (Part 13a) are new Croatian text in
the same state: `common.settings`, `settings.back` and every `settings.outlook.*` key, including
the six `settings.outlook.errors.*`. <!-- needs native review -->

## Accessibility

The slide-over drawer is a modal `dialog` with a focus trap, Escape and focus return; every
toast has a labelled dismiss button and Escape dismisses the newest; every `Spinner` carries a
label (`common.loading`); the message list is a polite `log` live region, so each completed row
(the canonical answer, a chip, an error) is announced once when it arrives, while the
provisional bubble is excluded so deltas are not read word by word. The manifest `description`
stays Croatian (the manifest is static and the name a placeholder).

## PWA caching rules

`vite-plugin-pwa` in `generateSW` mode with `registerType: 'autoUpdate'`. The manifest: name and
short name "Asistent", `lang: hr`, `display: standalone`, theme colour `#1d4ed8`, the two
placeholder icons (192, 512, the latter also maskable). Workbox precaches the built app shell
only (`js, css, html, png, svg, ico, webmanifest`) with `index.html` as the navigation fallback,
and has one runtime rule per backend origin, `NetworkOnly` for `VITE_API_URL` and
`VITE_SUPABASE_URL`. The two rules match GET requests only (Workbox's default method): the
Supabase reads and GoTrue's `GET /user` go through them to the network, while `POST /chat`,
`POST /voice/*`, `PATCH`/`DELETE /sessions/:id`, GoTrue's token and logout POSTs and the
`users` PATCH match no route at all, so the worker never handles them and the browser sends
them itself. Nothing of either kind is stored: the Cache API refuses a non-GET response, and
no rule caches a GET. Routes per verb were considered and not added (V-8): a `NetworkOnly`
route for a POST would only put the worker's own `fetch` between the page and the streamed
`/chat` body, and between an unloading page and its keepalive `/end`, with nothing to gain;
`sw-routes.test.ts` pins the two routes as GET so a change is deliberate. The rule's
`urlPattern` is a RegExp built from the origin, never a function: `generateSW` serialises the
route into `sw.js` as text and a function loses its closure (it compared against the worker's
own origin until the test read the built worker back; the test matches the registration itself,
a RegExp literal carrying the origin, `NetworkOnly`, `GET`). The origins are read from the env
at build time, so a build without them has no runtime rules (and still caches nothing from
them). To verify in DevTools:
Application → Cache Storage holds only `workbox-precache-*` with the shell; a `/chat` request
shows no `(ServiceWorker)` size.

Chunks: `vendor-react`, `vendor-supabase`, `vendor-livekit` (dynamic), `vendor-markdown`,
`vendor-i18n`, `vendor-icons`, `i18n-locales` (a port of Landmark's `manualChunks`).

## How to run

```
supabase start                                   # the local stack (docs/DB.md)
cp apps/web/env.example apps/web/.env            # then fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (supabase status), VITE_API_URL
pnpm --filter @va/api dev                        # the API on :3000 (docs/API.md → Running locally)
pnpm --filter @va/web dev                        # Vite on http://127.0.0.1:5173
pnpm --filter @va/web build && pnpm --filter @va/web preview   # the production build with the service worker
```

Sign in with a seed user (`docs/DB.md` → Seed users). The API's `CORS_ORIGINS` defaults to
`*`, so the dev server's origin is accepted. `pnpm exec vitest run apps/web` runs the unit
suites: the pure modules under `environment: 'node'`, the hook and component tests under jsdom
(a `// @vitest-environment jsdom` docblock per file), all against the fakes in `src/test/`
(`docs/TESTING.md` → The web suites). `sw-routes.test.ts` runs a production build into a
temporary directory (about 8 s) to read the service worker back.

**Verified 2026-10-29** against the local stack and the API with a live key, driven in headless
Chromium: sign-in as the seed member; a streamed turn that rendered the provisional deltas, a
`search_items` chip pending → done, then the canonical answer; the route moved to `/c/<id>` and
a reload rendered rows identical to the live view; stop on a second question left the
provisional bubble and the interrupted marker, and a reload showed only the persisted rows;
rename and delete through the API; the language switch survived a reload through
`users.language`; an aborted `ai_sessions` request showed the error state with retry; no console
errors. Not run: a Lighthouse "installable" audit (needs an HTTPS origin or `localhost` with the
built app; `REL-4`) and a voice call from the button (the worker was not started; `REL-5`).
