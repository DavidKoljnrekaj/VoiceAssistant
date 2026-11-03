# Part 11 — The phone channel: a number that rings the worker

## Prompt for the session

```
Read docs/plan/00-brief.md, docs/plan/10-integration-roadmap.md and docs/plan/11-phone-channel.md,
then implement Part 11a on a branch feat/phone-channel from main. Restate the deliverables and the
acceptance checklist first and ask me only about what the plan leaves open (the trunk, the number and
the provider account are mine; the SIP credentials go in ~/.config/<product>/voice.env, which you never
read). Before writing the SIP path, read the installed @livekit/agents and @livekit/rtc-node type
definitions for the SIP participant attributes and the DTMF event and confirm the names; say what you
found. Unit tests run against the @va/core fakes with no LiveKit connection. Write the migration with
/new-migration and never apply it to a project. When done, run /done, update docs/VOICE.md and
docs/DB.md, record decision 0014, and report.
```

Can be split: **11a** schema, caller identity, JWT minting, the `phone` channel in core; **11b** the
worker's SIP path (dispatch, PIN by DTMF, refusals, hang-up) with tests; **11c** the trunk, the live
checklist through a real car, the bench, the runbook steps.

Depends on step 0 of the roadmap (a hosted worker). 11a and 11b can be built and tested before
the worker is hosted; 11c cannot.

## Goal

A caller dials the assistant's number from the car. LiveKit's SIP trunk puts the call in a room and
dispatches the existing worker. The worker resolves the caller from the number, asks for a PIN by
keypad where the role requires one, and from then on the call is the voice channel as built:
Soniox, the engine in-process with the spoken sink, ElevenLabs, barge-in, rows persisted after each
answer, the credential deleted on hang-up. Tools still read as the caller under RLS, through a JWT
the worker mints for that call. Nothing in the loop, the sink or the tool registry changes.

Landmark's plan §2, §8 and §9 (`docs/voice/02-voice-implementation-plan.md` there) specify the
identity model; this part ports it to the skeleton's shape and adds what the in-process worker
makes simpler (the worker starts its own session; no API call precedes a phone call).

## Deliverables

```
supabase/migrations/<ts>_phone_channel.sql     voice_caller_identities; ai_sessions.caller_identity_id; grants, RLS, comments
supabase/tests/database/voice_caller_identities.test.sql
packages/core/src/channel.ts                   Channel gains 'phone' (settings cloned from voice)
packages/core/src/prompts/index.ts             'phone' uses the voice intro and presentation (same bytes, same cache key)
packages/db/src/database.ts                    regenerated (/db-types) once the migration is on the dev project (REL-1)
apps/voice/src/
├── phone/
│   ├── caller.ts         resolveCaller(service, phoneE164) → identity | 'unknown' | 'withheld' | 'locked'
│   ├── e164.ts           normalise('0911234567' | '00385…' | '+385…') → '+385…' or null
│   ├── mint.ts           mintCallJwt(authUserId, ttlMs) (HS256 with the project secret) or the magic-link fallback (§4)
│   ├── pin.ts            PinGate: collects DTMF digits with a timeout, verifies the hash, counts failures, locks
│   ├── start.ts          startPhoneCall(service, identity, room, sipCallId) → ai_sessions(channel 'phone') + voice_calls row + call token
│   └── lines.ts          PHONE_LINES_HR: greeting, PIN prompt, wrong PIN, refused, locked, goodbye  <!-- needs native review -->
├── job.ts                acceptDispatchedJob also accepts a SIP job (room name prefix + the SIP participant attributes), still refuses anything else
├── agent.ts              entry branches: in-app (call token from metadata) | phone (resolve, PIN, start, then the shared path)
├── tools.ts              VOICE_ALLOWLIST gains phone: the same list as voice (one source, two keys)
└── env.ts                SUPABASE_JWT_SECRET (optional; without it the fallback path), PHONE_PIN_* settings (§7)
apps/voice/scripts/phone-test.md               the manual checklist (no script can dial the PSTN from CI)
docs/VOICE.md                                   → The phone channel; the LiveKit trunk and dispatch rule; the measurements table gains a transport column
docs/DB.md                                      → voice_caller_identities
docs/RELEASE-RUNBOOK.md                         → enrolling a caller, rotating a PIN, the trunk's secrets
docs/decisions/0014-caller-identity-and-minted-jwt.md
```

