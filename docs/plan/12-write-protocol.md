# Part 12 — The write protocol: a tool that changes something runs only after the user confirmed

## Prompt for the session

```
Read docs/plan/00-brief.md, docs/plan/10-integration-roadmap.md and docs/plan/12-write-protocol.md,
then implement Part 12a on a branch feat/write-protocol from main. Restate the deliverables and the
acceptance checklist first and ask me only about what the plan leaves open. The confirmation id
must never reach the model: assert it in a scenario. Write the migration with /new-migration and
never apply it. When done, run /done, update docs/CORE.md, docs/API.md and docs/DB.md, record
decision 0015, and report.
```

Can be split: **12a** the protocol in core, the store and the migration, the API's confirm and
decline, the demo pack's write tool under it, scenario tests; **12b** the chat confirm card in
the PWA, the voice worker's yes/no turn and its in-memory store, the prompt line for the spoken
channels (measured with the bench).

Depends on nothing hosted. Part 13 (email) depends on it: a reply from the car is the first
write on a spoken channel.

## Goal

The skeleton refuses writes by prompt and by the spoken channels' allowlist. Email replies, flags
and notes need writes, and the research (`docs/research/2026-11-03-call-first.md` §3) found one
shape every email agent converged on: read freely, draft by default, execute a write only after
an explicit confirmation enforced in deterministic code. The model asks; the channel confirms;
the id that unlocks the write never passes through the model, so an injected "the user already
agreed" cannot confirm anything. Every executed write leaves an audit row.

## The protocol

1. The model calls a tool whose definition says `confirmation: 'required'`.
2. Dispatch validates the input as always, then, with no confirmation on this request, calls the
   tool's `preview(input, ctx, extras)`, which returns one Croatian sentence saying what would
   happen. The loop stores a pending confirmation (session, user, tool, a hash of the validated
   input, the summary, a five-minute expiry) and gets an id. The `tool_result` row says
   `{ pending_confirmation: true, summary, instruction }` and carries **no id**. After the row is
   persisted the sink gets a `confirm` event with the id, the tool, the summary and the expiry.
   The model reads the result, tells the user what would happen and asks; the instruction in the
   result says not to call the tool again until the user has answered.
3. The channel asks. Chat: a card with the summary and two buttons. Voice (12b): the model's
   question is the prompt; the worker keeps the id in call state.
4. The user says yes. The channel re-enters the loop with the id in the request's `extras`
   (`extras.confirmation = { id }`), never in message text, and a user row that says what the
   user said ("Da."). The model calls the tool again with the same input. Dispatch sees the
   confirmation on the request, consumes the id (pending, unexpired, same session, user, tool and
   input hash, single use), runs the handler, records `executed` or `failed` with the error
   code, and returns the handler's output. A changed input, a used or expired id, or an id of
   another session is not an error for the user: dispatch logs why and issues a fresh preview.
5. The user says no. The channel marks the id `declined` and sends the user's words as a plain
   turn; the model acknowledges. An id nobody answers expires; `consume` reports it as such.

Abort between preview and confirmation writes nothing: the id stays pending until it expires.
A tool with `confirmation: 'required'` must have `readOnly: false` and a `preview`; `defineTool`
throws otherwise. The registry's spoken-channel assertion (invariant 4) becomes: a tool named
for `voice` or `phone` is read-only **or** carries `confirmation: 'required'`; decision 0015
records the amendment.

## Deliverables (12a)

