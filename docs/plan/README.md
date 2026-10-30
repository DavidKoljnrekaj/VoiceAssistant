# Implementation plan — the assistant skeleton

Written 2026-10-26 from a read of the Landmark voice assistant (`/home/user/Dev/Pannonia/Landmark`,
branch `feature/voice-latency`) and of `shanraisshan/claude-code-best-practice`. It covers the
**skeleton only**: repository, Claude Code harness, database, the shared conversation engine, the
HTTP API with streaming, the voice worker, the PWA shell, and the quality tooling around them.
Email, WhatsApp, PSTN, company documents and the company platforms are **extension seams**
(Part 8), not work in this plan.

## How to use these files

Every part is written to be pasted into a fresh Claude Code session together with the brief.

1. Open a new session in the repo root (`/home/user/Dev/Pannonia/VoiceAssistant`).
2. Paste the "Prompt for the session" block at the top of the part file. From Part 2 onwards the
   repo exists, so the prompt just tells the session to read `docs/plan/00-brief.md` and the
   part file. For Part 1 the files do not exist in a repo yet, so paste the two documents in full.
3. Let the session plan, then implement. Each part ends with an acceptance checklist and a
   `/done` run. Review the diff, merge, start the next part in a new session.
4. When a session finds something the plan left open, it should ask once, then record the
   answer in `docs/decisions/` (Part 1 creates that folder).

Parts can be split where the file says "can be split". Do not merge two parts into one session:
each part is sized to finish well inside one context window.

## Order and dependencies

| Part | File | Depends on | Sessions | Can run in parallel with |
|---|---|---|---|---|
| 0 | [00-brief.md](./00-brief.md) | — | paste with every part | — |
| 1 | [01-bootstrap-and-harness.md](./01-bootstrap-and-harness.md) | — | 1 | — |
| 2 | [02-database.md](./02-database.md) | 1 | 1 | 3a (with hand-written types) |
| 3 | [03-core-engine.md](./03-core-engine.md) | 1, 2 (types) | 2–3 (3a, 3b, 3c) | — |
| 4 | [04-api.md](./04-api.md) | 2, 3 | 1–2 | 6 (once the SSE contract is fixed) |
| 5 | [05-voice-worker.md](./05-voice-worker.md) | 3, 4 (voice session endpoints) | 2 | 6 |
| 6 | [06-web-pwa.md](./06-web-pwa.md) | 4 | 2 | 5 |
| 7 | [07-ops-and-quality.md](./07-ops-and-quality.md) | 4, 5, 6 | 1 | — |
| 8 | [08-extension-seams.md](./08-extension-seams.md) | all | later | — |
| 9 | [09-appendix.md](./09-appendix.md) | — | reference | — |

Roughly 10–12 sessions for the skeleton. Parallel work goes in git worktrees, one session each.

## Status

Tick when a part is merged to `main`.

- [x] Part 1 — repository, tooling, Claude Code harness, CI (2026-10-26)
- [x] Part 2 — Supabase project, schema, RLS, pgTAP, generated types (2026-10-28; the migrations
      are applied to no project yet, `REL-1`)
- [x] Part 3a — core: types, tool registry, prompts, fakes (2026-10-28, #6)
- [x] Part 3b — core: orchestration loop, history assembly (2026-10-28, #7)
- [x] Part 3c — core: spoken-text sink (2026-10-28, #9)
- [x] Part 4 — api: auth, chat SSE, sessions, voice session endpoints (2026-10-28, #8)
- [x] Part 5 — voice worker on LiveKit with Soniox and ElevenLabs (2026-10-29, #10, #11)
- [x] Part 6 — web PWA: auth, chat panel, call button (2026-10-29, #12; `REL-4`, `REL-5` open)
- [x] Part 7 — ops: env, logging, CI hardening, deploy sketch, security checklist (2026-10-29,
      #13; branch protection and the first `compose.dev.yml` run are `release.md`, `REL-6`)

The skeleton is reviewed in `docs/review-2026-10-30.md`; what it found and did not fix is in
`docs/backlog/`.