## Specification

### 1. Telephony (LiveKit SIP)

- A LiveKit **inbound trunk** on the EU SIP endpoint (`<sub>.eu.sip.livekit.cloud`), the
  provider's trunk pointed at it with its region set to Dublin or Frankfurt; a **dispatch rule**
  that puts every call into its own room (`phone-<call id>`), with `agentName` = the worker's
  `AGENT_NAME` and static metadata `{ "channel": "phone" }`. Krisp noise cancellation on the
  trunk if the provider's leg allows it; recording off at the project (unchanged).
- The provider and the number are the user's (open question 11). A Croatian `+385` number needs
  the provider's regulatory bundle (company registration, address); an EU number elsewhere works
  the same for the trunk. Caller ID must be passed through unchanged; withheld numbers arrive as
  `anonymous` or empty.
- The worker learns the caller from the SIP participant's attributes (`sip.phoneNumber`,
  `sip.trunkPhoneNumber`, `sip.callID`; confirm the names against the installed types) and the
  channel from the job metadata. A room with neither a call token nor the phone metadata is
  refused, as today.

### 2. Caller identity (schema)

```sql
CREATE TABLE public.voice_caller_identities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone_e164          text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  label               text,                       -- 'mobitel', 'auto'
  pin_hash            text,                       -- argon2id; required when the role needs a PIN (§5)
  pin_failed_attempts integer NOT NULL DEFAULT 0,
  pin_locked_until    timestamptz,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES public.users(id)
);
CREATE UNIQUE INDEX ... ON voice_caller_identities (phone_e164) WHERE active;
ALTER TABLE public.ai_sessions ADD COLUMN caller_identity_id uuid REFERENCES public.voice_caller_identities(id) ON DELETE SET NULL;
```

- RLS on; **no policy for `authenticated`** in this part (enrolment is an admin action that the
  companion part adds a policy for); service role only, like `voice_calls`. The number is personal
  data: covered by the same retention and subject-access handling as `users` (`docs/SECURITY.md`).
- The session stores the identity id, not the number, so a number change or deletion does not
  rewrite history and the transcript carries no phone number.
- pgTAP: service-only access, the E.164 check, one active row per number, cascade on user delete.
- Enrolment in this part: an SQL step in `docs/RELEASE-RUNBOOK.md` (insert with a hash computed by
  a `tools/` script, never over the phone). The companion part (roadmap step 5) adds the admin page.

### 3. Resolution (`caller.ts`)

1. Normalise the inbound number to E.164 (`+385`, a leading `0`, `00385`); anything that does not
   normalise, or an empty or `anonymous` caller ID, is `withheld`.
2. `withheld` or no active identity → **refuse before the model sees anything**: one fixed
   Croatian line, hang up, log `phone refused` with `reason` and a hash of the number (never the
   number). The line does not reveal whether the number is known and does not offer enrolment.
3. `pin_locked_until > now()` → `locked`: one fixed line, hang up, log.
4. Otherwise the identity, with the user's row read fresh (`authenticateToken` later re-reads the
   role on the 60 s cache as today, invariant 7).

### 4. The RLS client without a browser (`mint.ts`)

Tools must run as the caller (invariant 6). Two ways to get a JWT `auth.uid()` accepts, in order
of preference; **open question 16 decides which the dev project allows**, and the session confirms
it against the project's JWT settings before writing code:

- **Mint** `{ sub: auth_user_id, aud: 'authenticated', role: 'authenticated', iat, exp: now + 15 min }`
  signed HS256 with the project's legacy JWT secret (`SUPABASE_JWT_SECRET`, worker only, never in
  the API). One mint per call; `authenticateToken` verifies it the same way it verifies a browser
  JWT, so nothing downstream knows the difference.
