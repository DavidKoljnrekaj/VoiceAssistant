# Backlog — core

Ids: CORE-5 (next free)

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

## Resolved

### CORE-2 · Low · `demo_items` and `demo_notes` exist only in the fakes

Resolved by `supabase/migrations/20261029100000_demo_tables.sql` (with `demo_tables.test.sql` and
the local seed). The hand-written cast in `packages/tools-demo/src/demo-db.ts` stays until the
migration is applied to a project and `/db-types` regenerates `packages/db/src/database.ts`
(`REL-3`).