```
packages/core/src/tools/define.ts        confirmation?: 'required'; preview?(input, ctx, extras): Promise<string>; extras.confirmation?: { id }
packages/core/src/tools/registry.ts      assertAllowlist: write tools on a spoken channel only with confirmation
packages/core/src/loop/ports.ts          ConfirmationStore port on LoopConfig; EventSink.confirm; ToolOutcome.pending
packages/core/src/loop/confirmations.ts  inputHash (stable JSON, sha256), CONFIRMATION_TTL_MS, the pending result the model reads
packages/core/src/loop/dispatch.ts       the preview / consume / execute branch, a DispatchContext object instead of nine positional args
packages/core/src/loop/tool-round.ts     sink.confirm after the tool_result row, in tool_use order
packages/core/src/sinks/*.ts             confirm: no-op in the buffered and spoken sinks (12b gives the spoken one a hook)
packages/core/src/prompts/chat.hr.ts     one rule under ## Alati: a pending confirmation is told to the user and asked, never retried unasked
packages/core/src/test/tools.ts          a confirmation test tool (preview + handler that records executions)
packages/core/src/loop/confirm.test.ts   E40–E45
supabase/migrations/<ts>_tool_confirmations.sql + tests/database/tool_confirmations.test.sql
apps/api/src/chat/confirmations.ts       DbConfirmationStore (service role, every query by session_id and user_id)
apps/api/src/chat/prepare.ts             body: confirm | decline (uuid, exclusive); validation before the stream; the user row as given
apps/api/src/sse/sink.ts                 the confirm event
packages/core/src/errors.ts              confirmation_invalid (400): unknown, used, expired or foreign id
packages/tools-demo/src/tools/create-note.ts   confirmation: 'required', preview; its D scenario updated and a confirm path added
docs/CORE.md, docs/API.md, docs/DB.md, docs/SECURITY.md (the threat note), docs/decisions/0015-writes-only-with-an-unforgeable-confirmation.md
```

## Specification

### 1. The definition (`define.ts`)

```ts
interface ToolDefinition<I> {
  …
  readOnly: boolean
  /** Set on a tool that writes: the handler runs only on a confirmed request. */
  confirmation?: 'required'
  /** One Croatian sentence saying what `handler(input)` would do; reads only. */
  preview?(input: I, ctx: AuthContext, extras: ToolHandlerExtras): Promise<string>
}
interface ToolHandlerExtras { …; confirmation?: { id: string } }
```

`defineTool` throws when `confirmation` is set with `readOnly: true` or without `preview`.

### 2. The store port (`ports.ts`)

```ts
interface PendingConfirmation { sessionId; userId; tool; inputHash; summary; expiresAt: string }
interface ConfirmationStore {
  issue(c: PendingConfirmation): Promise<{ id: string } | { id: null; code?: string }>
  /** Single use: the first matching consume wins. */
  consume(id: string, match: { sessionId; userId; tool; inputHash }): Promise<'ok' | 'not_found' | 'mismatch' | 'used' | 'expired'>
  settle(id: string, outcome: 'executed' | 'failed', errorCode?: string): Promise<void>
}
```

`LoopConfig.confirmations` is required: chat passes the DB-backed store, voice (12b) an
in-memory one per call, the tests a fake that records. `issue` never throws: a failed issue is
an `is_error` result ("confirmation could not be recorded") and nothing runs.

### 3. Dispatch

After the gate and the zod validation, for a tool with `confirmation: 'required'`:

- `inputHash = sha256(stableStringify(parsed.data))` (keys sorted recursively).
- With `extras.confirmation`: `consume(id, { sessionId, userId, tool, inputHash })`. On `ok`
  run the handler; `settle(id, 'executed')` or `settle(id, 'failed', code)` on a throw (the
  throw still becomes the usual `is_error` result). On anything else log `confirmation not
  consumed` with the reason and fall through to a preview.
- Without one, or after a fall-through: `summary = await preview(parsed.data, …)` (its throw is
  an `is_error` result), `issue(…)` → the outcome `{ output: PENDING_RESULT(summary), isError:
  false, pending: { id, tool, summary, expiresAt } }`.

The sink's `confirm` is emitted by `persistThenEmit` after the `tool_result` row, after that
tool's `toolResult` event, so a client sees the result and the card in order. The id is in the
`confirm` event and the store, nowhere else: not in the row, not in the model's messages, not in
a log line (a hash of it may be logged).

### 4. The migration

```sql
CREATE TABLE public.tool_confirmations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tool         text NOT NULL,
  input_hash   text NOT NULL,
  summary      text NOT NULL,
  outcome      text NOT NULL DEFAULT 'pending'
                 CHECK (outcome IN ('pending', 'executed', 'failed', 'declined', 'expired')),
  error_code   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  confirmed_at timestamptz,
  settled_at   timestamptz
);
```

