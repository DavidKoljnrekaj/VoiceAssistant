// The agent loop, shared by every channel: one loop, one tool registry, one role gate. What
// differs per channel comes in through an EventSink, a MessageStore, LoopHooks and the settings
// row in LoopConfig. Ported from Landmark's `_shared/orchestrator.ts` with the brief's changes:
// abort is a first-class exit that persists synthetic results, tool results are persisted before
// they are emitted, deltas reach the sink, tool input is re-validated with zod, and the model's
// request fields come from `modelProfile`. The manual loop is a decision (docs/decisions/0009).
//
// Persistence order, per iteration:
//   1. stream the model turn (deltas and tool starts go to the sink as they arrive)
//   2. persist the assistant row
//   3. emit text → textBlock / tool_use → toolCall in content-block order
//   4. on tool_use: dispatch concurrently, persist the one tool_result row, emit the results
//   5. otherwise emit done, run onComplete, return
import type { Json } from '@va/db'

import type { AuthContext } from '../auth.js'
import { MESSAGES_HR } from '../errors.js'
import { log } from '../log.js'
import { modelProfile } from '../model.js'
import { applyMessageCacheBreakpoint } from './history.js'
import { streamModelTurn } from './model-call.js'
import type {
  EventSink,
  LoopConfig,
  LoopHooks,
  LoopInput,
  MessageStore,
  TextBlock,
  ToolUseBlock,
  Usage,
} from './ports.js'
import { persistThenEmit, runToolRound, toolResultBlocks, TRUNCATED_RESULT } from './tool-round.js'

/** <!-- needs native review --> */
export const TRUNCATED_HR = 'Odgovor nije dovršen. Pokušajte ponovno.'

