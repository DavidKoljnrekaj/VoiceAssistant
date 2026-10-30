# Part 6 — `apps/web`: the PWA shell with chat and the call button

## Prompt for the session

```
Read docs/plan/00-brief.md and docs/plan/06-web-pwa.md, then implement Part 6 on a branch feat/web from
main. Restate the deliverables and the acceptance checklist first and ask me only about what the plan
leaves open. The SSE contract is fixed in docs/API.md; do not change it from here. Keep the UI minimal
and props-driven; this is a shell, not the final design. When done, run /done, write docs/WEB.md, and
report with a screenshot or a description of a streamed turn in the browser against the local API.
```

Can be split: **6a** scaffold, auth, PWA, i18n, layout; **6b** chat panel and the call button.

## Goal

A installable web app where a user signs in, types to the assistant and watches the answer stream with
tool progress, browses past conversations, and starts an in-app voice call. Landmark's `AiChat`
module is the base, trimmed to the skeleton.

## Deliverables

```
apps/web/
├── index.html  vite.config.ts (react, tailwind, vite-plugin-pwa)  public/ (icons, manifest assets)
├── src/
│   ├── main.tsx  App.tsx  i18n.ts  index.css
│   ├── lib/supabase.ts         createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
│   ├── lib/api.ts              apiFetch(path, init) → adds Authorization from the session; API base from VITE_API_URL
│   ├── lib/featureFlags.ts     VOICE_CALLS_ENABLED (compile-time constant, like Landmark)
│   ├── contexts/AuthContext.tsx   session, profile (users row), loading; sign in / out
│   ├── contexts/ToastContext.tsx
│   ├── components/ui/          Button, Input, Spinner, Alert, ErrorState, ConfirmDialog (minimal)
│   ├── components/Auth/LoginForm.tsx
│   ├── components/Layout/      AppShell (header, main), LanguageSwitcher
│   ├── components/Chat/
│   │   ├── ChatProvider.tsx    context + useChat()
│   │   ├── hooks/useChatStore.ts
│   │   ├── services/chatService.ts     streamMessage (SSE client), listSessions, loadSession, renameSession, deleteSession
│   │   ├── lib/normalizeMessages.ts    rows / events → RenderMessage[]
│   │   ├── lib/labels.ts               Croatian tool and error labels
│   │   ├── ChatPanel.tsx  MessageList.tsx  Message.tsx  ToolChip.tsx  Composer.tsx  SessionList.tsx
│   │   └── components/VoiceCallButton.tsx + hooks/useVoiceCall.ts + services/voiceCallService.ts
│   ├── locales/hr/translation.json  locales/en/translation.json
│   └── types/{api,database}.ts  (api event types; database re-exported from @va/db types)
├── src/**/*.test.ts            normalizeMessages, SSE parser, labels
└── docs/WEB.md
```

## Specification

### 1. Scaffold

