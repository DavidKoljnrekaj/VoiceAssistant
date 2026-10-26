# Part 0 — Project brief (paste with every part)

## 1. What we are building

An AI assistant for the company that a user can **type to** (web PWA) and **talk to** (in-app
voice call), with the same brain behind both. Later it will also answer on WhatsApp and on a phone
number, read and act on email, search company documents, and reach into the company's own
platforms. **This plan builds the skeleton:** the repository and tooling, the Claude Code harness,
the database, one shared conversation engine with streaming and tool calling, an HTTP API, a voice
worker, and a PWA shell. Every integration listed above is a seam the skeleton leaves open, not
work in this plan.

The reference implementation is the voice assistant in **Landmark** (Cognilion), on disk at
`/home/user/Dev/Pannonia/Landmark` (branch `feature/voice-latency`, 2026-10-26). It is a working
in-app voice call on LiveKit with Soniox speech-to-text and ElevenLabs text-to-speech, answering
through a shared agent loop with tool calling, persisted sessions, prompt caching and a measured
latency budget. We port its **design and invariants**, not its domain. Its own plan is
`docs/voice/02-voice-implementation-plan.md` there; its dev-build notes are `docs/voice/04-dev-build.md`.

## 2. Decisions already made (do not re-open in a session)

| Decision | Choice | Why |
|---|---|---|
| Backend shape | **Node monorepo + Supabase.** `packages/core` (engine), `apps/api` (HTTP), `apps/voice` (LiveKit worker, imports the engine in-process), `apps/web` (PWA). Supabase = Postgres, Auth, Storage | One runtime (Node 24), one test runner (Vitest). The voice worker calls the engine in-process, so no `voice-llm` HTTP hop and no OpenAI-chunk wire format on the hot path |
| Identity | **Own Supabase project, single organisation.** `users` with `auth_user_id`, `role`, `language`; RLS per user | Standalone product. An `organizations` table can be added by one later migration; nothing in the skeleton assumes multi-tenancy |
| Language | **Croatian-first, English fallback.** Prompts and spoken rules in Croatian; UI hr + en; domain terms never translated. Code, comments, docs, tool descriptions in English | Same as Landmark; the voice rules (numbers, dates, declension of acronyms) are Croatian-specific |
| Voice stack | **LiveKit Agents (Node) on LiveKit Cloud EU, Soniox `stt-rt-v5` EU with vocabulary hints, ElevenLabs `eleven_v4_turbo`**, behind adapters with stubs for tests | Landmark's phase 0 bake-off chose them (Soniox 98 % term accuracy vs 37–77 % for others); measured tuning values carry over |
| Model provider | **Anthropic Claude via `@anthropic-ai/sdk`**, pinned exact version | Landmark's engine, prompt caching and tests are built on it |
| Chat model | `claude-opus-5-5`, thinking omitted (adaptive), `output_config.effort` from env (default `medium`), `fallbacks: "default"` with beta `server-side-fallback-2026-07-01` | Current Opus; cheaper than Sonnet 4.6; refusal fallback on by default |
| Voice model | `claude-sonnet-5-5`, `thinking: { type: "between_tools" }`, effort `low`, same fallback | Landmark measured: whole answer p50 4.5 s vs 6.8 s on Sonnet 4.6, fewer tool rounds; `between_tools` is the only way to keep a caller from hearing a thinking pause and only Sonnet 5.5 accepts it |
| HTTP framework | **Hono** on `@hono/node-server` | Web-standard `Request`/`Response`, so Landmark's edge-function handlers and its in-process test harness port almost verbatim (`app.request(req)`) |
| Validation | **zod** for request bodies, env, and tool inputs; tool JSON Schema derived from zod; inputs re-validated at dispatch | The SDK's parser can hand back truncated tool input; validation at dispatch is the real guard |
| Cancellation | Client aborts the fetch; server reads the request's abort signal; **abort is a first-class loop exit** that persists synthetic tool results | Landmark needed a DB "cancel beacon" because the Edge runtime hid disconnects. Node does not; the beacon is not ported |
| Chat streaming | Token deltas **and** whole-block events | Landmark streams whole blocks only (its frontend predates streaming). The loop already has the delta seam; use it from day one |
| Package manager | pnpm workspaces | Monorepo; filters per package in hooks and CI |

## 3. Stack and versions

Pin **exact** versions. Only add a version that is at least two weeks old (Landmark rule; Dependabot
cooldown 14 days). Resolve the current versions at bootstrap time with `pnpm view <pkg> time`.