RLS: the owner reads their own rows (the audit the companion app will show); every write is the
service role, filtered by `session_id` and `user_id`. `consume` is one conditional UPDATE
(`outcome = 'pending' AND expires_at > now()` plus the four match columns) that returns the row;
zero rows updated is classified by a second read. pgTAP: owner reads, no owner writes, the
service role's consume twice (the second finds `used`), expiry, cascade.

### 5. The API

- Body: `confirm?: uuid`, `decline?: uuid`, never both (400 `bad_request`). With either, the
  message text is still required (what the user said, for the row and the history).
- Before the stream: `confirm` must name a pending, unexpired row of this session and user, or
  400 `confirmation_invalid`; `decline` marks the row `declined` (same checks). Then the loop
  runs with `extras.confirmation = { id }` for a confirm, and nothing for a decline.
- SSE: `confirm` event `{ type: 'confirm', confirmation_id, tool, summary, expires_at, tool_use_id }`
  after the `tool_result` of the same `tool_use_id`. Listed in `docs/API.md` with the client's
  obligation: show it, send the next turn with `confirm` or `decline`.

### 6. The demo pack

`create_note` becomes the first confirmed write: `confirmation: 'required'`, `preview` reads the
item's name as the user and returns `Zabilježit ću uz artikl "<name>": "<text>"`
<!-- needs native review -->. Its description tells the model the user is asked before the note
is written. D scenarios: the first call previews and emits `confirm`; a confirmed request writes
the row and the audit row says `executed`; a changed text after confirming previews again.

### 7. Tests (core, `confirm.test.ts`)

- E40 preview: the `tool_result` row holds the summary and no id; `confirm` is emitted after the
  row (request order in the fake); the model's next call, scripted to call the tool again
  without a confirmation on the request, gets a second preview, not an execution.
- E41 confirm: with `extras.confirmation`, the handler runs once, the output is the handler's,
  the store saw `consume` then `settle('executed')`.
- E42 mismatch: a confirmed request whose model call changed the input previews again and logs
  `confirmation not consumed` with `mismatch`; a used id likewise with `used`.
- E43 failure: a handler throw after consume settles `failed` with the code and returns the
  usual `is_error` result.
- E44 abort between the preview's row and the confirmation writes nothing and leaves the id
  pending.
- E45 the registry: a confirmation tool may be named for `voice`; a plain write tool may not;
  `defineTool` refuses `confirmation` without `preview` or with `readOnly: true`.
- The id never appears in any Anthropic request body or any log line, asserted in E40 and E41.

## Acceptance checklist (12a)

- [ ] `defineTool`, the registry assertion, dispatch and the tool round implement §1–§3; E40–E45 green.
- [ ] Migration written with `/new-migration`, pgTAP green locally, not applied; `REL-11` added.
- [ ] `POST /chat` takes `confirm` / `decline`; `confirmation_invalid` in the catalogue, `docs/API.md` and the C scenarios.
- [ ] The `confirm` SSE event documented; the web client ignores it without error until 12b (checked in the web tests).
- [ ] `create_note` under the protocol with its D scenarios; `tool-security-reviewer` run on it.
- [ ] `docs/CORE.md` (the protocol, the catalogue), `docs/DB.md`, `docs/SECURITY.md`; decision 0015; `/done` green.

## 12b (sketch)

- Web: a `ConfirmCard` under the tool chip, two buttons, the next `streamMessage` with
  `confirm` or `decline` and a fixed text ("Da." / "Ne."); the card disables after the answer or
  the expiry; `normalizeMessages` keeps the card on reload from the `tool_confirmations` row
  (owner SELECT).
- Voice: `CallSession` keeps the pending id from the sink's `confirm` hook; a turn whose text,
  normalised, is in a closed set of affirmatives ("da", "može", "potvrđujem", "pošalji",
  "u redu") carries `extras.confirmation`; a closed set of negatives declines; anything else is a
  plain turn. The in-memory store lives for the call. The voice prompt gains one line about
  confirmations, measured with `/bench-voice`. No write tool is allowlisted for voice in 12b;
  Part 13 names the first with the reason in its commit.
