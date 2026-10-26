# Part 9 — Appendix: decisions, open questions, Landmark map, risks

## A. Decision log (recorded as `docs/decisions/` in Part 1)

| # | Decision | Alternatives considered |
|---|---|---|
| 0001 | Node monorepo (pnpm) + Supabase | Mirror Landmark (Deno edge functions + Node worker); Node with own Postgres and auth |
| 0002 | Own Supabase project, single organisation | Multi-tenant from day one; share Landmark's project |
| 0003 | Croatian-first, English fallback | English-first; per-user language |
| 0004 | LiveKit Agents (Node) + Soniox EU + ElevenLabs, behind adapters | Stubs only; re-run the bake-off |
| 0005 | Chat on Opus 5.5 (adaptive, effort from env); voice on Sonnet 5.5 (`between_tools`, low); fallbacks default | One model for both; Haiku 5.5 for voice (unmeasured) |
| 0006 | Hono + zod | Fastify; hand-written JSON Schema |
| 0007 | Abort is a first-class loop exit; no DB cancel beacon | Landmark's beacon (needed only on the Edge runtime) |
| 0008 | Chat streams token deltas (provisional) + canonical blocks | Whole blocks only (Landmark) |
| 0009 | Manual loop, not the SDK Tool Runner | Tool Runner (no control over persistence order, sinks, abort) |
| 0010 | Persist-then-emit for tool results too | Landmark emits results before the row (its OQ-5) |
| 0011 | History bounded by a recursive SQL function | Load every row (Landmark; unbounded) |
| 0012 | PWA reads history via supabase-js under RLS; API writes | API-only access (more code, same security) |
| 0013 | `voice_calls` handoff kept even though the worker is in-process | JWT in LiveKit metadata (transits a third party) |

## B. Open questions for the user (answer before the part that needs them)

| # | Question | Needed by |
|---|---|---|
| 1 | Product name and package scope (currently `@va`) | Part 1 |
| 2 | Supabase region (EU recommended) and who creates the project | Part 2 |
| 3 | Should the demo tool pack's `demo_items` table exist on the dev project, or fakes only? | Part 3 |
| 4 | Which Landmark user maps to which assistant user, when the Landmark pack comes (Part 8) | later |
| 5 | Hosting for api and voice (own VM vs LiveKit Cloud agent hosting vs PaaS) and the LiveKit region | Part 7 |
| 6 | Retention for voice and chat rows; recording policy (recommendation: off) | Part 7 |
| 7 | Who reviews the Croatian prompt, greeting and filler text | before any user test |
| 8 | Is Microsoft Entra sign-in needed in the PWA from the start (Landmark has it)? | Part 6 |
| 9 | Should chat use Sonnet 5.5 at low effort too, after a bench, to cut cost? | after Part 5 bench |

## C. Landmark → new project map

