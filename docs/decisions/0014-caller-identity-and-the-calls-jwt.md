# 0014 — Caller identity on the phone channel: enrolled number, keypad PIN, a session from a magic link

## Context

A phone call reaches the worker with nothing but the trunk's caller ID, which is spoofable, and
no browser session, so there is no JWT for the tools to read under RLS (invariant 6). The dev
project signs tokens with an ECC P-256 key the worker does not hold (decision 0013). Landmark's
plan §9 specified the identity model for its own PSTN channel; this records what the skeleton
built in Part 11a and why it differs where it does.

## Decision

- **Identity is an enrolled number plus a keypad PIN.** `voice_caller_identities` maps one active
  E.164 number to a user (a user may have several numbers). The PIN is collected as DTMF, never
  speech, 4 to 6 digits, hashed with scrypt from `node:crypto` (no native dependency; Landmark
  said Argon2id or bcrypt, and against a six-digit space the hash function is not the defence,
  the lockout is). Every pilot caller has a PIN; `PHONE_PIN_ROLES` can relax that per role later.
  Three wrong PINs lock the number for 15 minutes; a correct one resets the counter. A withheld,
  unknown, inactive, locked or PIN-less number is refused before any model call, with one fixed
  line that does not say whether the number is known, and a log line that carries a hash of the
  number, never the number.
- **The call's JWT comes from GoTrue's magic-link flow**, not from the worker signing one:
  `auth.admin.generateLink({ type: 'magiclink' })` with the service role, then `verifyOtp` with
  the token hash on an anon client (`createAnonClient()` in `@va/db`). The access token goes into
  `voice_calls` under the 15-minute cap like the in-app call's; the refresh token is dropped; the
  session is revoked with `admin.signOut(token, 'local')` at hang-up. Alternatives: signing HS256
  with the previous secret (works until the key is revoked, then every call fails at once);
  running tool handlers on the service client (removes the RLS backstop on the one channel whose
  identity is spoofable).
- **Service role only** on the identities table, like `voice_calls`: a signed-in user must not
  learn which numbers are enrolled or their lock state. Enrolment is an admin step in the
  release runbook until the companion app adds narrow policies with their own pgTAP test.
- **The session row points at the identity** (`ai_sessions.caller_identity_id`), not at the
  number, so the transcript carries no phone number and a deleted identity leaves the session.

## Consequences

Two GoTrue round trips at the start of every phone call, inside the greeting. Enrolment needs an
email on the auth user (the magic link is minted for it) and a PIN hash from
`pnpm --filter @va/voice pin-hash`. The `@va/core` test fake answers `admin/generate_link`,
`verify` and `logout` so the flow is tested end to end without a project. Until the migration is
on the dev project and `/db-types` runs (`REL-10`), the worker types the table by hand in
`apps/voice/src/phone/db.ts`. Part 11b wires these pieces into the SIP job path.

## Date

2026-11-03
