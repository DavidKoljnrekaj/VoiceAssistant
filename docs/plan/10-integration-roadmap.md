# Part 10 — Integration roadmap: call first, then the companion

Written 2026-11-03 from `docs/research/2026-11-03-call-first.md` and decision
[0012](../decisions/0012-phone-call-first.md). The skeleton (Parts 1–7) is built; this part orders
the integrations Part 8 left as seams and sizes each one. It is a map and a schedule, not a
session: every step below gets its own part file before a session starts on it, the way Part 8
asks. Part 11 (the phone channel) is written; the later files are written when their turn comes,
from the sketches here.

## Why this order

The product is used in a car. A phone call over the car's Bluetooth hands-free profile is the
one channel that works in every car with no app and no screen; the in-app PWA call does not
survive a locked phone and is shut out of Android Auto (research §2). So the phone number comes
first, everything a caller needs from the car comes next (email, documents, data), and the PWA
becomes the companion that shows afterwards what the car heard and drafted. Hosting is a
prerequisite because a phone number that rings a developer's laptop is not a product.

## Steps

| Step | Part | What                                                   | Depends on   | Sessions | Decisions to record                                      |
| ---- | ---- | ------------------------------------------------------ | ------------ | -------- | -------------------------------------------------------- |
| 0    | —    | Hosting: the worker and the API run 24/7 in the EU     | `OPS-3`      | 1        | 0013 hosting                                             |
| 1    | 11   | The phone channel: trunk, caller identity, PIN, bench  | 0            | 3        | 0014 caller identity and the minted JWT                  |
| 2    | 12   | The write protocol: confirmation in the loop, chat UX  | —            | 2        | 0015 writes on voice only with an unforgeable confirmation |
| 3    | 13   | The email pack: read and triage, then reply            | 1, 2         | 3        | 0016 email provider and token storage                    |
| 4    | 14   | The company pack: documents and named queries over the company API | 1 | 2–3  | 0017 the company API contract                            |
| 5    | 15   | The handoff and the PWA as companion: calls in the list, drafts, enrolment, admin | 1, 3 | 2 | — |
| 6    | 16   | WhatsApp: calls through LiveKit Connectors, text later | 1, 5         | 2        | 0018 WhatsApp route                                      |
| 7    | —    | Native wrapper for the in-app call                     | 5            | ?        | only if the companion needs a lock-screen call           |

Steps 2 and 4 do not depend on the phone channel and can run in parallel with it in worktrees.
Step 3 waits for both 1 and 2: replying from the car is the first write on voice, and it needs
the protocol and the channel. Compaction (Part 8 §5), attachments (§6) and multi-organisation
(§7) stay where they are; none is on the car's path.

## Step 0 — hosting (prerequisite)

The decision is the user's; the proposal is `docs/OPS.md` → Deploy sketch (one Hetzner VM in
Falkenstein with the api and voice containers behind Caddy, Cloudflare Pages for the PWA, Supabase
Frankfurt, LiveKit Cloud EU). `OPS-1` (built `dist`, not tsx, which also removes the worker's
6 s import, `VOICE-4`) ships with it. Done when the live checklist in `docs/VOICE.md` runs against
the hosted worker and `REL-6` (secrets, required checks) is closed. Closes `VOICE-1`, `OPS-3`.

## Step 1 — the phone channel (Part 11, written)

`docs/plan/11-phone-channel.md`. In one line: a LiveKit SIP inbound trunk and dispatch rule put a
caller into a room the existing worker already knows how to answer; the worker resolves the
caller from the number, asks a PIN by DTMF where the role requires one, mints a short-lived JWT
so every tool still reads under RLS, writes its own `ai_sessions` and `voice_calls` rows so the
rest of the call lifecycle is unchanged, and the bench runs through a real car.

## Step 2 — the write protocol (Part 12, sketch)

What Part 8 §2 specifies, with the sharpening from the research: the confirmation is a
one-time id issued by the channel after the user agreed, and the tool refuses without it.

- `defineTool` gains `confirmation: 'required'`; such a tool is `readOnly: false` by definition.
- Loop: the first call of a confirmed tool runs the handler in `preview` mode, which returns a
  summary and a `confirmation_id` the loop stores (session-scoped, single-use, five-minute expiry)
  and emits as a `confirm` event; the model's turn ends there. The channel asks. On "yes" the
  channel re-enters the loop with the id in the user message's metadata (never in text), the loop
  passes it to the handler, the handler executes and writes an audit row
  (`tool_executions`: user, session, tool, input hash, confirmation id, outcome). The model cannot
  mint an id; a call with an unknown, used or expired id is an `is_error` result, logged.
- Chat UX: a confirm card with the summary and two buttons. Voice UX: the spoken summary and a
  yes/no turn; the worker matches a short closed set of Croatian affirmatives and negatives in
  code before the model sees the turn, so an injected "the user already agreed" cannot confirm.
