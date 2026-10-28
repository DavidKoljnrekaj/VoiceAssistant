# Core (`@va/core`)

The engine behind every channel: one loop, one tool registry, one role gate, one prompt lineage.
A channel supplies a sink, a store, loop hooks and a settings row; nothing else differs. The
plan is `docs/plan/03-core-engine.md`; the invariants it enforces are in `CLAUDE.md` and
`.claude/rules/engine.md`. Parts 3a and 3b are built: the types, the tool registry, the prompts,
the model profiles, the error catalogue, the fakes, the loop, dispatch, history assembly and the
buffered sink. The spoken-text sink (3c) is marked as such below.

## Layout

```
packages/core/src/
├── index.ts              public surface
├── channel.ts            Channel, ChannelSettings, CHANNEL_DEFAULTS, channelSettings(channel, env)
├── auth.ts               Role, AuthContext, authenticateToken(jwt)
├── errors.ts             ErrorCode, MESSAGES_HR, mapAnthropicError
├── model.ts              modelProfile(settings) → { extra, betas }
├── log.ts                one JSON line per event, never content
├── prompts/              DOMAIN_RULES_HR, chat and voice blocks, buildStaticSystemPrompt, buildUserContext
├── tools/                defineTool, ToolRegistry, CHANNEL_ALLOWLIST, toAnthropicTool
├── loop/                 ports, orchestrator, model-call, tool-round, dispatch, history
├── sinks/                BufferedSink; (3c) SpokenTextSink, speakable
└── test/                 fake-anthropic, fake-supabase, fixtures, tools, harness → exported as @va/core/test
packages/tools-demo/src/  the example pack: search_items, get_item, create_note
```

Dependencies: `@anthropic-ai/sdk` 0.133.0 (pinned exactly), `zod` 4, `@va/db`. Nothing from an
app, no HTTP, no LiveKit, no React. The engine reads no environment variable; apps pass what
varies (`channelSettings(channel, env)`, injected clients).

## The loop

`runOrchestrationLoop(ctx, config, input, sink, store, hooks, signal)` takes three ports,
unchanged from Landmark except where the plan says:

- `EventSink`: `textDelta`, `toolStarting`, `textBlock(text, messageId)`, `toolCall`,
  `toolResult`, `done(stopReason, usage)`, `error(code, message)`. Chat's SSE sink emits deltas,
  blocks and tool events; the voice sink speaks text only; `BufferedSink` keeps everything.
- `MessageStore`: `insert(row)` → `{ id | null, code? }`, never throws. A row carries `role`,
  `turn_kind` (`user` | `assistant` | `tool_result`), `content`, `parent_id`, and for assistant
  rows the model, the four token counts and the stop reason. Chat inserts per row inside the
  loop; voice defers persistence until after the answer.
- `LoopHooks`: `isCancelled`, `onComplete`, optional `mark` (`model_call`, `first_event`,
  `tools_start`, `tools_done`) and `usage` (input, output, cache read, cache write per call).

`LoopConfig` is the channel, its `ChannelSettings`, the injected Anthropic client, the system
blocks (the static one first, with the breakpoint), `registry.anthropicTools(ctx, channel)`, the
registry and the owner's log tag. `LoopInput` is the session id, the assembled history plus the
user turn just persisted, the id of that row and the `ToolHandlerExtras`.

### How a turn flows

```
owner      persist user row ─┐
loop   ┌──▶ hooks.isCancelled? ── yes ──▶ return (silent)
       │    applyMessageCacheBreakpoint(messages)
       │    messages.stream(params, { signal })      deltas → sink.textDelta, tool starts → sink.toolStarting
       │      abort while streaming ──▶ log, return (silent)      SDK error ──▶ sink.error(mapped), return
       │    store.insert(assistant row)              failure ──▶ sink.error(persistence_error), return
       │    blocks in order: text → sink.textBlock(text, rowId); tool_use → sink.toolCall
       │    refusal ──▶ sink.done('refusal'), onComplete, return
       │    tool_use:
       │      cancelled before dispatch ──▶ synthetic results for every tool
       │      else dispatch all concurrently (timeout + child signal each), settle early on abort
       │      store.insert(tool_result row, tool_use order)   failure ──▶ retry once, then sink.error(persistence_error)
       │      aborted ──▶ return (silent, row persisted)      else sink.toolResult × n
       └────  continue
            terminal with tool_use blocks (truncation) ──▶ synthetic results persisted, explanation row, textBlock, done
            terminal ──▶ sink.done(stopReason, usage), onComplete
       iteration cap ──▶ tool_limit_reached row, textBlock, done, onComplete
```

### Persistence order and abort contract

