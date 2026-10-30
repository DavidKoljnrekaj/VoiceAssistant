# Backlog — core

Ids: CORE-13 (next free)

The engine (`packages/core`): loop, tools, prompts, history, sinks, fakes.

## Open

### CORE-1 · Medium · Croatian text in the engine has not had a native review

- **Check:** Confirmed (every file is marked)
- **Where:** `packages/core/src/errors.ts` (`MESSAGES_HR`), `packages/core/src/prompts/*.hr.ts`,
  `buildUserContext` in `packages/core/src/prompts/index.ts`, `TRUNCATED_HR` in
  `packages/core/src/loop/orchestrator.ts`, the summary banner in `loop/history.ts`, `FILLERS_HR`
  in `packages/core/src/sinks/spoken.ts` (the refusal line is `MESSAGES_HR.model_refused`); in the
  API the route context line (`apps/api/src/chat/route-context.ts`) and the voice session title
  (`apps/api/src/voice/calls.ts`); the worker's greeting, bench questions and hints are `VOICE-2`
- **What happens:** users read and hear placeholder Croatian written by the port, not by a native
  speaker; the voice prompt is Landmark's with the product name and role names swapped
- **Fix direction:** a native speaker reads every `<!-- needs native review -->` block, the marks
  are removed in one commit, and the voice bench is re-run because a prompt change moves the cache
  key

### CORE-3 · Low · The compaction writer is not implemented

- **Check:** Confirmed (by design, docs/plan/03-core-engine.md §8)
- **Where:** `packages/core/src/loop/history.ts` applies a summary (`selectKeptChain`,
  `injectSummaryBanner`) and the hard ceiling; nothing writes `ai_sessions.context_summary` or
  `summary_through_message_id`
- **What happens:** a long chat thread replays its whole branch up to the 130K-token ceiling,
  then loses whole oldest turns instead of a summary
- **Fix direction:** port Landmark's `maybeCompactSession` (`planCompaction`,
  `renderTurnsForSummary`, the summary model call) as a post-turn step owned by the API's stream
  worker, off the user's critical path; the chat channel setting `compaction` turns it on

### CORE-4 · Low · OQ: `speakable` runs per released chunk, so markup that straddles two chunks escapes it

- **Check:** Code reading
- **Where:** `packages/core/src/sinks/spoken.ts` (`say` applies `speakable` to each chunk;
  `flushWords` cuts at the last whitespace)
- **What happens:** the acronym rules are safe because a chunk never ends inside a word, but a
  markdown link whose text contains a space (`[dvije riječi](url)`) or a run of blank lines split
  across deltas is released in two chunks and the link or newline rule sees neither half whole.
  The voice prompt forbids links and markdown, so `speakable` is the backstop, not the rule
- **Fix direction:** hold the pending text while it contains an unclosed `[` or `(`, or apply
  `speakable` at sentence boundaries instead of word boundaries; measure the latency effect with
  `/bench-voice` before changing the release point

### CORE-8 · Low · Abort after the model call: the terminal paths ignore the signal and the dispatch timer keeps running (R-C4, R-C5)

- **Check:** Confirmed (R-C4, R-C5)
- **Where:** `orchestrator.ts` truncation and terminal paths (`toolResult`, `textBlock`, `done`
  and `hooks.onComplete()` still run after an abort during the assistant-row insert);
  `dispatch.ts` `dispatchToolWithTimeout` (the timer runs up to `toolTimeoutMs` for a handler
  that ignores its signal after the loop has returned)
- **What happens:** a small window in which a cancelled turn still emits `done` and completes,
  against `ports.ts` and `.claude/rules/engine.md`; a dangling timer per aborted tool. `E23`
  does not assert `getTimerCount() === 0` the way `E25` does
- **Fix direction:** check the signal after the insert and on the terminal paths; clear the
  timer on abort; extend `E23`

### CORE-9 · Low · A `model_bad_request` is logged without its reason (R-C6)

- **Check:** Confirmed (R-C6)
- **Where:** `orchestrator.ts` logs `errorClass` and `code` only; `errorReason()` in `log.ts` is
  unused there
