# Security

The checklist every change is reviewed against, the threat notes behind it, and the personal-data
posture (GDPR, Croatia / EU). The `convention-reviewer` agent runs the checklist on every pull
request; the `tool-security-reviewer` agent runs the tool items on every new or changed handler;
`/security-review` is the deeper pass before a release. The plan is
`docs/plan/07-ops-and-quality.md` §5; Landmark's review it ports is its voice plan §8.

## The checklist

Each item names where it is enforced and the test that pins it. A pull request that touches an
item says so in its description.

- [ ] **Every request authenticated; role re-read; no claim trusted.** `authenticateToken` in
      `@va/core` asks GoTrue for the user and re-reads `public.users` with the service role on
      every request (`apps/api/src/middleware/auth.ts`); the worker does the same per turn, cached
      at most 60 s (`IDENTITY_CACHE_MS`, invariant 7). Tests: `A01`–`A07`, `P03`, `P04`, `W03`.
- [ ] **Service-role writes filtered by `user_id` / `session_id`; updates and deletes assert the
      rows they touched.** `apps/api/src/chat/prepare.ts`, `routes/sessions.ts`, `voice/calls.ts`,
      `apps/voice/src/call.ts`, `turn.ts`; the loop's `MessageStore` implementations carry the
      session id. Tests: `V01`–`V10`, `W03b`, `W03c`, `W07`.
