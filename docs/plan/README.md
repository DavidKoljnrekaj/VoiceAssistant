# Implementation plan — the assistant skeleton

Written 2026-10-26 from a read of the Landmark voice assistant (`/home/user/Dev/Pannonia/Landmark`,
branch `feature/voice-latency`) and of `shanraisshan/claude-code-best-practice`. It covers the
**skeleton only**: repository, Claude Code harness, database, the shared conversation engine, the
HTTP API with streaming, the voice worker, the PWA shell, and the quality tooling around them.
Email, WhatsApp, the phone number, company documents and the company platforms were **extension
seams** (Part 8); since 2026-11-03 their order and sizing are **Part 10**, the integration
roadmap, and the phone channel (the car channel, decision 0012) is **Part 11**, the next part to
build.

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
| 10 | [10-integration-roadmap.md](./10-integration-roadmap.md) | 1–7 | map | — |
| 11 | [11-phone-channel.md](./11-phone-channel.md) | hosting (`OPS-3`) | 3 (11a, 11b, 11c) | 12, 14 |
| 12 | [12-write-protocol.md](./12-write-protocol.md) | — | 2 (12a, 12b) | 11, 14 |
| 13 | [13-email-pack.md](./13-email-pack.md) | 12, hosting for the OAuth redirect | 3 (13a, 13b, 13c) | 14 |
| 14 | [14-landmark-pack.md](./14-landmark-pack.md) | the Landmark request (`docs/requests/`), carried out by David | 1 (14V) | 13 |
| 15–16 | written when their turn comes (Part 10 sketches them) | see Part 10 | | |

Roughly 10–12 sessions for the skeleton. Parallel work goes in git worktrees, one session each.

## Status

Tick when a part is merged to `main`.

- [x] Part 1 — repository, tooling, Claude Code harness, CI (2026-10-26)
- [x] Part 2 — Supabase project, schema, RLS, pgTAP, generated types (2026-10-28; applied to the
      dev project 2026-11-03, `REL-1`)
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

- [ ] Part 11 — the phone channel. 11a done 2026-11-03 (migration and pgTAP, `phone` in core,
      `src/phone/` in the worker with W20–W27, decision 0014; `REL-10` applies the migration);
      11b done 2026-11-03 (`phone/gate.ts`, `start.ts`, `keys.ts`, `sip.ts`, `admit.ts`, the
      phone branch of `agent.ts`, call limits in core, W28–W32); 11c (the trunk, the dispatch
      rule and the live checklist through a car) open. Hosts decided 2026-11-03 (decision 0013);
      11c waits for the deploy (`REL-9`, roadmap step 0) and the Twilio number.
- [x] Part 12 — the write protocol. 12a done 2026-11-03 (`confirmation: 'required'` + `preview`
      in the contract, the store port, dispatch, the `confirm` event, `tool_confirmations`,
      `POST /chat` confirm / decline, `create_note` under it, E40–E45, C30–C32, D13–D14, decision
      0015; `REL-11` applied). 12b done 2026-11-03 (the confirm card in the PWA, the worker's
      yes/no turn, W35–W39, N08–N09, H08, K10–K11). Part 12 complete.