- Invariant 4 is amended in the same part: a voice allowlist entry may name a write tool only when
  the tool carries `confirmation: 'required'`, asserted at load with the existing readOnly assert.
  Decision 0015 records it. The voice prompt line "ne možete unositi promjene" becomes "promjene
  radite samo uz potvrdu" in the part that first allowlists a write.
- Tests: E scenarios through the loop (preview, confirm, refuse on a forged id, refuse on a
  reused id, abort between preview and confirm leaves no write), a C scenario for the card, a
  pgTAP file for `tool_executions`.

## Step 3 — the email pack (Part 13, sketch)

`packages/tools-email`, one provider adapter behind it (Microsoft Graph first unless the
company is on Google Workspace; open question 10).

- **Credentials:** `user_integrations` (user, system, encrypted refresh token, scopes, connected
  at, last error); the PWA's settings page runs the OAuth consent (step 5 delivers the page; until
  then a script in `tools/` for the pilot users). Delegated permissions, `offline_access`, the
  narrowest scopes (`Mail.Read`, `Mail.Send`, `Calendars.Read`), tenant admin consent once.
- **Read tools (chat and voice):** `list_unread` (sender, subject, received, a two-sentence
  summary written by the tool, never the body; short ids), `read_thread` (the latest message
  cleaned of signatures and quoted text, bounded), `search_mail`, `list_calendar_today`. Voice
  variants: at most five items, no addresses spoken, names resolved through `find_contact`.
- **Write tools (chat first, voice after step 2):** `reply` and `flag`, both `confirmation:
  'required'`; `send_new` chat-only; no delete anywhere. Recipient allowlist in code (the
  company domain plus people the user has corresponded with), a daily send cap per user, and the
  reply is sent as a draft that the PWA can still open.
- **Injection surface:** the tool wraps every message body as data (`<email>` block, instructions
  stripped of imperative lines is not reliable, so the prompt's data-handling rules say bodies are
  quoted material), and the voice summary is written by the tool from headers and the first
  sentences, not by the model over the full body.
- **Voice UX:** the catch-up loop ("sedam novih, dvije izgledaju hitno; prva je od …; odgovoriti,
  preskočiti ili označiti?"), a working set in `CallSession` so "reply to the second" survives the
  20-row history window.
- **Compliance before the first mailbox:** DPAs (`OPS-5`), retention (`OPS-4`), the records of
  processing updated.

## Step 4 — the company pack (Part 14, sketch)

`packages/tools-company` over the small API the company server will expose.

- **Contract to agree first (decision 0017):** the API takes our user's identity (it validates our
  Supabase JWT, or we mint a signed assertion per call) and trims by that user's permissions; it
  exposes named parameterised queries (`customers.find`, `orders.recent`, …) and a document search
  (`documents.search` with lexical scoring and Croatian diacritic folding, `documents.get` with a
  bounded excerpt), never free SQL; results are small and structured, with a `voice` shape where
  a tool is allowlisted for voice.
- One `defineTool` per named query, generated from a committed manifest so the pack and the API
  cannot drift silently; `domainRules` carry that system's data landmines into the prompt.
- Open: who builds the API, where it runs, how it authenticates us (open question 14).

## Step 5 — the handoff and the PWA as companion (Part 15, sketch)

- Phone sessions appear in the conversation list with their channel; a call's turns render as
  the transcript, with the tool cards and the drafts the call produced.
- "Stavit ću to u aplikaciju": a `note_for_app` tool (read-only from the data's point of view,
  it writes a row in the user's own session) the car can call, shown as a card in the PWA.
- Caller enrolment and PIN set/reset for admins; email connection for the user; the call button
  stays behind `WEB-1` until a native wrapper exists.

## Step 6 — WhatsApp (Part 16, sketch)

Calls first, through LiveKit Connectors (no SIP trunk, identity from `wa_id` mapped to
`users.phone_e164`); the same worker, channel `whatsapp`. Text as Part 8 §3 specifies, after calls.

## Open questions for the user (also in `09-appendix.md` §B)

| #  | Question                                                                                                  | Needed by |
| -- | --------------------------------------------------------------------------------------------------------- | --------- |
| 10 | Is the company on Microsoft 365 or Google Workspace, and can a tenant admin grant consent?                 | Step 3    |
| 11 | Telephony provider and number: Twilio or Telnyx, a Croatian `+385` number or any EU number; whose account?  | Step 1    |
| 12 | Which roles need a PIN on the phone: every caller, or only roles that hear financial data?                 | Step 1    |
| 13 | How many pilot callers, and who enrols them (admin page in step 5, or SQL in the runbook until then)?        | Step 1    |
| 14 | The company API: who builds it, where it runs, how it authenticates our users?                              | Step 4    |
| 15 | Is a native wrapper for the in-app call wanted at all, or does the phone number cover the car entirely?     | Step 5    |
| 16 | Does the dev Supabase project use the legacy HS256 JWT secret or asymmetric signing keys (decides the minting path in Part 11 §4)? | Step 1 |