| Landmark file | Port target | What changes |
|---|---|---|
| `supabase/functions/_shared/orchestrator.ts` | `packages/core/src/loop/orchestrator.ts` | abort as first-class exit; persist-then-emit tool results; `textBlock` gets `messageId`; refusal branch; zod validation in dispatch; timers cleared |
| `_shared/tools.ts` | `packages/core/src/tools/{define,registry,schema}.ts` + `packages/tools-demo` | zod inputs; `ToolPack`; allowlist per channel incl. future ones; strict schemas |
| `_shared/prompts.ts` | `packages/core/src/prompts/` | domain rules become a placeholder + pack contributions; document/attachment/route sections dropped |
| `_shared/auth.ts` | `packages/core/src/auth.ts` on `@va/db` | own `users` shape; roles `admin`/`member` |
| `_shared/context-window.ts` | `packages/core/src/loop/history.ts` (reader) + Part 8 (writer) | bounded read; repair step added |
| `_shared/sse.ts` | `apps/api/src/sse/{writer,sink}.ts` | `delta` event; `message_id` on `turn` |
| `_shared/rateLimit.ts` | `apps/api/src/rate-limit.ts` | counts `turn_kind = 'user'`; voice budgets |
| `ai-chat/index.ts` | `apps/api/src/chat/{prepare,stream}.ts`, `routes/chat.ts` | Hono; abort via request signal; session cleanup on pre-stream failure; no attachments, no debug branch, no edit tree |
| `voice-session/index.ts` | `apps/api/src/voice/`, `routes/voice.ts` | voice rate limits; injectable LiveKit wrapper |
| `voice-llm/index.ts` | `apps/voice/src/{assistant-llm,call,warm}.ts` | in-process; identity cached 60 s; no HTTP |
| `voice-llm/sink.ts` | `packages/core/src/sinks/{spoken,speakable}.ts` | wire format removed |
| `voice-llm/messages.ts` | `apps/voice/src/messages.ts` | from `chatCtx` instead of a request body |
| `tools/voice-prototype/src/agent.ts` | `apps/voice/src/agent.ts`, `paragraph-agent.ts`, `metrics.ts` | no stub path; no transcript in logs; hints from a committed list |
| `tools/voice-prototype/src/{llm-bench,call-test,speech-span}.ts` | `apps/voice/scripts/` | in-process bench |
| `ai-chat/tests/{fake-anthropic,fake-supabase,fixtures,harness}.ts` | `packages/core/src/test/` | Node/Vitest; `rpc/` support; app harnesses on top |
| `src/components/AiChat/**` | `apps/web/src/components/Chat/**` | deltas; no attachments, documents, branching UI |
| `src/components/AiChat/{components/VoiceCallButton,hooks/useVoiceCall,services/voiceCallService}` | same names under `Chat/` | endpoints renamed |
| `.claude/**`, `CLAUDE.md`, workflows, dependabot | root | monorepo paths; new rules; two more hooks and skills |
| `supabase/migrations/20261026100000_voice_calls.sql` | Part 2 migration 3 | verbatim |
| `docs/AI_CHAT.md`, `docs/voice/*` | `docs/{CORE,API,VOICE,WEB,DB,OPS,SECURITY}.md` | rewritten for the new layout |

Not ported on purpose: the DB cancel beacon, the debug tool branch, attachments, document generation,
`search_help` and the help KB, the edit/regenerate tree UI, the ERP and domain rules, the phase 0
harness (`tools/phase0`; its decisions carry over as settings).

## D. Risks and how the plan handles them

| Risk | Handling |
|---|---|
| `@livekit/agents` `llmNode` does not accept our stream shape | Part 5 §3 design B (loopback OpenAI-compatible shim) is Landmark's proven path |
| `@hono/node-server` does not abort `req.signal` on client disconnect | Part 4 verifies live; `SSEWriter` write-failure detection is the fallback; timeouts bound the worst case |
| Strict tool schemas rejected for some zod shapes | drop `strict` per tool; zod validation at dispatch remains |
| Sonnet 5.5 `between_tools` rejected at effort > high | `modelProfile` only sends it at ≤ high; test M pins it |
| Latency targets missed | Landmark's ordered next steps are the backlog (Part 5 §10); measure before tuning |
| Croatian text never reviewed | every file marks `<!-- needs native review -->`; `/done` checks it; pre-ship gate in `docs/SECURITY.md` |
| Scope creep into integrations | Part 8 is a map; `/done` and the reviewer agent flag app code outside the part's deliverables |
| Secrets in context or repo | `settings.json` deny on `.env*`; `.gitignore`; keys in `~/.config/<product>/` |

## E. Glossary of ids used in tests

`E` engine, `H` history, `T` tools registry, `M` model profiles, `S` spoken sink (core);
`P` pre-stream, `C` chat stream, `V` voice session endpoints (api); `W` worker (voice);
pgTAP files by table or function name (db). Backlog ids are `<AREA>-n`; pinned-but-questionable
behaviour is `OQ-n` in `docs/backlog/<area>.md`.