- **Fallback** when the project uses asymmetric signing keys and exposes no secret:
  `auth.admin.generateLink({ type: 'magiclink' })` then `verifyOtp({ token_hash })` with the
  service client, which yields a real session JWT. Two extra round trips at call start (budget
  them in the greeting), and the link must never be logged or sent anywhere.
- **Rejected:** running tool handlers on `serviceClient` for phone callers. That removes the RLS
  backstop on the one channel whose identity is spoofable.

Decision 0014 records the choice and the reason.

### 5. PIN by keypad (`pin.ts`)

- Required when the identity has a `pin_hash`; enrolment refuses a null hash for roles the
  settings name (`PHONE_PIN_ROLES`, default `admin`; open question 12 may make it every role).
- 4–6 digits collected as **DTMF, never speech**: Croatian digit recognition on a phone line is
  unreliable and DTMF keeps the PIN out of the transcript. The worker listens for the room's DTMF
  event (confirm the event name on `@livekit/rtc-node`), ends on `#` or after six digits, times out
  after `PHONE_PIN_TIMEOUT_MS` (default 10 s, one re-prompt).
- Verify with argon2id. Three failures → `pin_locked_until = now() + 15 min`, the locked line,
  hang up, log `pin locked` (identity id, no digits), and an alert hook (the same place the
  identity-timeout log goes; `OPS` picks it up).
- Until the PIN is verified **no model call is made and no session row exists**: the greeting
  and the prompts are fixed lines spoken by TTS, not model output.
- Cost: about five seconds at the start of a protected call. Record it in the checklist.

### 6. Starting the call (`start.ts`) and the shared path

The in-app call's `POST /voice/sessions` creates the `ai_sessions` row, the `voice_calls` row and
the call token, then dispatches. For a phone call the dispatch comes first, so the worker does the
same work itself, then joins the path the in-app call already takes:

1. Rate limits as the API applies them (`checkVoiceRateLimits`: 20 calls per user per day, 3
   concurrent globally) through the same function, moved into `@va/core` or a shared module the
   API and the worker both import (it is DB-side counting, so it belongs below the apps).
2. Insert `ai_sessions { channel: 'phone', external_id: <sip call id>, caller_identity_id, title }`
   and `voice_calls { session_id, user_id, call_token_hash, platform_call_id: room, access_token:
   <minted JWT>, expires_at: min(jwt exp, now + 15 min) }`: the same shape, the same cap, the
   same sweep, the same `CallIdentity.resolve` afterwards. The call token is generated by the
   worker and used only in-process.
3. From here the code path is the existing one: `CallIdentity`, warm-up, greeting, `AssistantAgent`,
   `runVoiceTurn`, deferred persistence, `endCall`. The 50-turn cap and the 15-minute cap hold.
