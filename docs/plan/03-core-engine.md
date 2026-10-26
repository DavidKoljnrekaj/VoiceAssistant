# Part 3 — `packages/core`: the conversation engine

## Prompt for the session

```
Read docs/plan/00-brief.md and docs/plan/03-core-engine.md, then implement Part 3<a|b|c> on a branch
feat/core-<types|loop|spoken> from main. Restate the deliverables and the acceptance checklist for that
sub-part first and ask me only about what the plan leaves open. The engine has no HTTP and no framework
code: every test runs in-process against the fakes. Load the claude-api skill before writing any SDK
call and verify the request shapes against it (model ids, thinking, effort, fallbacks, strict tools,
cache_control). When done, run /done, update docs/CORE.md, and report.
```

Sub-parts, each one session: **3a** types, tool registry, prompts, model profiles, errors, fakes;
**3b** orchestration loop, dispatch, history assembly, scenario suite; **3c** spoken-text sink.

## Goal

One loop, one tool registry, one role gate, one prompt lineage, usable from any channel through three
ports (`EventSink`, `MessageStore`, `LoopHooks`) and one settings row. Landmark's
`_shared/orchestrator.ts` is the base; the changes are the ones the brief decided (abort as a
first-class exit, persist-then-emit for tool results, deltas, zod tools, model profiles).

## Deliverables

```
packages/core/src/
├── index.ts                 public surface (listed at the end)
├── channel.ts               Channel, ChannelSettings, CHANNEL_DEFAULTS
├── auth.ts                  Role, AuthContext, authenticateToken(jwt)
├── errors.ts                ErrorCode union + Croatian messages + mapAnthropicError
├── model.ts                 modelProfile(model, channel, effort) → { extra, betas }
├── prompts/
│   ├── domain-rules.hr.ts   DOMAIN_RULES_HR (placeholder content, see §6)
│   ├── chat.hr.ts           CHAT_INTRO_HR, CHAT_PRESENTATION_HR
│   ├── voice.hr.ts          VOICE_INTRO_HR, VOICE_PRESENTATION_HR
│   └── index.ts             buildStaticSystemPrompt(channel), buildUserContext(ctx)
├── tools/
│   ├── define.ts            defineTool, ToolDefinition, ToolHandlerExtras
│   ├── registry.ts          ToolRegistry, CHANNEL_ALLOWLIST, assertAllowlist
│   └── schema.ts            toAnthropicTool(def) → { name, description, input_schema, strict }
├── loop/
│   ├── orchestrator.ts      runOrchestrationLoop + ports
│   ├── dispatch.ts          dispatchTool, dispatchToolWithTimeout
│   └── history.ts           assembleHistory, repairUnansweredToolUse, splitTurns, enforceHardCeiling, applyMessageCacheBreakpoint
├── sinks/
│   ├── buffered.ts          BufferedSink (tests, non-streamed responses)
│   ├── spoken.ts            SpokenTextSink (3c)
│   └── speakable.ts         speakable(text) (3c)
└── test/
    ├── fake-anthropic.ts    port of Landmark's
    ├── fake-supabase.ts     port of Landmark's (PostgREST subset, GoTrue /user, RPC)
    ├── fixtures.ts          seedWorld(db): users, sessions, a demo entity table for @va/tools-demo
    └── harness.ts           routes globalThis.fetch to the fakes; scenario(); readers
packages/tools-demo/src/     the example pack: search_items, get_item (read-only), create_note (write, chat only)
docs/CORE.md
```

## Specification

### 1. Channel settings (`channel.ts`)

```ts
export type Channel = 'chat' | 'voice'
export interface ChannelSettings {
  model: string; effort: 'low' | 'medium' | 'high'; thinking: 'adaptive' | 'between_tools'
  maxTokens: number; maxIterations: number; toolTimeoutMs: number; requestTimeoutMs: number
  historyMaxRows: number; compaction: boolean
}
export const CHANNEL_DEFAULTS: Record<Channel, ChannelSettings>   // the brief's table
export function channelSettings(channel: Channel, env: NodeJS.ProcessEnv): ChannelSettings
// env overrides: AI_CHAT_MODEL, AI_CHAT_EFFORT, AI_VOICE_MODEL, AI_VOICE_EFFORT
```

