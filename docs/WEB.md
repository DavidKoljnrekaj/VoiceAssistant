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
├── .env.example                the three VITE_ variables, no values
├── e2e/smoke.spec.ts           the Playwright smoke (E01–E03)
├── e2e/support/                env.ts (loads the build's env), prod-safety.ts (the guard, G01–G04)
├── src/
│   ├── main.tsx  App.tsx  i18n.ts  index.css  vite-env.d.ts
│   ├── lib/env.ts              the three VITE_ variables, validated once with zod
│   ├── lib/env-matrix.test.ts  X03 / X03b: env.ts and the matrix in docs/OPS.md agree
│   ├── lib/supabase.ts         the one browser client (auth, RLS reads from services)
│   ├── lib/api.ts              apiFetch / apiJson: Authorization from the session, ApiHttpError on a non-OK answer
│   ├── lib/featureFlags.ts     VOICE_CALLS_ENABLED (compile-time constant)
│   ├── contexts/AuthContext.tsx   session, profile (users row), loading; signIn / signOut / setLanguage
│   ├── contexts/ToastContext.tsx  transient notices (the call button's failures)
│   ├── services/profileService.ts loadProfile (RLS self-read), updateLanguage (the one client write)
│   ├── pages/LoginPage.tsx
│   ├── components/ui/          Button, Input, Spinner, Alert, ErrorState, ConfirmDialog, Toast, MarkdownView
│   ├── components/Auth/LoginForm.tsx
│   ├── components/Layout/      AppShell (header, main), LanguageSwitcher, ProtectedRoute
│   ├── components/Chat/
│   │   ├── ChatProvider.tsx    context + useChat(); calls useChatStore once
│   │   ├── hooks/useChatStore.ts        the state (below); hooks/useAutoGrowTextarea.ts
│   │   ├── services/chatService.ts      streamMessage (SSE client), listSessions, loadSession, renameSession, deleteSession
│   │   ├── lib/sse.ts                   the frame parser (pure); lib/normalizeMessages.ts (rows / events → RenderMessage[]); lib/labels.ts
│   │   ├── ChatPanel.tsx  MessageList.tsx  Message.tsx  ToolChip.tsx  Composer.tsx  SessionList.tsx
│   │   └── components/VoiceCallButton.tsx  hooks/useVoiceCall.ts  services/voiceCallService.ts
│   ├── locales/hr/translation.json  locales/en/translation.json
│   └── types/api.ts (the SSE events, ApiHttpError)  types/database.ts (re-exported from @va/db)
└── src/**/*.test.ts            sse (S01–S07), normalizeMessages (N01–N07), labels (L01–L02), env matrix (X03)
```

Layers: components (props-driven) → hooks (state, call services) → services (`fetch` to the API,
supabase-js reads under RLS) → clients. Hooks never import the Supabase client (ESLint). The
only dependency on another workspace package is `@va/db` for its generated types; everything
else reaches the backend over HTTP.

Dependencies (pinned, at least two weeks old when added): react 18.3.1, react-router-dom 7.18.4,
i18next 26.4.5 + react-i18next 17.0.16 + the browser language detector, react-markdown 10.1.0 +
remark-gfm 4.0.1, lucide-react 1.57.0, livekit-client 2.22.4 (dynamic import), supabase-js
2.117.3, zod 4.6.7; dev: Vite 7 with `@vitejs/plugin-react` 5.2.0 (6.x needs Vite 8), Tailwind
4.3.3 via `@tailwindcss/vite`, `vite-plugin-pwa` 2.0.0.

## Routes and the shell

`/login` (the form; a signed-in visitor is sent on), `/` (a new conversation) and
`/c/:sessionId` (one conversation), the last two behind `ProtectedRoute`, which waits for auth
to resolve and redirects to `/login` otherwise. `AppShell` is the header (name, language,
sign-out) and the main area; `ChatPanel` owns the rest: the session drawer (always visible from
`md`, a slide-over below), the chat header (title, new conversation, the call button), the call
banner, the message list and the composer.

The route selects the session: `ChatPanel` calls `selectSession` when `:sessionId` changes, and
when a new conversation gets its id from the stream's `session` event it moves the route to
`/c/:id` (replace, and only while that stream runs), so a refresh reopens the same conversation.
Deleting the open conversation navigates to `/` first; the store catches up, never the other way
round.

## Auth

`AuthContext` mirrors Landmark's shape: the Supabase session from `getSession()` and
`onAuthStateChange` (its own calls deferred out of the callback, which holds supabase-js's
lock), then the `users` profile through `profileService.loadProfile` (RLS self-read); `loading`
until both have resolved. An auth user without a profile is signed out again with
`no_profile`, shown on the login form. `signIn` maps GoTrue's failures to
`invalid_credentials`, `too_many_requests`, `network` or `unknown`. No Microsoft sign-in in the
skeleton; adding a provider is a button on `LoginForm` and a call in the context.

## State model

`useChatStore` is called once, by `ChatProvider`; consumers use `useChat()`. The state:

| Field                        | What                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `sessions`, `sessionsStatus` | the chat sessions (`channel = 'chat'`, newest activity first); `idle → ready \| error`                               |
| `currentSessionId`           | the open conversation, null for a new one                                                                            |
| `messages`                   | `RenderMessage[]`: `user`, `assistant` (with `provisional`), `tool` (pending → done / error), `error`, `interrupted` |
| `pendingText`                | the deltas of the assistant block being streamed; null between blocks                                                |
| `messagesStatus`             | `loading → ready \| error` for a selected session                                                                    |
| `isStreaming`                | a `POST /chat` is open                                                                                               |

Actions: `fetchSessions`, `newConversation`, `selectSession`, `sendMessage`, `stop`,
`renameSession`, `deleteSession`. `sendMessage` pushes an optimistic user row, streams, then
reloads the canonical rows of the session and refetches the list (the API set the title). The
user row is never double-written: if the connection drops before the server persisted it, the
optimistic row disappears on the next reload (Landmark's documented caveat). `stop()` aborts
the fetch's `AbortController`; the server treats the closed connection as the cancel
(`docs/API.md` → Cancellation, no beacon). The text already streamed stays on screen as a
provisional bubble ("Nije spremljeno") with the "Odgovor prekinut." marker; it was never
persisted, so it is gone on reload.

Failures reach the user by one mechanism: an inline `kind: 'error'` row worded from `labels.ts`
(a pre-stream `ApiHttpError`, a network failure, a failed rename or delete, a mid-stream
`error` event). The two list loads are the exception: a failed session list or conversation load
shows `ErrorState` with a retry, never an empty list. The one state reset on a changed user
happens during render (React's pattern), so no effect sets state synchronously.

## SSE handling

`chatService.streamMessage` posts `{ session_id, message, parent_message_id?, client_context: {
route } }` with `fetch` and reads the body as a `ReadableStream` (not `EventSource`: POST and
the `Authorization` header are needed). `lib/sse.ts` splits on blank lines, ignores `:` comment
frames (`ready`, `keepalive`), joins several `data:` lines with `\n`, and `readSseBody` parses
each payload as JSON; `isChatEvent` drops anything that is not one of the seven event types in
`docs/API.md`. The client dispatches on the JSON's `type` (the `event:` line always equals it).

`normalizeMessages.applyEvent` folds each event into the view: `delta` appends to
`pendingText`; `turn` clears it and appends the canonical assistant row with its `message_id`;
`tool_call` appends a pending chip keyed by `tool_use_id`; `tool_result` flips that chip to done
or error; `done` clears any leftover `pendingText`; `error` appends an error row, and with
`persistence_error` also drops `pendingText` (the block has no row: invariant 1). A pre-stream
non-OK status is thrown as `ApiHttpError(status, code, message)` from the flat envelope.

History is read through supabase-js: `listSessions` (`ai_sessions`, chat only) and
`loadSession` (every row of the session). `normalizeFromPersistedRows` takes the newest row as
the leaf, walks `parent_id` to the root and renders that branch: user rows as text, assistant
rows as text blocks and `tool_use` chips, `tool_result` rows as chip status. The walk already
supports sibling branches; edit/regenerate is a later part. Rename and delete go through the
API (`PATCH` / `DELETE /sessions/:id`); the client never writes a session or message row.

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
attaches the agent's audio tracks to hidden `<audio>` elements, derives `agentSpeaking` from
`ActiveSpeakersChanged`, and tears everything down on disconnect or unmount. `VoiceCallButton`
is props-driven (idle / connecting / live with mute and hang-up); microphone denial and a failed
start are toasts. The button renders only with `VOICE_CALLS_ENABLED` (on in this repository; a
per-user gate before a trial is `WEB-1`). During a call the panel shows a "Poziv u tijeku"
banner; the call's own conversation is a `channel = 'voice'` session, which the list leaves out.
A live transcript during the call is `WEB-2`.

## i18n rules

i18next with the browser language detector: the stored preference first (`localStorage`), then
the browser, `hr` default, `en` fallback, `load: 'languageOnly'` so a Croatian browser's `hr-HR`
lands on `hr`. After sign-in `AuthContext` applies `users.language`; the switcher calls
`setLanguage`, which changes the UI and writes `users.language` through `profileService` (the
one client write RLS allows). Every visible string goes through `t()`; `common.*` holds shared
strings; keys are added to `hr` and `en` together; domain terms stay untranslated. The chip and
client-side error labels in `labels.ts` are Croatian only, like the model's answers and the
API's error messages (`WEB-3`). The Croatian locale and `labels.ts` are placeholders until a
native speaker reads them (`CORE-1`). <!-- needs native review -->

## PWA caching rules

`vite-plugin-pwa` in `generateSW` mode with `registerType: 'autoUpdate'`. The manifest: name and
short name "Asistent", `lang: hr`, `display: standalone`, theme colour `#1d4ed8`, the two
placeholder icons (192, 512, the latter also maskable). Workbox precaches the built app shell
only (`js, css, html, png, svg, ico, webmanifest`) with `index.html` as the navigation fallback,
and has one runtime rule per backend origin, `NetworkOnly` for `VITE_API_URL` and
`VITE_SUPABASE_URL`, so `/chat`, `/voice/*`, `/sessions/*` and every Supabase request are
answered by the network and never stored. The origins are read from the env at build time, so
a build without them has no runtime rules (and still caches nothing from them). To verify in
DevTools: Application → Cache Storage holds only `workbox-precache-*` with the shell; a `/chat`
request shows no `(ServiceWorker)` size.

Chunks: `vendor-react`, `vendor-supabase`, `vendor-livekit` (dynamic), `vendor-markdown`,
`vendor-i18n`, `vendor-icons`, `i18n-locales` (a port of Landmark's `manualChunks`).

## How to run

```
supabase start                                   # the local stack (docs/DB.md)
cp apps/web/.env.example apps/web/.env           # then fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (supabase status), VITE_API_URL
pnpm --filter @va/api dev                        # the API on :3000 (docs/API.md → Running locally)
pnpm --filter @va/web dev                        # Vite on http://127.0.0.1:5173
pnpm --filter @va/web build && pnpm --filter @va/web preview   # the production build with the service worker
```

Sign in with a seed user (`docs/DB.md` → Seed users). The API's `CORS_ORIGINS` defaults to
`*`, so the dev server's origin is accepted. `pnpm exec vitest run apps/web` runs the three test
files (Vitest, `environment: 'node'`; the modules under test are pure).

**Verified 2026-10-29** against the local stack and the API with a live key, driven in headless
Chromium: sign-in as the seed member; a streamed turn that rendered the provisional deltas, a
`search_items` chip pending → done, then the canonical answer; the route moved to `/c/<id>` and
a reload rendered rows identical to the live view; stop on a second question left the
provisional bubble and the interrupted marker, and a reload showed only the persisted rows;
rename and delete through the API; the language switch survived a reload through
`users.language`; an aborted `ai_sessions` request showed the error state with retry; no console
errors. Not run: a Lighthouse "installable" audit (needs an HTTPS origin or `localhost` with the
built app; `REL-4`) and a voice call from the button (the worker was not started; `REL-5`).
