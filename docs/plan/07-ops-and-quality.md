# Part 7 — Operations and quality: env, logging, CI hardening, deploy sketch, security checklist

## Prompt for the session

```
Read docs/plan/00-brief.md and docs/plan/07-ops-and-quality.md, then implement Part 7 on a branch
chore/ops from main. Restate the deliverables and the acceptance checklist first and ask me only about
what the plan leaves open (hosting provider and regions are my call; propose, do not decide). When
done, run /done, update docs/ARCHITECTURE.md and docs/OPS.md, and report.
```

## Goal

Make the skeleton operable and keep it honest: one place for configuration, logs that can be read
without leaking content, CI that catches what the hooks catch locally, a deploy path that respects EU
data residency, and a security checklist that every later part is reviewed against.

## Deliverables

```
docs/OPS.md                      env matrix, secrets handling, logging fields, deploy, runbook
docs/SECURITY.md                 the checklist and the threat notes
.github/workflows/test.yml       + coverage upload, + web build, + Docker build smoke (no push)
.github/workflows/e2e.yml        optional Playwright smoke against the dev stack (secrets-gated, manual dispatch)
apps/*/Dockerfile                (api and voice from Parts 4 and 5; web static build)
compose.dev.yml                  api + voice + web dev against a local Supabase (optional convenience)
packages/core/src/log.ts         log(tag, event, fields) JSON-line helper used by every app
```

## Specification

### 1. Configuration

- Every app has `env.ts` parsed with zod at startup; a missing variable fails fast with the variable name.
- `.env.example` per app lists every variable with a one-line comment and no values.
- Secrets live in the host's secret store (and locally in `~/.config/<product>/*.env`, outside the repo).
  Claude Code is denied `Read` on `.env*` by `settings.json`; never work around it.
- A matrix in `docs/OPS.md`: variable × app × where it is set (local, CI, dev, prod).

### 2. Logging

`log(tag, event, fields)` writes one JSON line: `{ ts, tag, event, ...fields }`. Allowed fields are ids,
codes, booleans, numbers, durations, token counts, lengths. A lint-style unit test greps the log call
sites for forbidden field names (`text`, `message`, `content`, `transcript`, `token`, `jwt`) in `apps/*`
and `packages/*`. Error messages from third parties are truncated to 200 chars before logging.

Per-turn timing lines (api and voice) are the raw material for latency dashboards later; keep their field
names stable and documented.

### 3. CI hardening

- `test.yml`: add `pnpm --filter @va/web build` (catches Vite config and type errors in JSX), `docker build`
  for api and voice without pushing, coverage summary as an artifact. Required check on `main`.
- `db-tests.yml`: unchanged from Part 1; required check.
- `e2e.yml` (optional, after Part 6): Playwright smoke against the dev Supabase project, gated on secrets
  being present (assert like Landmark's `e2e.yml`), `workflow_dispatch` and PRs to `main`; refuses to run
  unless `VITE_SUPABASE_URL` equals an allowlisted dev URL (Landmark's guard).
- Dependabot already configured; add a weekly reminder in `docs/OPS.md` to merge the grouped PR.

### 4. Deploy sketch (proposal, decided by the user)

| Component | Where | Notes |
|---|---|---|
| Supabase | Supabase EU (Frankfurt) | Postgres, Auth, Storage; pg_cron enabled for the voice sweep |
| `apps/api` | a Node host in the EU (Hetzner VM with Docker, Fly.io `fra`, or Render Frankfurt) | long-lived SSE connections: no serverless; one instance is enough for v1 |
| `apps/voice` | the same host as a second container, or LiveKit Cloud agent hosting (EU) | needs outbound to LiveKit, Soniox EU, ElevenLabs, Anthropic, Supabase; CPU for Silero |
| `apps/web` | static hosting with HTTPS (Vercel, Cloudflare Pages, or the same host behind Caddy) | PWA needs HTTPS |
| LiveKit | LiveKit Cloud, EU region | |

Sub-processors to record for GDPR (Croatia / EU): Anthropic, LiveKit, Soniox (EU), ElevenLabs (US — a
transfer; needs SCCs), Supabase (EU). Recording off at the platform; transcripts only (Landmark §8).
Retention for `channel = 'voice'` rows is an open decision; put it in `docs/SECURITY.md`.

### 5. Security checklist (`docs/SECURITY.md`)

Reviewed on every PR by the `convention-reviewer` and, for tools, the `tool-security-reviewer`:

- [ ] Every request authenticated; role re-read; no claim trusted.
- [ ] Service-role writes filtered by `user_id` / `session_id`; `assertRowsAffected` on updates and deletes.
- [ ] Tools read as the user; permissive-RLS tables get explicit scoping; no raw input in `.or()`; `ilike` escaped.
- [ ] Voice allowlist is read-only; dispatch re-applies the gate; speech is treated as untrusted input.
- [ ] JWT never leaves our side (LiveKit metadata carries only the opaque token; the browser gets only a LiveKit token).
- [ ] `voice_calls` rows: hashed token, 15-min cap, 3-min idle, deleted on hang-up, swept.
- [ ] Rate limits on chat turns, voice calls per day, concurrent calls.
- [ ] No content in logs; error messages truncated.
- [ ] Secrets only in env; `.env*` ignored and denied to Claude.
- [ ] Dependencies pinned; audit in CI; Dependabot cooldown 14 days.
- [ ] CORS limited to the PWA origin(s).
- [ ] Prompt text that users hear or read reviewed by a native speaker before release.

### 6. Runbook (`docs/OPS.md`)

Port the useful parts of Landmark's `docs/AI_CHAT.md` → Troubleshooting into a symptom → check table
for the new layout: 401s, 429s, mid-stream error codes, "stream opens but nothing arrives" (proxy
buffering), "call connects but the agent is silent" (worker not dispatched: `AGENT_NAME` mismatch),
"first sound takes 6 s" (ParagraphAgent not in use / filler held by TTS), "tool refused at dispatch"
(allowlist), plus the curl recipes and the bench commands.

## Acceptance checklist

- [ ] CI runs web build and Docker builds; both required checks green on `main`.
- [ ] `docs/OPS.md` and `docs/SECURITY.md` exist with the sections above; the env matrix matches every `env.ts`.
- [ ] The log-field lint test passes across apps and packages.
- [ ] `compose.dev.yml` brings up api + voice + web against a local Supabase (or is explicitly skipped with the reason).
- [ ] Backlog: hosting decision, voice retention, DPA list, Playwright smoke.

## Landmark references

- `.github/workflows/{test,e2e,db-tests}.yml`, `.github/dependabot.yml`
- `docs/AI_CHAT.md` → Security Posture, Deployment, Operations, Troubleshooting
- `docs/voice/02-voice-implementation-plan.md` §8 (security review, GDPR), §10 (pre-ship gates)
- `docs/voice/04-dev-build.md` → Not done yet (what a production rollout still needs)