### 2. Identity (`auth.ts`)

Port Landmark's `authenticateToken(jwt)` on top of `@va/db`: `createUserClient(jwt)` →
`auth.getUser()` → service-role lookup of `public.users` by `auth_user_id` → `AuthContext`:

```ts
export type Role = 'admin' | 'member'
export interface AuthContext {
  userId: string; authUserId: string; role: Role; email: string | null; language: 'hr' | 'en'
  userClient: SupabaseClient<Database>; serviceClient: SupabaseClient<Database>
}
export type AuthResult = AuthContext | { error: { code: ErrorCode; message: string }; status: 401 | 403 | 500 }
```

No `Request` parsing here (that is the API's job). Errors: `unauthorized` (401), `no_profile` (403),
`internal_error` (500). Log with `[core:auth]`, never the token.

### 3. Tools (`tools/`)

```ts
export interface ToolHandlerExtras { requestId: string; clientContext?: { route?: string } }
export interface ToolDefinition<I> {
  name: string                      // snake_case, unique across packs
  description: string               // model-facing English: what, when, non-obvious constraints
  input: z.ZodType<I>               // zod 4 object schema; every property has .describe()
  requiredRoles: readonly Role[]
  readOnly: boolean
  handler: (input: I, ctx: AuthContext, extras: ToolHandlerExtras, signal: AbortSignal) => Promise<unknown>
}
export function defineTool<I>(def: ToolDefinition<I>): ToolDefinition<I>
export interface ToolPack { name: string; tools: ToolDefinition<unknown>[] }

export const CHANNEL_ALLOWLIST: Record<Channel, 'all' | readonly string[]> = { chat: 'all', voice: [] }
export class ToolRegistry {
  constructor(packs: ToolPack[], allowlist = CHANNEL_ALLOWLIST)   // throws on duplicate names; asserts every voice name exists and is readOnly
  select(ctx: Pick<AuthContext, 'role'>, channel: Channel): ToolDefinition<unknown>[]   // role ∩ channel
  find(ctx, name, channel): ToolDefinition<unknown> | undefined
  anthropicTools(ctx, channel): Anthropic.Tool[]                   // deterministic order (sorted by name), last one carries cache_control
}
```

`schema.ts`: `z.toJSONSchema(def.input)` → ensure `type: 'object'`, `additionalProperties: false`,
`required` lists every non-optional key; set `strict: true`. A test asserts both for every registered
tool. If the API ever rejects a schema under `strict`, drop `strict` for that tool and rely on the zod
check at dispatch (never the other way round). `eager_input_streaming` stays off: tool inputs are never
shown mid-stream, and off means the server validates them.

`packages/tools-demo` is the contract example: `search_items` and `get_item` read a small
`demo_items` table (seeded by the fakes, and by a migration only if the user wants it on the dev
project; default is fakes only), `create_note` is a write tool (`readOnly: false`) that exists to prove
the voice allowlist refuses it. `CHANNEL_ALLOWLIST.voice = ['search_items', 'get_item']`.

### 4. Model profiles (`model.ts`)

```ts
export function modelProfile(settings: ChannelSettings): { extra: Record<string, unknown>; betas: string[] }
```

| model | thinking | extra | betas |
|---|---|---|---|
| `claude-opus-5-5` | adaptive (omit) | `output_config: { effort }`, `fallbacks: 'default'` | `server-side-fallback-2026-07-01` |
| `claude-sonnet-5-5` | `between_tools` when `settings.thinking === 'between_tools'` and effort ≤ high, else omit | `output_config: { effort }`, `fallbacks: 'default'` | same |
| `claude-haiku-5-5` | adaptive (omit) | `output_config: { effort }` | none (no fallback support) |
| anything else | omit | `output_config: { effort }` | none |

Never send `thinking: { type: 'disabled' }`, `budget_tokens`, `temperature`, forced `tool_choice`, or an
assistant prefill. A unit test pins the table (M-scenarios below).

### 5. Errors (`errors.ts`)

`ErrorCode` union: `unauthorized | no_profile | bad_request | message_too_long | session_not_found |
payload_too_large | rate_limited | internal_error | model_rate_limited | model_timeout | model_unreachable |
model_bad_request | model_auth_failed | model_error | model_refused | persistence_error | request_timeout |
tool_limit_reached | cancelled`. `MESSAGES_HR: Record<ErrorCode, string>` (port Landmark's Croatian
strings; mark for native review). `mapAnthropicError(err)` ported, with `APIConnectionTimeoutError`
checked before `APIConnectionError`.

### 6. Prompts (`prompts/`)

`buildStaticSystemPrompt(channel)` = `INTRO[channel] + '\n\n' + DOMAIN_RULES_HR + '\n\n' + PRESENTATION[channel]`.
`buildUserContext(ctx)` = `## Korisnik\nKorisnik: ${email}, uloga: ${role}.` plus one sentence for
`member` about role-limited data. Pure; the date line is appended by the caller as a separate uncached
system block (`Danas je …`, Europe/Zagreb).

- `DOMAIN_RULES_HR` in the skeleton is a short placeholder block ("## Podatkovne stupice" with one rule:
  rely on tool output, never on assumptions; if a search returns nothing, retry with a shorter stem, then
  ask) plus a comment explaining that integration packs will contribute rules here later through a
  `domainRules` field on `ToolPack` (concatenated in pack order). Keep that field in the type now.
- `CHAT_INTRO_HR` / `CHAT_PRESENTATION_HR`: port Landmark's minus the document, attachment and route
  sections. Keep: tools paragraph, out-of-scope rules (writes refused unless a write tool is offered; data
  outside the role), number/currency/date formats, tone, off-domain questions.
- `VOICE_INTRO_HR` / `VOICE_PRESENTATION_HR`: port Landmark's verbatim (it is the result of real calls),
  with "Cognilion" replaced by the product name. Mark `<!-- needs native review -->`.

### 7. The loop (`loop/orchestrator.ts`)

Ports (unchanged from Landmark except where noted):

```ts
export interface EventSink {
  textDelta(text: string): Promise<void>
  toolStarting(): Promise<void>
  textBlock(text: string, messageId: string): Promise<void>        // + messageId (new)
  toolCall(tool: string, input: unknown, id: string): Promise<void>
  toolResult(tool: string, output: unknown, id: string, isError: boolean): Promise<void>
  done(stopReason: string, usage: Usage): Promise<void>
  error(code: ErrorCode, message: string): Promise<void>
}
export interface MessageStore { insert(row: MessageRow): Promise<{ id: string | null; code?: string }> }
export interface LoopHooks {
  isCancelled(): Promise<boolean>; onComplete(): Promise<void>
  mark?(event: 'model_call' | 'first_event' | 'tools_start' | 'tools_done'): void
  usage?(u: { input: number; output: number; cacheRead: number; cacheWrite: number }): void
}
export interface LoopConfig { channel; settings: ChannelSettings; system: SystemBlock[]; tools: Anthropic.Tool[]; registry: ToolRegistry; logTag: string }
export interface LoopInput { sessionId: string; messages: InMemoryMessage[]; lastInsertedId: string; extras: ToolHandlerExtras }
export async function runOrchestrationLoop(ctx, config, input, sink, store, hooks, signal): Promise<void>
```

Algorithm per iteration (changes to Landmark in bold):

1. `if (await hooks.isCancelled()) return` (boundary check).
2. `applyMessageCacheBreakpoint(messages)`.
3. Stream the model call: `anthropic.messages.stream(params, { signal })` or `anthropic.beta.messages.stream({ ...params, betas })`
   when `betas` is non-empty. On `text_delta` → `sink.textDelta`; on `content_block_start` of `tool_use` → `sink.toolStarting()`.
   `response = await stream.finalMessage()`; report usage via `hooks.usage`.
   - On throw: if `signal.aborted` → log and return; else `mapAnthropicError` → `sink.error` → return.
4. Persist the assistant row (`turn_kind: 'assistant'`, tokens incl. cache counts, `stop_reason`). On failure → `sink.error('persistence_error')` → return.
5. Emit in content-block order: `text` → `sink.textBlock(text, rowId)`; `tool_use` → `sink.toolCall`. Skip other block types (thinking, fallback) silently; they are persisted in the row.
6. **`stop_reason === 'refusal'`** → `sink.done('refusal', usage)` → `onComplete` → return (the sinks decide what to say; never run that turn's tools).
7. `stop_reason === 'tool_use'` with no tool blocks → `done` → return (defensive, as Landmark).
8. `stop_reason === 'tool_use'`:
   - **Abort check between model call and dispatch**: if cancelled, every tool gets the synthetic result `{ error: 'cancelled before the tool ran' }`, persist the tool_result row, return.
   - Dispatch concurrently: `dispatchToolWithTimeout(name, input, ctx, extras, settings.toolTimeoutMs, channel, signal)` for each, **but settle early on abort**: race `Promise.all(results)` against the abort; tools that finished keep their real output, the rest get `{ error: 'cancelled before the tool returned' }`.
   - **Persist the single tool_result row first** (`turn_kind: 'tool_result'`, blocks in `tool_use` order, `content` JSON strings, `is_error`), **then emit** `sink.toolResult` for each in `tool_use` order. On insert failure → `sink.error('persistence_error')` → return.
   - If aborted → return silently (the row is persisted; the request owner may emit `cancelled`).
   - Push the assistant content and the tool_result blocks onto `messages`; continue.
9. Truncation guard (terminal stop with tool blocks present): port Landmark's: synthetic error tool results, persisted, then one Croatian explanation row + `textBlock` + `done`.
10. Terminal: `done(stopReason, usage)` → `onComplete` → return.
11. Iteration cap: port Landmark's (`tool_limit_reached` row, `textBlock`, `done`).

Dispatch (`loop/dispatch.ts`): `dispatchTool` resolves through `registry.find(ctx, name, channel)`; unknown /
not-for-role / not-on-channel become thrown errors with those reasons (logged with `tool refused at dispatch`);
**input is validated with the tool's zod schema** and a failure becomes an `is_error` result
`{ error: 'invalid tool input', issues }`; the handler gets a child `AbortSignal` that fires on timeout or
loop abort; `dispatchToolWithTimeout` **clears its timer** when the handler settles and reports
`tool_timeout` as an error envelope. A handler that returns `{ error }` is treated as `is_error` (Landmark).

### 8. History assembly (`loop/history.ts`)

```ts
export function assembleHistory(rows: AiMessageRow[], opts: { hardCeilingTokens: number; summary?: { text: string; throughMessageId: string } }): InMemoryMessage[]
```

Steps: rows root → leaf (as the SQL function returns them) → `repairUnansweredToolUse` (after any
assistant row whose `tool_use` ids are not all answered by the next row, insert a **synthetic** user
message of `tool_result` blocks, `is_error: true`, content `{ error: 'interrupted before the tool returned' }`;
in memory only) → `splitTurns` (a turn starts at every `turn_kind: 'user'` row) → apply the summary as a
banner folded into the oldest surviving turn when its boundary id is in the chain (port
`selectKeptChain`) → `enforceHardCeiling` (drop whole oldest turns while the rough token estimate, chars/4,
exceeds the ceiling) → content block arrays (text in, synthetic blocks included). The compaction
*writer* (`maybeCompactSession`) is **not** in the skeleton: leave a documented stub and a backlog entry.

### 9. Sinks

- `BufferedSink`: collects everything; `text` (all deltas), `blocks`, `toolCalls`, `toolResults`, `done`, `error`. Used by tests and by any non-streamed response.
- `SpokenTextSink` (3c): port Landmark's `OpenAiChunkSink` **without** the wire format. Constructor
  `(say: (text: string) => Promise<void>, end: (reason: 'done' | 'error') => Promise<void>, pickFiller?)`.
  Behaviour, pinned by the S-scenarios: text released a word at a time up to the last whitespace; the first
  sentence of each stretch is **held** until a second sentence starts (if a tool call starts instead the held
  sentence was a lookup announcement and is dropped); `toolStarting` speaks one filler per request followed by
  `\n\n`; `textBlock` is spoken only when its text was not already streamed; `toolCall`/`toolResult` no-ops;
  `done` flushes and, on `refusal` with nothing spoken, says `Na to vam ne mogu odgovoriti.`; `error`
  flushes then speaks the Croatian message; everything passes through `speakable()`.
- `speakable()` (3c): port Landmark's regexes (TIC/OIB/IBAN declined lower-case, `EUR`/`€` → `eura`, strip
  `**`, `__`, backticks, headings, list bullets). Add: collapse 3+ newlines to 2; strip markdown links to
  their text. Tests from Landmark's `sink.test.ts`.

### 10. Fakes and harness (`test/`)

Port `fake-anthropic.ts` and `fake-supabase.ts` from Landmark's `supabase/functions/ai-chat/tests/` to
Node (they use only `Request`/`Response`/`fetch`, so the port is mechanical: replace `Deno.inspect` and
`Deno.env`; keep conversation-shape validation, `hangUntilAborted`, `connectionError`, request recording
tagged by client, fault injection, PostgREST subset incl. `rpc/`). `fixtures.ts` seeds `users`
(admin, member), one chat session, and `demo_items`. `harness.ts` sets the env, routes `globalThis.fetch`,
exports `scenario(name, fn)` (fresh world per scenario; fails on unscripted or unused model turns) and
helpers `runChat(ctx, text, opts)` that wire `BufferedSink`, an in-memory `DbStore` (inserting through the
fake service client so rows and requests are recorded), default hooks and an `AbortController`.

### 11. Scenario suite (3b; ids are the spec)

**Engine (`E`)** — port Landmark's L-list minus pre-stream and chat-only items:
E01 plain answer: deltas then one `turn` with the row id, `done`, rows `[user, assistant]` through the service role;
E02 request shape: model from settings, `max_tokens`, two system blocks with breakpoint on the first, role-and-channel-filtered tools sorted by name with breakpoint on the last, `strict: true` on every tool;
E03 cache breakpoint slides to the last block of the last message every call;
E04 one tool round trip: `tool_call` after the assistant row, `tool_result` **after** its row exists, four chained rows, tool read with the user JWT;
E05 text and tool_use in one turn emitted in block order;
E06 two tools in one turn dispatched concurrently (second starts before first finishes), one tool_result row, events and blocks in tool_use order;
E07 handler `{ error }` → `is_error`, loop continues;
E08 a tool the role may not use is not advertised and refused at dispatch (`not_permitted_for_role`);
E09 a tool not on the channel allowlist is refused at dispatch (`not_permitted_on_channel`) with `channel: 'voice'`;
E10 unknown tool → `unknown_tool`;
E11 invalid input (zod) → `is_error` with issues, handler not called;
E12 thinking/fallback blocks persisted, never emitted;
E13 `tool_use` stop with no block → done, no row;
E14 terminal `max_tokens` on plain text passes through;
E15 truncation mid tool_use → synthetic error results persisted, explanation row, `done`;
E16 iteration cap → `tool_limit_reached` row chained off the last tool_result;
E17 assistant insert failure → `persistence_error`, nothing emitted for that turn;
E18 tool_result insert failure → `persistence_error`, **no** `tool_result` events (persist-then-emit);
E19 Anthropic 429/401/400/500/529/connection → mapped codes, Croatian messages;
E20 abort at a boundary → silent return, rows so far stay;
E21 abort during the model call → no assistant row, silent return;
E22 abort between model call and dispatch → tools never run, synthetic results **persisted**, silent return;
E23 abort during dispatch → finished tools keep output, unfinished get synthetic, one row persisted, silent return;
E24 invariant: on every exit path that can write, the newest row of the branch is never an assistant row with unanswered tool_use (parametrised over E15–E23);
E25 per-tool timeout → `tool_timeout` error result, timer cleared (op sanitiser on), handler's signal aborted;
E26 `refusal` stop → `done('refusal')`, no tools run, row persisted;
E27 `hooks.usage` receives cache read/write counts; `mark` order `model_call, first_event, tools_start, tools_done`;
E28 voice settings: `max_tokens` 1024, 4 iterations, 6 s tool timeout, Sonnet 5.5 with `between_tools`, effort `low`, fallbacks default + beta header; chat: Opus 5.5, no `thinking`, effort from env, same fallback;
E29 another model (env override) gets none of the model-specific extras;
E30 history assembly input with an unanswered tool_use is repaired before the first call (the fake would otherwise reject it).

**History (`H`)**: H01 root→leaf order; H02 repair inserts a synthetic tool_result message after the dangling assistant row, as a separate message; H03 turns split only at `turn_kind: 'user'`; H04 summary applied when its boundary is on the branch, ignored otherwise; H05 hard ceiling drops whole oldest turns; H06 a tool_use is never separated from its tool_result by trimming.

**Tools (`T`)**: T01 duplicate name throws at construction; T02 voice allowlist naming an unknown or write tool throws at construction; T03 every registered tool's JSON schema has `additionalProperties: false` and `required`; T04 `select` = role ∩ channel for every role and channel (table-driven); T05 what dispatch accepts equals what is advertised, for every role and channel; T06 `anthropicTools` order is stable across calls (cache).

**Model (`M`)**: the profile table above, one case per row, plus "never sends thinking disabled / temperature / tool_choice".

**Spoken (`S`)** (3c): port Landmark's `sink.test.ts` cases, plus: S08 `speakable` strips a markdown link to its text; S09 three newlines collapse to two; S10 `error` after partial speech appends the message with a space.

### 12. Public surface (`index.ts`)

`runOrchestrationLoop`, the port interfaces, `ToolRegistry`, `defineTool`, `CHANNEL_ALLOWLIST`,
`channelSettings`, `CHANNEL_DEFAULTS`, `authenticateToken`, `AuthContext`, `Role`, `buildStaticSystemPrompt`,
`buildUserContext`, `assembleHistory`, `BufferedSink`, `SpokenTextSink`, `speakable`, `ErrorCode`,
`MESSAGES_HR`, `mapAnthropicError`, `modelProfile`. Test helpers are exported from `@va/core/test` (a
second export path) so the api and voice suites reuse the fakes.

## Acceptance checklist

- [ ] All E/H/T/M/S scenarios green with Vitest's op and resource checks on (no leaked timers).
- [ ] `pnpm --filter @va/core typecheck` and lint green; no `any` outside the fakes.
- [ ] `docs/CORE.md` written: ports, persistence order, abort contract, channel table, tool contract and catalogue (the demo pack), prompt structure, cache strategy, model profiles, how to add a tool, how to add a channel, how to run one scenario with logs.
- [ ] Backlog entries: compaction writer not implemented; native review of all Croatian text; `demo_items` migration decision.
- [ ] A short "how a turn flows" sequence in `docs/CORE.md` matching Landmark's `docs/AI_CHAT.md` diagram.

## Do not

- Use the SDK's beta Tool Runner; the manual loop is required for the persistence order, the sinks and the abort contract (record this in `docs/decisions/0009-manual-loop-not-tool-runner.md`).
- Import HTTP, LiveKit, React or Node server APIs into `packages/core`.
- Put a clock or env read into a prompt builder.
- Emit a `tool_result` event before its row exists.
- Copy Landmark's domain rules (TIC, cesija, invoices) into `DOMAIN_RULES_HR`.

## Landmark references

- `supabase/functions/_shared/orchestrator.ts` (the loop), `tools.ts` (registry + allowlist), `prompts.ts`,
  `auth.ts`, `context-window.ts` (history), `sse.ts` (chat sink), `rateLimit.ts`
- `supabase/functions/voice-llm/sink.ts` + `sink.test.ts` (spoken sink), `messages.ts` (inbound cleaning)
- `supabase/functions/ai-chat/tests/{fake-anthropic,fake-supabase,fixtures,harness}.ts`, `loop.test.ts`
- `docs/voice/03-characterisation-tests.md` (scenario discipline), `docs/voice/open-questions.md` (OQ-1, OQ-3, OQ-5, OQ-9 are fixed by design here)
- `docs/voice/02-voice-implementation-plan.md` §3, §4.1, §4.2, §4.7, §5, §6, §7