- [ ] **Tools read as the user; permissive-RLS tables get explicit scoping; no raw input in
      `.or()`; `ilike` escaped.** `ctx.userClient` (anon key + the user's JWT) in every handler;
      `escapeLike` and `NO_STAR` in `@va/tools-demo` are the pattern (`docs/CORE.md` → Tools).
      Tests: the pack's scenarios, `demo_tables.test.sql` (pgTAP).
- [ ] **The voice allowlist is read-only; dispatch re-applies the gate; speech is untrusted
      input.** `CHANNEL_ALLOWLIST` with the `readOnly` assertion at module load
      (`packages/core/src/tools/registry.ts`); `dispatchTool` resolves the name through the same
      role-and-channel filter and answers an `is_error` result (invariants 4 and 5). Tests:
      `T02`, `T05`, `T08`, `E08`–`E10`, `W06`.
- [ ] **The JWT never leaves our side.** LiveKit job metadata carries only the opaque call token
      and the session id; the browser gets only a LiveKit room token; the `voice_calls` row holds
      the JWT under the token's SHA-256 (`docs/API.md` → Voice call lifecycle). Tests: `V01`,
      `W01`, `W02`.
- [ ] **`voice_calls` rows: hashed token, 15-minute cap, 3-minute idle, deleted on hang-up, swept.**
      `apps/api/src/voice/calls.ts`, `apps/voice/src/call.ts`, the `voice-calls-sweep` pg_cron job
      (`20261028100200_voice_calls.sql`). Tests: `V01`, `V02`, `V06`, `V08`, `W02`, `voice_calls_service_only.test.sql`.
- [ ] **Rate limits on chat turns, voice calls per day, concurrent calls.** `apps/api/src/rate-limit.ts`
      (20 / 5 min, 200 / day, 20 calls / day, 3 concurrent), 50 turns per call in the worker.
      Tests: `P09`–`P11`, `V03`, `W14`. Known: check-then-act race `API-1`.
- [ ] **No content in logs; error messages truncated.** `log()` and `errorReason()` in `@va/core`;
      `L04` scans every call site; the worker strips LiveKit's `lk.pii.*` keys (`W18`); the metrics
      writer refuses content keys (`W13`).
- [ ] **Secrets only in env; `.env*` and `~/.config/va/` ignored and denied to Claude.** One
      `env.ts` per app; `.gitignore`, `.dockerignore`, the `deny` list in `.claude/settings.json`
      (`Read` at any depth, which also covers `Edit`, `Write` and best-effort `Grep` / `Glob`); the
      matrix in `docs/OPS.md` (`X01`–`X03`, both directions).
- [ ] **Dependencies pinned; audit in CI; Dependabot cooldown 14 days.** Exact versions in every
      `package.json`; `pnpm audit --prod --audit-level=high` in `test.yml`; `.github/dependabot.yml`.
- [ ] **CORS limited to the PWA origin(s).** `CORS_ORIGINS` on the API (`*` is the local default
      only; the deploy sets the exact origins). Tests: `P01`.
- [ ] **Prompt text that users hear or read reviewed by a native speaker before release.** Every
      Croatian string is marked `<!-- needs native review -->` until then (`CORE-1`, `VOICE-2`).

## Threat notes

**Identity.** The JWT is Supabase's and proves who the caller is; it never carries the role.
Role and language live in `public.users` and can change after the token was issued, so they are
read on every request, and a revoked profile (no row) is `no_profile` on the next request even
with a valid token. The voice worker's 60 s cache bounds how long a call keeps a stale role.

**The service role.** The API and the worker hold the service-role key for persistence and
identity lookups only. Nothing about those calls is protected by RLS, so the explicit
`user_id` / `session_id` filter on every one of them is the authorisation. A new service-role
query without such a filter is a finding, whatever it reads.

**Tools and RLS.** A tool runs the model's input against the database with the user's own
client, so RLS does the per-row gating; a table whose policy is `USING (true)` gets explicit
scoping in the handler. PostgREST's `.or()` interpolates filter syntax, so nothing from `input`
reaches it; `ilike` patterns are escaped and `*` rejected. Output is bounded in the query, not
only in the schema, because the model will ask for everything.

**Injection surfaces.** Three kinds of text reach the model that we do not write: what the user
typed, what speech-to-text heard, and what a tool returned (a catalogue item's name can contain
instructions). None of them can widen what the model may do: the tool set is fixed by role and
channel before the turn, dispatch re-checks every name, and the prompt is not a boundary. What
injection can still do is make the model say the wrong thing; the spoken channel summarises
rather than enumerates, which also limits what is read aloud on a speaker.

**The voice handoff.** The browser must not learn the worker's credentials and the vendor must
not learn ours. The API mints a LiveKit room token for the browser (15 min, one room) and hands
the worker an opaque 32-byte token through job metadata; the JWT sits in `voice_calls` under the
token's hash, valid 15 minutes from call start (never extended; `refresh` only rotates the JWT),
3 minutes idle, deleted on hang-up by the worker or the API and swept by pg_cron. A worker
without the token refuses the job; a job for a room the token was not bound to is refused.

**Abuse.** Rate limits are counted from the rows that exist, so a refused request writes
nothing and a flaky count fails open (Anthropic's own limits and the request timeout are the
backstop). The concurrent-call cap is global. The known check-then-act race bounds the excess by
what fits in one round trip (`API-1`).

**Logs.** Content never enters a log line: ids, codes, timings, lengths and token counts only,
third-party error messages cut to 200 characters, LiveKit's own PII keys stripped before
stdout. Logs still carry user ids and are personal data; keep them for a bounded time
(`docs/OPS.md` → Logging).

**Supply chain.** Exact pins, a 14-day cooldown on new versions (by hand and in Dependabot), the
production audit in CI, build scripts allowed only for the three native packages
(`pnpm.onlyBuiltDependencies`), images built from the frozen lockfile, no secrets in images.

**Transport.** HTTPS everywhere the browser talks (the PWA requires it; Caddy or the static
host terminates); CORS to the exact PWA origins; the API's body limit is 64 KB and the message
cap 4000 characters; request ids on every response for correlation without content.

**Prompts.** The static system prompt is byte-identical per channel and the per-user block
follows it; nothing in the prompt is a secret and nothing in it grants access. Croatian text a
user hears or reads is reviewed by a native speaker before release; until then it is marked.

## Personal data

What is stored, where, and for how long:

| Data                                      | Where                                   | Lawful basis / note                                                            | Retention                                                                                |
| ----------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| account: email, role, language            | Supabase Auth, `public.users`           | contract (the company's staff)                                                 | the account's life                                                                       |
| chat turns: typed text, answers, tool I/O | `ai_messages`, `ai_sessions`            | contract; may contain what the user pasted                                     | open: proposal 12 months, then delete (`OPS-4`)                                          |
| voice turns: transcripts, spoken answers  | `ai_messages` with `channel = 'voice'`  | contract; no audio is recorded (LiveKit recording off, worker `record: false`) | open decision `OPS-4` (proposal 30 days: a transcript is more sensitive than typed text) |
| the caller's JWT for a live call          | `voice_calls`, service role only        | needed for the worker to act as the caller                                     | ≤ 15 min, deleted on hang-up, swept                                                      |
| logs and metrics: ids, timings, counts    | the host's log store, `apps/voice/logs` | legitimate interest (operations)                                               | proposal 30 days                                                                         |

Sub-processors (Anthropic, LiveKit, Soniox, ElevenLabs, Supabase, the hosting provider) are
listed with regions and transfer basis in `docs/OPS.md` → Deploy sketch; the DPAs, the entries in
the records of processing (_evidencija aktivnosti obrade_) and the SCCs for the US transfers
(Anthropic, ElevenLabs) are `OPS-5`. Audio recording needs a lawful basis and a Croatian-language
announcement (ZEK plus GDPR) and stays off. A subject-access or deletion request is served by
`user_id`: the sessions, their messages and the auth user; the retention sweep, once decided, is
a pg_cron job beside `voice-calls-sweep`.

## Open decisions

- `OPS-3` where the API, the worker and the PWA run (proposal in `docs/OPS.md`).
- `OPS-4` retention for `channel = 'voice'` (and chat) rows, and the sweep that enforces it.
- `OPS-5` the DPA list and the records of processing before the first user trial.
- `CORE-1`, `VOICE-2` the native review of every Croatian string.