| Layer | Package |
|---|---|
| Runtime | Node 24 (`.node-version`), pnpm 10, TypeScript 5.x strict, ESM everywhere |
| Engine | `@anthropic-ai/sdk` (Landmark pins 0.97.0; use the newest ≥ 14 days old), `zod` 4, `@supabase/supabase-js` 2.x |
| API | `hono`, `@hono/node-server` |
| Voice | `@livekit/agents` 1.9.x and its plugins `-soniox`, `-elevenlabs`, `-silero` (pinned **together**, same version), `@livekit/rtc-node`, `livekit-server-sdk` 2.19.x, `openai` (only if the local OpenAI-compatible fallback shim is used) |
| Web | React 18, Vite 7, Tailwind 4, `react-router-dom` 7, `i18next` + `react-i18next`, `livekit-client` 2.22.x, `vite-plugin-pwa`, `lucide-react` |
| Tests | Vitest 5, pgTAP via `supabase test db`, Playwright later |
| Lint | ESLint 9 flat config + `typescript-eslint`, Prettier |

## 4. Repository layout

```
VoiceAssistant/
├── CLAUDE.md                     # < 200 lines; points at .claude/rules and docs/
├── .claude/                      # settings.json, rules/, hooks/, skills/, agents/
├── .github/workflows/            # test.yml, db-tests.yml; dependabot.yml
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.js  vitest.workspace.ts
├── packages/
│   ├── core/                     # @va/core — the engine: loop, tools registry, prompts, history, sinks, fakes
│   ├── db/                       # @va/db   — generated Supabase types, client factories, env
│   └── tools-demo/               # @va/tools-demo — one example tool pack (the contract for real packs)
├── apps/
│   ├── api/                      # @va/api   — Hono: /chat (SSE), /voice/sessions, /health
│   ├── voice/                    # @va/voice — LiveKit Agents worker; imports @va/core
│   └── web/                      # @va/web   — React PWA: auth, chat panel, call button
├── supabase/                     # config.toml, migrations/, tests/database/ (pgTAP), seed.sql
├── docs/                         # ARCHITECTURE.md, CORE.md, API.md, VOICE.md, WEB.md, TESTING.md, decisions/, backlog/, plan/
└── tools/                        # repo-level scripts only (no app code)
```

`@va` is a placeholder scope; rename once in Part 1 if the product has a name. Dependency
direction is strict: `web → api` (HTTP only), `api → core → db`, `voice → core → db`,
`tools-* → core` (types only). `core` never imports an app, never does HTTP, never imports LiveKit
or React.

## 5. Architecture in one picture

```
 browser (PWA) ──HTTP/SSE──▶ apps/api ──▶ @va/core.runOrchestrationLoop ──▶ Anthropic
      │                        │                 │  tools run as the user (RLS client)
      │                        │                 └─ MessageStore ──▶ Supabase (service role, user-filtered)
      │  POST /voice/sessions  │
      │◀── LiveKit room token ─┘── creates ai_sessions(channel='voice') + voice_calls(JWT by opaque token)
      │                                              └─ dispatches the agent with { callToken } in job metadata
      └──WebRTC──▶ LiveKit Cloud ──▶ apps/voice worker: Soniox STT ─▶ @va/core loop (in-process,
                                                       SpokenTextSink) ─▶ ElevenLabs TTS
```

One brain: one loop, one tool registry, one role gate, one prompt lineage. Channels differ only
through an `EventSink`, a `MessageStore`, `LoopHooks` and a `ChannelSettings` row.

## 6. The invariants (non-negotiable, enforced by tests and rules)

1. **Persist before emit.** A DB row is the contract; a wire event is its projection. Token deltas are
   the one exception and are explicitly provisional: the `turn` event that follows carries the
   canonical text, and a `persistence_error` tells the client to drop provisional text.
2. **Tool results of one turn go back in one user message, in `tool_use` order**, dispatched
   concurrently, each with its own timeout and abort signal. Splitting them teaches the model to stop
   calling tools in parallel.
3. **A branch never ends on a bare `tool_use`.** Abort, timeout and persistence failure are
   first-class exits that persist a `tool_result` row (real outputs for finished tools, a synthetic
   `is_error` result for the rest). History assembly repairs any unanswered `tool_use` it still finds.
4. **Default-deny per channel.** A tool reaches chat when registered; it reaches voice (and every later
   channel) only when its name is in that channel's allowlist, in a reviewed diff. Every allowlisted
   voice tool is `readOnly: true`, asserted at module load and in a test.
5. **The gate is applied at dispatch, not only at advertisement.** The model can name any tool; dispatch
   resolves it through the same role-and-channel filter, and an unknown or forbidden name becomes an
   `is_error` tool result, logged.
6. **Tools read as the user.** Handlers use `ctx.userClient` (anon key + the user's JWT) so RLS applies.
   `ctx.serviceClient` is for session and message persistence only, and every such call carries an
   explicit `user_id` or `session_id` filter. The prompt is not a security boundary; speech-to-text
   output is an injection surface.
7. **Identity is re-read on every request**, never trusted from the token's claims. (The voice worker
   may cache it for at most 60 s per call.)
