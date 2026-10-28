// One round of tool calls: the abort check between the model call and dispatch, concurrent
// dispatch that settles early on abort, the single `tool_result` row persisted before any result
// event, and the events in `tool_use` order. Synthetic `is_error` results stand in for tools that
// never ran or never returned, so the branch never ends on a bare `tool_use`.
import type { Json } from '@va/db'

import type { AuthContext } from '../auth.js'
import { log } from '../log.js'
import { dispatchToolWithTimeout, type ToolOutcome } from './dispatch.js'
import type {
  EventSink,
  LoopConfig,
  LoopHooks,
  MessageRow,
  MessageStore,
  ToolResultBlock,
  ToolUseBlock,
} from './ports.js'

export const CANCELLED_BEFORE_RUN = { error: 'cancelled before the tool ran' }
export const CANCELLED_BEFORE_RETURN = { error: 'cancelled before the tool returned' }
export const TRUNCATED_RESULT = { error: 'response truncated before the tool call completed' }

export type ToolRound =
  | { kind: 'persisted'; rowId: string; blocks: ToolResultBlock[]; aborted: boolean }
  | { kind: 'persistence_failed' }

export interface ToolRoundInput {
  ctx: AuthContext
  config: LoopConfig
  toolUses: ToolUseBlock[]
  parentId: string
  sessionId: string
  iteration: number
  extras: Parameters<typeof dispatchToolWithTimeout>[4]
}

export async function runToolRound(
  input: ToolRoundInput,
  sink: EventSink,
  store: MessageStore,
  hooks: LoopHooks,
  signal: AbortSignal,
): Promise<ToolRound> {
  const { ctx, config, toolUses } = input
  const cancelledBefore = signal.aborted || (await hooks.isCancelled())
  let results: ToolOutcome[]
  if (cancelledBefore) {
    results = toolUses.map(() => ({ output: CANCELLED_BEFORE_RUN, isError: true }))
  } else {
    hooks.mark?.('tools_start')
    results = await dispatchAll(
      toolUses.map(
        (tu) => () =>
          dispatchToolWithTimeout(
            config.registry,
            tu.name,
            tu.input,
            ctx,
            input.extras,
            config.settings.toolTimeoutMs,
            config.channel,
            signal,
            config.logTag,
          ),
      ),
      signal,
    )
    hooks.mark?.('tools_done')
  }
  const aborted = cancelledBefore || signal.aborted || (await hooks.isCancelled())
  const blocks = toolResultBlocks(toolUses, results)
  return await persistThenEmit(input, blocks, aborted, sink, store)
}

/** Persists the single `tool_result` row, then emits one `toolResult` per block unless the
 * request was aborted (silent return: the request owner decides what to say). */
export async function persistThenEmit(
  input: Pick<ToolRoundInput, 'ctx' | 'config' | 'toolUses' | 'parentId' | 'sessionId' | 'iteration'>,
  blocks: ToolResultBlock[],
  aborted: boolean,
  sink: EventSink,
  store: MessageStore,
): Promise<ToolRound> {
  const toolResultRow: MessageRow = {
    role: 'user',
    turn_kind: 'tool_result',
    content: blocks as unknown as Json,
    parent_id: input.parentId,
  }
  // One retry: this row is what keeps the branch from ending on a bare tool_use, so a transient
  // failure is worth a second attempt before the exit path (history assembly repairs the rest).
  let row = await store.insert(toolResultRow)
  if (!row.id) row = await store.insert(toolResultRow)
  if (!row.id) {
    log('error', input.config.logTag, 'tool_result insert failed', {
      userId: input.ctx.userId,
      sessionId: input.sessionId,
      iteration: input.iteration,
      code: row.code ?? null,
    })
    return { kind: 'persistence_failed' }
  }
  if (!aborted) {
    for (const [i, tu] of input.toolUses.entries()) {
      const block = blocks[i]!
      await sink.toolResult(tu.name, JSON.parse(block.content), tu.id, block.is_error)
    }
  }
  return { kind: 'persisted', rowId: row.id, blocks, aborted }
}

export function toolResultBlocks(
  toolUses: readonly ToolUseBlock[],
  results: readonly ToolOutcome[],
): ToolResultBlock[] {
  return toolUses.map((tu, i) => ({
    type: 'tool_result',
    tool_use_id: tu.id,
    content: JSON.stringify(results[i]!.output),
    is_error: results[i]!.isError,
  }))
}

/**
 * Runs every dispatch concurrently and waits for all of them, or for the abort, whichever comes
 * first. Results that settle before the abort are kept; the rest become synthetic results. A
 * result that lands after the abort is discarded (`signal.aborted` flips synchronously, so the
 * check is exact).
 */
export async function dispatchAll(
  dispatches: ReadonlyArray<() => Promise<ToolOutcome>>,
  signal: AbortSignal,
): Promise<ToolOutcome[]> {
  const settled: Array<ToolOutcome | undefined> = new Array<ToolOutcome | undefined>(dispatches.length)
  const all = Promise.all(
    dispatches.map((run, i) =>
      run().then((r) => {
        if (!signal.aborted) settled[i] = r
      }),
    ),
  )
  let onAbort: (() => void) | undefined
  const aborted = new Promise<void>((resolve) => {
    onAbort = () => resolve()
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    await Promise.race([all, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
  // Not `settled.map`: it would skip the holes of a sparse array.
  return Array.from(
    { length: dispatches.length },
    (_, i) => settled[i] ?? { output: CANCELLED_BEFORE_RETURN, isError: true },
  )
}