Per iteration: stream the model turn → persist the assistant row → emit its blocks in content
order → dispatch the turn's tools concurrently, each with its own timeout and child abort signal
→ persist the single `tool_result` row (blocks in `tool_use` order) → emit the results → loop.
Token deltas are the one provisional exception; the `turn` event that follows is canonical. The
`tool_result` insert is retried once: that row is what keeps the branch from ending on a bare
`tool_use`.

Abort is checked before each model call, between the model call and dispatch, and after
dispatch. On abort the loop persists synthetic `is_error` results for tools that did not finish
(`cancelled before the tool ran` / `cancelled before the tool returned`; finished tools keep
their real output), emits no result event and returns silently; the request owner decides
whether to emit `error`. A `refusal` stop runs no tools: the sinks decide what to say. Thinking,
fallback and unknown block types are persisted verbatim and never emitted. A terminal stop with
`tool_use` blocks (truncation) persists synthetic results and one Croatian explanation row
(`TRUNCATED_HR`). The manual loop over `messages.stream` is a decision (`docs/decisions/0009`),
not an omission.

### Dispatch

`dispatchToolWithTimeout(registry, name, input, ctx, extras, timeoutMs, channel, signal, logTag)`
resolves the name through `registry.find` (an unknown or forbidden name throws with its
`RefusalReason`, logged as `tool refused at dispatch`, and becomes
`{ error: 'tool execution failed: tool refused: <reason>' }`), re-validates the input with the
tool's zod schema (`{ error: 'invalid tool input', issues }` without calling the handler), and
runs the handler with a child signal (`AbortSignal.any` of the loop signal and the timeout). The
timer is cleared on every exit; a timeout is `{ error: 'tool execution failed: tool_timeout' }`
and the handler is told to stop through its signal. A handler's `{ error }` return is an error
result too; a throw becomes `{ error: 'tool execution failed: <message>' }`.

### History assembly

`assembleHistory(rows, { hardCeilingTokens, summary? })` takes the rows `ai_session_history`
returns (root → leaf) and builds the message array: rows with no content blocks (a refusal) are
dropped; an assistant row whose `tool_use` ids are not all answered by the next row gets
synthetic `is_error` results (`interrupted before the tool returned`), appended to the existing
`tool_result` message or inserted as a new one, in memory only; turns split at `turn_kind:
'user'`; a session summary whose boundary is on the branch replaces the turns up to it and is
folded into the first kept message as a banner; above the ceiling (chars / 4) whole oldest turns
are dropped, at least one kept. `applyMessageCacheBreakpoint` moves the message breakpoint to the
last block of the last message before every call. The compaction writer is not built (`CORE-3`).

## Channels