export async function runOrchestrationLoop(
  ctx: AuthContext,
  config: LoopConfig,
  input: LoopInput,
  sink: EventSink,
  store: MessageStore,
  hooks: LoopHooks,
  signal: AbortSignal,
): Promise<void> {
  const { sessionId, messages, extras } = input
  const { settings, logTag } = config
  const profile = modelProfile(settings)
  const ids = { userId: ctx.userId, sessionId, requestId: extras.requestId }
  let lastInsertedId = input.lastInsertedId
  let lastUsage: Usage = { input_tokens: 0, output_tokens: 0 }

  for (let iteration = 0; iteration < settings.maxIterations; iteration++) {
    // Iteration boundary: nothing is sent to the model once the request is cancelled.
    if (signal.aborted || (await hooks.isCancelled())) return

    applyMessageCacheBreakpoint(messages)
    const turn = await streamModelTurn(config, profile, messages, sink, hooks, signal)
    if (turn.kind === 'aborted') {
      log('info', logTag, 'model call aborted', { ...ids, iteration })
      return
    }
    if (turn.kind === 'failed') {
      if (turn.mapped.shouldLog) {
        log('error', logTag, 'model call failed', {
          ...ids,
          iteration,
          errorClass: turn.errorClass,
          code: turn.mapped.code,
        })
      }
      await sink.error(turn.mapped.code, turn.mapped.message)
      return
    }
    const response = turn.message
    lastUsage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }

    // The row is the contract; every event below is its projection.
    const assistantRow = await store.insert({
      role: 'assistant',
      turn_kind: 'assistant',
      content: response.content as unknown as Json,
      model: response.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: response.usage.cache_creation_input_tokens ?? 0,
      stop_reason: response.stop_reason,
      parent_id: lastInsertedId,
    })
    if (!assistantRow.id) {
      log('error', logTag, 'assistant insert failed', { ...ids, iteration, code: assistantRow.code ?? null })
      await sink.error('persistence_error', MESSAGES_HR.persistence_error)
      return
    }
    lastInsertedId = assistantRow.id
    messages.push({ role: 'assistant', content: response.content })

    // Content-block order. Thinking, fallback and unknown block types stay in the row only.
    const toolUses: ToolUseBlock[] = []
    for (const block of response.content) {
      if (block.type === 'text') await sink.textBlock((block as TextBlock).text, assistantRow.id)
      else if (block.type === 'tool_use') {
        const tu = block as ToolUseBlock
        toolUses.push(tu)
        await sink.toolCall(tu.name, tu.input, tu.id)
      }
    }

    const stopReason = response.stop_reason ?? 'end_turn'

    // A refusal runs no tools; the sinks decide what to say.
    if (stopReason === 'refusal') {
      await sink.done('refusal', lastUsage)
      await hooks.onComplete()
      return
    }
    // Defensive: a tool_use stop with nothing to dispatch is terminal.
    if (stopReason === 'tool_use' && toolUses.length === 0) {
      await sink.done(stopReason, lastUsage)
      await hooks.onComplete()
      return
    }

    if (stopReason === 'tool_use') {
      const round = await runToolRound(
        { ctx, config, toolUses, parentId: lastInsertedId, sessionId, iteration, extras },
        sink,
        store,
        hooks,
        signal,
      )
      if (round.kind === 'persistence_failed') {
        await sink.error('persistence_error', MESSAGES_HR.persistence_error)
        return
      }
      lastInsertedId = round.rowId
      messages.push({ role: 'user', content: round.blocks })
      if (round.aborted) {
        log('info', logTag, 'tool round aborted', { ...ids, iteration })
        return
      }
      continue
    }

    // Truncation guard: a terminal stop (almost always max_tokens) with tool_use blocks means the
    // model ran out of budget mid call. Close the tool calls out with persisted error results and
    // tell the user, so no client spinner waits for a result that never comes.
    if (toolUses.length > 0) {
      log('warn', logTag, 'response truncated mid tool_use', {
        ...ids,
        iteration,
        stopReason,
        toolCount: toolUses.length,
      })
      const blocks = toolResultBlocks(
        toolUses,
        toolUses.map(() => ({ output: TRUNCATED_RESULT, isError: true })),
      )
      const round = await persistThenEmit(
        { ctx, config, toolUses, parentId: lastInsertedId, sessionId, iteration },
        blocks,
        false,
        sink,
        store,
      )
      if (round.kind === 'persistence_failed') {
        await sink.error('persistence_error', MESSAGES_HR.persistence_error)
        return
      }
      const explanation = await store.insert({
        role: 'assistant',
        turn_kind: 'assistant',
        content: [{ type: 'text', text: TRUNCATED_HR }],
        model: response.model,
        stop_reason: stopReason,
        parent_id: round.rowId,
      })
      if (!explanation.id) {
        log('error', logTag, 'truncation row insert failed', {
          ...ids,
          iteration,
          code: explanation.code ?? null,
        })
        await sink.error('persistence_error', MESSAGES_HR.persistence_error)
        return
      }
      await sink.textBlock(TRUNCATED_HR, explanation.id)
      await sink.done(stopReason, lastUsage)
      await hooks.onComplete()
      return
    }

    await sink.done(stopReason, lastUsage)
    await hooks.onComplete()
    return
  }

  // Iteration cap without a terminal stop: one persisted explanation, chained off the last row.
  log('error', logTag, 'tool iteration limit reached', { ...ids, iterations: settings.maxIterations })
  const limitRow = await store.insert({
    role: 'assistant',
    turn_kind: 'assistant',
    content: [{ type: 'text', text: MESSAGES_HR.tool_limit_reached }],
    model: settings.model,
    input_tokens: lastUsage.input_tokens,
    output_tokens: lastUsage.output_tokens,
    stop_reason: 'tool_limit_reached',
    parent_id: lastInsertedId,
  })
  if (!limitRow.id) {
    log('error', logTag, 'limit row insert failed', { ...ids, code: limitRow.code ?? null })
    await sink.error('persistence_error', MESSAGES_HR.persistence_error)
    return
  }
  await sink.textBlock(MESSAGES_HR.tool_limit_reached, limitRow.id)
  await sink.done('tool_limit_reached', lastUsage)
  await hooks.onComplete()
}