4. Hang-up: the SIP participant leaving ends the call (the existing `participantLeft` rule keyed
   on the caller's identity); the worker ends it from its side with the goodbye line then
   `room.disconnect()` on the cap, a refusal or a lock.

### 7. Channel and settings

- `Channel` gains `'phone'`; `CHANNEL_DEFAULTS.phone` is a copy of `voice` (same model, effort,
  `between_tools`, 1024 tokens, 4 iterations, 6 s / 25 s, 20 rows). Env overrides
  `AI_PHONE_MODEL`, `AI_PHONE_EFFORT` (the matrix test in `docs/OPS.md` catches the additions).
- The static prompt for `phone` is the voice prompt, byte for byte, so the two channels share the
  cache entry; the per-user block is the same. If the phone needs a different line later, it gets
  its own constant and its own cache key, measured.
- `VOICE_ALLOWLIST` names `phone` with the same array as `voice` (one constant, two keys); the
  readOnly assert covers both. Rate limits above. Logging: the existing `timing` line gains
  `channel`; no number, no digits, no transcript (invariant 9).
- New env: `SUPABASE_JWT_SECRET` (optional), `PHONE_PIN_ROLES` (default `admin`),
  `PHONE_PIN_TIMEOUT_MS` (10000), `PHONE_PIN_MAX_FAILURES` (3), `PHONE_PIN_LOCK_MS` (900000).

### 8. Spoken lines (`lines.ts`) <!-- needs native review -->

Fixed TTS lines, not model output: the greeting that names the assistant and asks for the PIN
("Unesite PIN i pritisnite ljestve."), wrong PIN, refused ("Ovaj broj nije prijavljen."), locked,
and the goodbye. The in-app greeting stays as it is.

### 9. Security review points (`docs/SECURITY.md` gains a section)

- Caller ID is not authentication: PIN for the named roles, refusal of unknown and withheld
  numbers before any model call, lockout, alerting on repeated failures.
- The minted JWT: 15-minute TTL, one per call, stored only in `voice_calls` (service role only),
  deleted on hang-up, swept; the secret lives in the worker's env only.
- No phone number in logs, transcripts or session rows; a hash in the refusal log only.
- Rate limits per user hold; add a per-number attempt counter for unknown numbers (`refused`
  more than N times an hour → the alert hook) so a scan of the number is visible.
- GDPR: the identities table in the records of processing; recording stays off; the trunk
  provider joins the DPA list (`OPS-5`).

### 10. Testing

- Unit: `e164` cases; `PinGate` state machine (correct, wrong, timeout, lock, `#` and six-digit
  end); `resolveCaller` against `fake-supabase` (known, unknown, withheld, inactive, locked);
  `mintCallJwt` verified by the same code path `authenticateToken` uses in the fakes.
- Worker scenarios (`W` ids, through the harness): a phone job with a known number reaches the
  greeting and a first turn whose tool runs under the minted JWT (RLS asserted through the fake's
  request log); an unknown number never calls the model; a wrong PIN three times locks and never
  calls the model; rows carry `channel 'phone'` and `caller_identity_id`; the 50-turn cap and the
  15-minute cap behave as for voice.
- pgTAP for the new table and the new column.
- Live checklist (11c, `apps/voice/scripts/phone-test.md`): ten takes from a real phone over a car's
  Bluetooth: first audio after end of speech for a direct answer and a lookup, barge-in, a wrong
  PIN, a withheld number, hang-up from the car, hang-up on the cap. Figures from `turns.jsonl`
  (`e2e_ms`, `llm_ttft_ms`, Soniox delays) plus a stopwatch for the SIP leg the worker cannot see.
  Record them in `docs/VOICE.md` with `transport: sip` next to the WebRTC figures. The targets are
  the same (first sound ≤ 1.5 s, lookup ≤ 4 s); expect the SIP leg and narrowband audio to add.

## Acceptance checklist

- [ ] Migration written with `/new-migration`, pgTAP green on the local stack, not applied anywhere.
- [ ] `Channel` has `phone`; the prompt bytes equal voice's; the matrix test passes with the new env.
- [ ] A phone job with a known number: greeting, PIN where required, first turn, tool under RLS,
      rows with `channel 'phone'`; with an unknown or withheld number: one line, hang-up, no model.
- [ ] Three wrong PINs lock the identity for 15 minutes and log without digits.
- [ ] `voice_calls` row for a phone call has the minted JWT, the 15-minute cap, is deleted on hang-up.
- [ ] No phone number or digit in any log line (the log-fields test extended).
- [ ] 11c: the live checklist ran through a real car and `docs/VOICE.md` holds the figures.
- [ ] `docs/VOICE.md`, `docs/DB.md`, `docs/SECURITY.md`, `docs/RELEASE-RUNBOOK.md` updated; decision
      0014 recorded; `/done` green.

## Open in this part (ask once, record the answer)

- Open questions 11, 12, 13 and 16 of the roadmap.
- Whether `checkVoiceRateLimits` moves to `@va/core` or to a small shared module under `packages/`
  (the dependency rule allows either; core is simpler).