Vite + React 18 + TypeScript; Tailwind 4 via `@tailwindcss/vite`; `vite-plugin-pwa` with
`registerType: 'autoUpdate'`, a manifest (name, short name, hr `lang`, icons 192/512, `display: standalone`,
`theme_color`), and a Workbox config whose runtime caching has **`NetworkOnly` for the API origin and the
Supabase origin** and precaches the app shell only. `manualChunks` for react, supabase, livekit (dynamic
import), i18n locales (port the relevant lines of Landmark's `vite.config.ts`).

Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`. `.env.example` committed.

### 2. Auth

`AuthContext` mirrors Landmark's shape: Supabase session via `onAuthStateChange`, then the `users`
profile row (RLS self-read); `loading` until both resolve; `signInWithPassword`, `signOut`. Protected
routes redirect to `/login`. No Microsoft sign-in in the skeleton (seam: add a provider button later).

### 3. i18n

`i18next` + `react-i18next` + browser language detector with the stored preference first; `hr` default,
`en` fallback; `common.*` for shared strings; domain terms untranslated. The switcher writes the
preference to `users.language` through supabase-js (the one client write the RLS allows).

### 4. Chat

- **Provider above the router** (`App.tsx`: `<AuthProvider><ChatProvider><Router>…`), so the stream reader
  survives navigation. `useChatStore` is called once, by the provider; consumers use `useChat()`.
- **Store** (`useChatStore`): sessions, current session, `messages: RenderMessage[]`, `isStreaming`,
  `pendingText` (accumulated deltas of the current assistant block), `sendMessage`, `stop`, `newConversation`,
  `selectSession`, `renameSession`, `deleteSession`. Optimistic user row on send (with Landmark's documented
  caveat: never double-write the user row). `stop()` aborts the fetch's `AbortController`; the server treats
  that as the cancel. Failures are inline `kind: 'error'` rows worded from `labels.ts` (one mechanism).
- **Service** (`chatService.streamMessage`): `fetch` + `ReadableStream` (not `EventSource`: POST and
  headers are needed); split on `\n\n`, ignore `:` comments, concatenate `data:` lines, dispatch by
  `type`. Handles `delta` (append to `pendingText`), `turn` (replace `pendingText` with the canonical text
  and the `message_id`), `tool_call` / `tool_result` (chips keyed by `tool_use_id`), `done`, `error`
  (`persistence_error` discards `pendingText`). Pre-stream HTTP errors throw `ApiHttpError(status, code, message)`.
- **History**: `listSessions` (`channel = 'chat'`, newest first) and `loadSession` through supabase-js
  (RLS); `normalizeFromPersistedRows` derives the active branch (newest row is the leaf; walk `parent_id`)
  and renders tool_use/tool_result pairs as chips. Rename and delete go through the API (`PATCH` / `DELETE /sessions/:id`).
- **UI**: `ChatPanel` (session list drawer + message list + composer), `Message` (user / assistant text,
  Markdown rendered with `react-markdown` + `remark-gfm` for assistant text), `ToolChip` (pending → done /
  error, Croatian label from `labels.ts`), `Composer` (auto-grow textarea, Enter to send, Shift+Enter newline,
  stop button while streaming). Failed loads show `ErrorState`, never an empty list.

### 5. Voice call

Port Landmark's three files with minimal change: `voiceCallService` calls `POST /voice/sessions`,
`/refresh` on `TOKEN_REFRESHED`, `/end`; `useVoiceCall` loads `livekit-client` on first use, connects,
enables the microphone with echo cancellation / noise suppression / auto gain, attaches hidden audio
elements for the agent's track, tracks `agentSpeaking` from `ActiveSpeakersChanged`, tears down on
disconnect or unmount; `VoiceCallButton` in the chat header with idle / connecting / live (mute, hang up)
states and toasts for microphone denial and start failure. Hidden when `VOICE_CALLS_ENABLED` is false.
During a call the panel shows a "Poziv u tijeku" banner; a live transcript is a backlog item.

### 6. Tests

Vitest with `environment: 'node'` for pure modules: the SSE frame parser (frames split across chunks,
comments ignored, `data:` concatenation), `normalizeMessages` (rows → branch → chips; events → state;
`persistence_error` drops pending text), `labels`. Component tests are deferred; a Playwright smoke
(login → send → see a `turn`) is Part 7's optional item.

## Acceptance checklist

- [x] `pnpm --filter @va/web dev` serves the app; sign-in against the local Supabase stack works with the seed users. (2026-10-29, `docs/WEB.md` → Verified)
- [x] A streamed turn renders deltas live, then the canonical text; tool chips go pending → done; stop aborts cleanly; refresh shows the persisted conversation identical to the live one. (2026-10-29)
- [x] Session list, rename, delete work; a failed list shows an error state. (2026-10-29)
- [ ] The app installs as a PWA (Lighthouse "installable"); the service worker never caches API or Supabase responses (verify in DevTools). (The built `sw.js` was inspected: shell precache, `NetworkOnly` for both origins. The Lighthouse audit and the DevTools check are `REL-4`.)
- [ ] Language switch persists; every visible string exists in hr and en. (The switch persists through `users.language`. The tool-chip and client-side error labels in `labels.ts` are Croatian only, `WEB-3`.)
- [x] Call button appears only with the flag on; with the worker running (Part 5) a call connects and the agent is heard (or stated as not tested). (Flag verified; the call itself was not tested, `REL-5`.)
- [x] `docs/WEB.md`: layout, state model, SSE handling, why the provider sits above the router, i18n rules, PWA caching rules, how to run.

## Do not

- Import the Supabase client in a hook (ESLint enforces it).
- Use `EventSource`.
- Build edit/regenerate branching, attachments or document cards now (the `parent_id` walk already supports branches later).
- Cache `/chat` or Supabase in the service worker.

## Landmark references

- `src/components/AiChat/` (all of it; trim), `src/types/aiChat.ts`, `src/lib/featureFlags.ts`
- `src/components/AiChat/components/VoiceCallButton.tsx`, `hooks/useVoiceCall.ts`, `services/voiceCallService.ts`
- `docs/AI_CHAT.md` → Frontend Architecture (state model, SSE consumption, optimistic write, hoisting above the router)
- `vite.config.ts` (chunks), `src/i18n.ts`, `.claude/rules/i18n.md`