8. **The static system prompt is byte-identical per channel** and carries the cache breakpoint. Per-user
   and per-request text goes after it. No clock, locale or environment reads inside the prompt builders.
9. **No message content in logs.** Log ids, codes, timings, token counts and lengths. Never transcripts.
10. **Services throw; nothing returns `[]` or `0` in place of an error.** A failed load is an error state,
    not an empty result.

## 7. Channels

| Setting | chat | voice |
|---|---|---|
| sink | `SseEventSink` (deltas + blocks + tool events) | `SpokenTextSink` (text only, filler, held first sentence, speakable rewriting) |
| history source | DB, bounded walk from the leaf | the call's own context (worker memory), last 20 messages, system messages dropped |
| persistence | per row, inside the loop | deferred, after the answer, fire-and-forget |
| model / effort / thinking | Opus 5.5 / `medium` / adaptive | Sonnet 5.5 / `low` / `between_tools` |
| `max_tokens` | 8192 | 1024 |
| max iterations | 10 | 4 |
| tool timeout | 15 s | 6 s |
| request timeout | 90 s | 25 s |
| rate limits | 20 user turns / 5 min, 200 / day (tool-result rows do not count) | 50 turns per call, 20 calls per user per day, 3 concurrent calls globally |
| compaction | later (port Landmark `context-window.ts`) | off |

## 8. Conventions

- **Code**: TypeScript strict, ESM, named exports, no default exports except React components and the
  LiveKit agent entry. Files 150–300 lines as a target. Import order: node → third-party → `@va/*` → relative.
- **Errors**: a stable `code` plus a Croatian user-facing `message`; the error catalogue lives in
  `@va/core/errors`. HTTP pre-stream failures are a flat `{ error: { code, message } }` with a real status;
  mid-stream failures are `error` events on a 200 stream.
- **Tests**: Vitest, `*.test.ts` beside the code. Scenario tests carry an id in the name (`E07 …`), assert
  on the wire output, the rows and the requests sent, never on internals. Fakes stand in for the
  **services** (the Anthropic Messages API and PostgREST/GoTrue over `fetch`), never for the SDKs.
  A bug fix starts with a failing test named after the backlog id. Never delete, skip or loosen an
  assertion to get green.
- **Git**: `main` protected; `feat/…`, `fix/…`, `chore/…` branches; conventional commits with a scope
  (`feat(core): …`); squash merge; CI required. One behaviour change per commit; a deliberate
  behaviour change updates its tests in the same commit, never inside a refactor.
- **Docs**: every package has one doc in `docs/`; new files or changed behaviour update it in the same
  change. Decisions go in `docs/decisions/NNNN-title.md` (one page: context, decision, consequences).
  Anything found and not fixed goes in `docs/backlog/` with an id.
- **Prompts**: written from developer to model, "Vi" addresses the model. Tool names are not repeated
  in the prompt (the tools array advertises them) except where the prompt must say *when* to call one.
  Croatian text that users will hear or read needs a native-speaker review before release; mark it
  `<!-- needs native review -->` until then.
- **Logs**: one JSON object per line with a `tag` (`[api]`, `[core]`, `[voice]`), ids and timings.

## 9. What every session must do before it says "done"

1. Run `/done` (typecheck, lint on changed files, unit tests, edge-case review, housekeeping).
2. Update the package's doc in `docs/` and `docs/ARCHITECTURE.md` if the layout changed.
3. Add backlog entries for anything found and not fixed; close any it fixed.
4. Report: what was built, how it was verified, what was skipped and why, and any open question for the
   user. Never report a red check as done.

## 10. Glossary

- **Channel** — where a conversation happens (`chat`, `voice`; later `whatsapp`, `phone`). Decides sink,
  settings and tool allowlist.
- **Sink** — `EventSink`, the loop's output port. One per channel.
- **Store** — `MessageStore`, the loop's persistence port. Chat inserts per row; voice defers.
- **Turn** — a real user message plus every assistant / tool_use / tool_result row until the next real
  user message. History is cut on turn boundaries only.
- **Leaf** — the newest row of a session; the active branch is the walk from the leaf to the root through
  `parent_id`.
- **Filler** — the one sentence the voice sink speaks when the first tool call starts ("Samo trenutak,
  provjeravam."), so the line is never silent while tools run.
- **Speakable** — the deterministic rewriting of model text into what text-to-speech should read
  (acronyms as declined words, no markup, "eura" not "EUR").
- **Opaque call token** — a random 32-byte value whose SHA-256 is stored in `voice_calls` next to the
  caller's JWT; it travels to the worker through LiveKit job metadata, so the JWT never leaves our side.