| Setting                   | chat                                | voice                               |
| ------------------------- | ----------------------------------- | ----------------------------------- |
| model / effort / thinking | Opus 5.5 / medium / adaptive (omit) | Sonnet 5.5 / low / `between_tools`  |
| `max_tokens` / iterations | 8192 / 10                           | 1024 / 4                            |
| tool / request timeout    | 15 s / 90 s                         | 6 s / 25 s                          |
| history rows              | 200 (`ai_session_history`)          | 20 (the call's own context)         |
| compaction                | off (later)                         | off                                 |
| env overrides             | `AI_CHAT_MODEL`, `AI_CHAT_EFFORT`   | `AI_VOICE_MODEL`, `AI_VOICE_EFFORT` |

`CHANNEL_DEFAULTS` is the table as data; `channelSettings(channel, env)` applies the overrides
(an empty variable keeps the default, an invalid one throws naming the variable). Rate limits
live in the API (Part 4), not here.

## Model profiles

`modelProfile(settings)` is the only place a model id is interpreted. It returns the request
fields beyond the common ones (`extra`, spread into the request) and the beta headers (`betas`;
non-empty means the call goes through `beta.messages.stream`).

| model               | thinking                                                                             | extra                                          | betas                             |
| ------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- | --------------------------------- |
| `claude-opus-5-5`   | omitted (adaptive)                                                                   | `output_config.effort`, `fallbacks: 'default'` | `server-side-fallback-2026-07-01` |
| `claude-sonnet-5-5` | `{ type: 'between_tools' }` when the settings say so and effort ≤ high, else omitted | same                                           | same                              |
| `claude-haiku-5-5`  | omitted                                                                              | `output_config.effort`                         | none (no fallback support)        |
| anything else       | omitted                                                                              | `output_config.effort`                         | none                              |

Never sent: `thinking: { type: 'disabled' }`, `budget_tokens`, `temperature`, a forced
`tool_choice`, an assistant prefill. Pinned by the M scenarios in `model.test.ts`.

## Identity

`authenticateToken(jwt)` verifies the token with GoTrue through a user client
(`createUserClient(jwt)`), reads `public.users` by `auth_user_id` with the service role, and
returns an `AuthContext`: `userId`, `authUserId`, `role` (`admin` | `member`), `email`,
`language` (`hr` | `en`), `userClient` (RLS applies: tools read through it) and `serviceClient`
(persistence only, always with an explicit `user_id` / `session_id` filter). Failures are
`unauthorized` (401), `no_profile` (403) and `internal_error` (500) with the Croatian message
from the catalogue. It parses no `Request`: the API extracts the bearer token, the voice worker
takes it from `voice_calls`. Identity is re-read on every request; the worker may cache it for
60 s per call. Log lines carry `[core:auth]`, ids and codes, never the token.

## Errors

`ErrorCode` is the closed set every channel uses; `MESSAGES_HR` has the user-facing Croatian
message per code (<!-- needs native review -->, `CORE-1`). `mapAnthropicError(err)` turns the
SDK's typed errors into a code, a message and a `shouldLog` flag: 429 → `model_rate_limited`,
connection timeout → `model_timeout` (checked before the connection error, its superclass),
connection failure → `model_unreachable`, 400 → `model_bad_request`, 401 → `model_auth_failed`,
529 (overloaded) → `model_rate_limited`, anything else → `model_error`. Operational states are
not logged loudly; our-fault errors and the fall-through are.

## Prompts

`buildStaticSystemPrompt(channel)` = intro + `DOMAIN_RULES_HR` + presentation, per channel.
It is byte-identical per channel, pure (no clock, locale or env) and carries the cache
breakpoint. `buildUserContext(ctx)` is the per-user block (`## Korisnik` with email and role,
plus a scope sentence for members), sent as a second, uncached system block. The caller appends
the date line (`Danas je …`, Europe/Zagreb) as a third uncached block.

`DOMAIN_RULES_HR` is one short placeholder rule in the skeleton (rely on tool output; retry a
search with a shorter stem, then ask). Integration packs will contribute rules through the
`domainRules` field on `ToolPack`, concatenated in pack order; the field exists, the
concatenation arrives with the first real pack. The chat blocks are Landmark's minus its
document, attachment and route sections; the voice blocks are Landmark's verbatim with the
product and role names replaced. Every Croatian string is marked for native review.

### Cache strategy

Render order is `tools` → `system` → `messages`. Three breakpoints: the last tool definition
(`anthropicTools` sets it), the static system block, and the last block of the last message,
slid forward every iteration. Changing a prompt or the tool set changes the cache key; say
so in the commit and re-run the voice bench.

## Tools

### Contract

```ts
defineTool({
  name: 'search_items',                 // snake_case, unique across packs
  description: '…',                     // model-facing English: what, when, when not, constraints
  input: z.object({ … }),               // zod 4; every property has .describe()
  requiredRoles: ['admin', 'member'],
  readOnly: true,                       // truthful; asserted for every voice tool
  async handler(input, ctx, extras, signal) { … }, // reads through ctx.userClient, honours signal
})
```

`extras` is `{ requestId, channel, clientContext? }`. A handler on a channel allowlist shapes its
output for that channel through `extras.channel`: on voice no ids or timestamps, at most five
items, short text (the demo pack's two reads are the pattern).

A pack is `{ name, tools, domainRules? }`. `ToolRegistry(packs, allowlist = CHANNEL_ALLOWLIST)`
throws on a duplicate name and on an allowlist that names an unknown or a write tool.
`select(ctx, channel)` is role ∩ channel, sorted by name; `find(ctx, name, channel)` resolves a
name through the same filter (undefined for unknown and forbidden alike; `refusalReason` says
which: `unknown_tool`, `not_permitted_for_role`, `not_permitted_on_channel`); `anthropicTools(ctx,
channel)` is the request's `tools` array, sorted, `strict: true` on every tool, the last one
carrying `cache_control`, memoised per role and channel.

`toAnthropicTool(def)` derives the JSON Schema from zod (`io: 'input'`, so optional and
defaulted fields are optional for the model and zod fills the defaults at dispatch), reduces it
with the SDK's strict transform (keywords strict mode does not take, such as `minLength`,
`pattern`, `minimum` and `default`, are folded into the property description; `format: uuid`
stays) and sets `additionalProperties: false` and `required` on every object node. If the API ever rejects a
schema under `strict`, drop `strict` for that tool and keep the zod check at dispatch, never
the other way round. `eager_input_streaming` stays off.

Dispatch re-validates the input with the tool's zod schema; a failure becomes an `is_error`
result with the issues and the handler is not called. A handler that returns `{ error }` is an
`is_error` result too; one that throws becomes `{ error: 'tool execution failed: …' }`.

### Channel allowlist

`CHANNEL_ALLOWLIST = { chat: 'all', voice: ['search_items', 'get_item'] }`. Chat gets every
registered tool its role allows; voice only what is named, in a reviewed diff that says why
the output is safe to read aloud (no ids spoken, ≤ 5 items, plain numbers). Every voice tool is
`readOnly: true`, asserted when the registry is built and by test `T02`.

### Catalogue

| Tool           | Pack | Roles         | readOnly | Channels    | What                                                                                                                |
| -------------- | ---- | ------------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `search_items` | demo | admin, member | yes      | chat, voice | substring search of `demo_items` by name, ≤ 100 (default 20), sorted, with the true total; voice: ≤ 5 items, no ids |
| `get_item`     | demo | admin, member | yes      | chat, voice | one item by id; `{ error: 'item not found' }` when missing; voice: no id, clipped text                              |
| `create_note`  | demo | admin, member | no       | chat        | attaches a user-written note to an item (`demo_notes`)                                                              |

`demo_items` and `demo_notes` exist only in the fakes (`CORE-2`): the demo pack narrows the user
client to a hand-written type in `demo-db.ts`. A real pack reads tables that are in the
generated `Database` and needs no cast.

### How to add a tool

`/new-tool <pack> <name> <one line>` walks it: the `defineTool` block in
`packages/<pack>/src/tools/<name>.ts`, registration in the pack's `tools` array, the voice
allowlist decision (with the reason in the commit), a scenario test through the loop (`runChat`,
as `D10` in the demo pack) and
the `tool-security-reviewer` agent. Escape `\\`, `%` and `_` before any `ilike` and reject `*` in the schema (PostgREST reads `*` as `%` and cannot be made to take it literally; `escapeLike` and `NO_STAR` in the demo pack are the pattern), never interpolate raw input into `.or()`, cap lists in the query itself (not only in the schema), and update the catalogue above.

### How to add a channel

Add it to `Channel`, a row to `CHANNEL_DEFAULTS` (and env override names), an entry to
`CHANNEL_ALLOWLIST` (default-deny: start with `[]`), intro and presentation blocks in
`prompts/`, a sink and a store in the owning app, and a settings test. The loop, the registry
and the gate need no change.

## Testing

`@va/core/test` exports the fakes, the fixtures and the harness. Importing the harness sets the
Supabase env for `@va/db`, routes `globalThis.fetch` for `fake-anthropic.test` and
`fake-supabase.test`, and captures console output into `logs` (set `VA_TEST_LOGS=1` to see it).

- `FakeAnthropic`: `script(...turns)` with `answer`, `callTools`, `toolUse`, `text`, `refusal`,
  `{ error }`, `{ connectionError }`, `{ hangUntilAborted }` or a function of the captured
  request; serves `messages.create`, `messages.stream` and the beta endpoint identically;
  rejects conversations the real API rejects; counts unscripted calls.
- `FakeSupabase`: GoTrue `/auth/v1/user` by token, a PostgREST subset (selects, embeds, filters,
  order, limit, count, single, insert/update/delete, `rpc/`), `fault`, `hold`, `onRequest`,
  recorded requests with the client that made them (`clientOf`).
- `fixtures`: `seedWorld(db)` with an admin and a member (`TOKENS`, `USERS`), the member's chat
  session (three-row chain), five `demo_items`, and the `ai_session_history` RPC.
- `tools`: `TEST_PACK` (`echo`, `whoami`, `gate`, `fail`, `boom`, `admin_only`, `write_note`)
  and `TEST_ALLOWLIST`; `openGate(key, value)` releases a running `gate` handler,
  `awaitHandlerEvent('start:key' | 'end:key' | 'aborted:key')` waits for one, `handlerEvents`
  lists them.
- `harness`: `scenario(name, fn)` (fresh world, fails on an unscripted or unused model turn),
  `reset()`, `anthropicClient()`, `authAs('member')`, `sessionMessages`, `blocksOf`,
  `toolResultSentToModel`, and `runChat(ctx, text, opts)`: one turn through the real loop with a
  `BufferedSink`, rows inserted through the fake service client (`serviceStore`), default hooks
  and an `AbortController`; `opts` picks the channel, packs and allowlist, settings, hooks, the
  controller, an existing session and parent row (history is read and assembled), extras, a
  sink the test owns. `anthropic.onRequest(hook)` and `db.onRequest(hook)` run when a request
  arrives, for aborts at exact moments.

Run one file with logs:

```
VA_TEST_LOGS=1 pnpm exec vitest run packages/core/src/auth.test.ts
```

Suites: `C` settings, `M` model profiles, `X` errors (through the real SDK), `A` identity, `P`
prompts, `T` registry and schema, `F` fake Anthropic, `G` fake Supabase (GoTrue and PostgREST),
`D` the demo pack (handlers, and `D10`/`D11` through the loop), `E` the loop
(`loop/orchestrator.test.ts`, `loop/abort.test.ts`), `H` history assembly. The `S`(poken)
scenarios come with 3c.