- **What happens:** the rejected field of an our-fault request (such as `CORE-7`) cannot be read
  from the logs. Landmark logged the message cut to 200 characters
- **Fix direction:** add `reason: errorReason(err)` to the `model call failed` line (it truncates
  and carries no content)

### CORE-10 · Low · The registry hardcodes the demo pack's voice allowlist (R-C7)

- **Check:** Confirmed (R-C7)
- **Where:** `packages/core/src/tools/registry.ts` `CHANNEL_ALLOWLIST` names `search_items` and
  `get_item`, which `@va/tools-demo` owns; `new ToolRegistry([], CHANNEL_ALLOWLIST)` throws
  (`T02` asserts it)
- **What happens:** core depends on a pack by name against the `tools-* → core` direction, and an
  app composed without the demo pack dies at load
- **Fix direction:** the app that composes the packs (`apps/api`, `apps/voice`) supplies the
  allowlist, the registry keeps the read-only assertion; `T02` moves with it

### CORE-11 · Low · A summary boundary inside a turn yields a history the API rejects (R-C8)

- **Check:** Confirmed (R-C8, verified 2026-10-30)
- **Where:** `history.ts` `selectKeptChain` slices after `summary_through_message_id` with no
  turn-boundary check; `injectSummaryBanner` unshifts a text block into whatever message comes
  first
- **What happens:** a boundary on an assistant row makes the first kept message an `assistant`
  or `tool_result` message ("first message must use the user role"), or the banner lands inside
  a `tool_result` message. Unreachable until the compaction writer exists (`CORE-3`), but the
  reader is production code and `H04` tests only a boundary on a turn's last row
- **Fix direction:** after slicing, advance to the next `turn_kind === 'user'` row; one `H` test
  for a mid-turn boundary; do it with `CORE-3`

### CORE-12 · Low · Test gaps in core and the demo pack (R-C9)

- **Check:** Confirmed (R-C9)
- **Where:** `get_item` has no scenario through the loop and `create_note` only its voice refusal
  (`.claude/rules/tools.md` asks for one per tool); `SpokenTextSink.textBlock` dedupe with two
  text blocks where the second repeats a prefix; `X05` pins the error-code count (22); `H02b`,
  `H03`, `H06` call internals instead of `assembleHistory`; nothing pins what a throwing
  `MessageStore.insert` does (it propagates out of the loop)
- **What happens:** a regression in any of these passes CI
- **Fix direction:** one scenario per tool; a dedupe case; `X05` asserts the catalogue's shape,
  not its length; the `H` tests through the public function; a scenario with a throwing store
  that pins the outcome

## Resolved

### CORE-7 · Medium · `tools` is omitted when none is advertised while the history still holds tool blocks, and the API answers 400 (R-C3)

Resolved in `fix(core)` for CORE-7: the fake enforces the API rule (`F10`) and the loop applies
`withoutToolBlocks` to the history when no tool is advertised (`E34`).

### CORE-6 · Medium · The loop mutates arrays it has already handed to the store (R-C2)

Resolved in `fix(core)` for CORE-6: the loop pushes copies of the assistant content and the
tool_result blocks, so a deferred store never sees the cache marker (`E33`); `ports.ts` says so.

### CORE-5 · High · A handler that resolves `undefined` crashes the loop after a malformed row is written; a `BigInt` output leaves a bare `tool_use` (R-C1)

Resolved in `fix(core)` for CORE-5: dispatch persists `undefined` as `null` and an output JSON
cannot serialise as an `is_error` envelope; the sink gets the outcome, not a re-parse of the row
(`E31`, `E32`).

### CORE-2 · Low · `demo_items` and `demo_notes` exist only in the fakes

Resolved by `supabase/migrations/20261029100000_demo_tables.sql` (with `demo_tables.test.sql` and
the local seed). The hand-written cast in `packages/tools-demo/src/demo-db.ts` stays until the
migration is applied to a project and `/db-types` regenerates `packages/db/src/database.ts`
(`REL-3`).
