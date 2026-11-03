// Tool dispatch: the gate at the moment of use, zod re-validation, the write protocol, the
// per-tool timeout and the child abort signal. Unknown and forbidden names, invalid input, a
// thrown handler, a timeout and an output JSON cannot hold all become `is_error` results; the
// loop never throws because of a tool. A tool that writes runs only on a request the channel
// marked as confirmed; otherwise it previews and the user is asked (decision 0015).
import type { AuthContext } from '../auth.js'
import type { Channel } from '../channel.js'
import { errorReason, log } from '../log.js'
import type { ToolHandlerExtras } from '../tools/define.js'
import type { ToolRegistry } from '../tools/registry.js'
import { CONFIRMATION_TTL_MS, inputHash, pendingResult } from './confirmations.js'
import type { ConfirmationStore } from './ports.js'

/** What a tool round persists and emits for one `tool_use`. `output` always serialises to JSON:
 * `dispatchToolWithTimeout` turns `undefined` (and a function or a Symbol, which `JSON.stringify`
 * drops the same way) into `null` and anything `JSON.stringify` rejects into an error envelope,
 * so the `tool_result` row can always be written (invariant 3). `pending` is set when a
 * confirmed tool previewed instead of running: the row holds the summary, the sink gets the id. */
export interface ToolOutcome {
  output: unknown
  isError: boolean
  pending?: { id: string; summary: string; expiresAt: string }
}

/** Everything dispatch needs beyond the call itself: the same for every tool of a round. */
export interface DispatchContext {
  registry: ToolRegistry
  ctx: AuthContext
  extras: ToolHandlerExtras
  channel: Channel
  sessionId: string
  confirmations: ConfirmationStore
  logTag: string
  /** The clock, for the confirmation's expiry; `Date.now` by default. */
  now?: () => number
}

export type DispatchResult =
  { kind: 'output'; output: unknown } | { kind: 'pending'; id: string; summary: string; expiresAt: string }

/** A handler's `{ error }` return is an error result too (Landmark's convention). */
export function isErrorEnvelope(output: unknown): boolean {
  return output !== null && typeof output === 'object' && 'error' in output
}

/**
 * Resolves the name through the same role-and-channel filter as advertisement, validates the
 * input with the tool's zod schema, then runs the handler with `signal`, or, for a tool that
 * needs the user's confirmation, consumes the request's confirmation and runs, or previews. A
 * refusal throws (the caller turns it into an error result); invalid input returns the error
 * envelope without calling the handler.
 */
export async function dispatchTool(
  dc: DispatchContext,
  name: string,
  input: unknown,
  signal: AbortSignal,
): Promise<DispatchResult> {
  const { registry, ctx, extras, channel, logTag } = dc
  const tool = registry.find(ctx, name, channel)
  if (!tool) {
    const reason = registry.refusalReason(ctx, name, channel) ?? 'unknown_tool'
    log('warn', logTag, 'tool refused at dispatch', {
      userId: ctx.userId,
      role: ctx.role,
      channel,
      tool: name,
      reason,
      requestId: extras.requestId,
    })
    throw new Error(`tool refused: ${reason}`)
  }
  const parsed = tool.input.safeParse(input)
  if (!parsed.success) {
    log('warn', logTag, 'invalid tool input', {
      userId: ctx.userId,
      tool: name,
      issues: parsed.error.issues.length,
      requestId: extras.requestId,
    })
    return {
      kind: 'output',
      output: {
        error: 'invalid tool input',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    }
  }
  if (tool.confirmation !== 'required') {
    return { kind: 'output', output: await tool.handler(parsed.data, ctx, extras, signal) }
  }

  // The write protocol. The id is the channel's: it arrives in `extras`, never in the input.
  const ids = { userId: ctx.userId, sessionId: dc.sessionId, tool: name, requestId: extras.requestId }
  const hash = inputHash(parsed.data)
  const confirmed = extras.confirmation
  if (confirmed) {
    const verdict = await dc.confirmations.consume(confirmed.id, {
      sessionId: dc.sessionId,
      userId: ctx.userId,
      tool: name,
      inputHash: hash,
    })
    if (verdict === 'ok') {
      let output: unknown
      try {
        output = await tool.handler(parsed.data, ctx, extras, signal)
      } catch (err) {
        await dc.confirmations.settle(confirmed.id, 'failed', errorReason(err))
        throw err
      }
      const failed = isErrorEnvelope(output)
      await dc.confirmations.settle(
        confirmed.id,
        failed ? 'failed' : 'executed',
        failed ? 'error_envelope' : undefined,
      )
      log('info', logTag, 'confirmed write executed', { ...ids, failed })
      return { kind: 'output', output }
    }
    log('warn', logTag, 'confirmation not consumed', { ...ids, reason: verdict })
  }
  // `preview` is required with `confirmation` (defineTool asserts it). A preview the loop gave
  // up on (abort, timeout) issues nothing: the user was never asked.
  const summary = await tool.preview!(parsed.data, ctx, extras, signal)
  if (signal.aborted) return { kind: 'output', output: { error: 'cancelled before the preview completed' } }
  const expiresAt = new Date((dc.now ?? Date.now)() + CONFIRMATION_TTL_MS).toISOString()
  const issued = await dc.confirmations.issue({
    sessionId: dc.sessionId,
    userId: ctx.userId,
    tool: name,
    inputHash: hash,
    summary,
    expiresAt,
  })
  if (!issued.id) {
    log('error', logTag, 'confirmation issue failed', {
      ...ids,
      code: 'code' in issued ? (issued.code ?? null) : null,
    })
    return { kind: 'output', output: { error: 'confirmation could not be recorded; nothing was done' } }
  }
  log('info', logTag, 'confirmation pending', { ...ids, summary_len: summary.length })
  return { kind: 'pending', id: issued.id, summary, expiresAt }
}

/**
 * `dispatchTool` raced against `timeoutMs`. The handler gets a child signal that fires on the
 * timeout and on the loop's own abort; the timer is cleared however the race ends, including
 * the loop's abort while a handler that ignores its signal is still running, and a late result
 * from a timed-out or aborted handler is discarded.
 */
export async function dispatchToolWithTimeout(
  dc: DispatchContext,
  name: string,
  input: unknown,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const timeout = new AbortController()
  const child = AbortSignal.any([signal, timeout.signal])
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timeout.abort(new Error('tool_timeout'))
      reject(new Error('tool_timeout'))
    }, timeoutMs)
    // The loop gave up on this round: the timer has nothing left to guard.
    onAbort = () => {
      clearTimeout(timer)
      reject(new Error('tool_aborted'))
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const result = await Promise.race([dispatchTool(dc, name, input, child), expired])
    if (result.kind === 'pending') {
      const { id, summary, expiresAt } = result
      return { output: pendingResult(summary), isError: false, pending: { id, summary, expiresAt } }
    }
    return serialisableOutcome(result.output, name, dc.ctx, dc.extras, dc.logTag)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'tool_timeout') {
      log('warn', dc.logTag, 'tool timeout', {
        userId: dc.ctx.userId,
        tool: name,
        timeoutMs,
        requestId: dc.extras.requestId,
      })
    }
    return { output: { error: `tool execution failed: ${message}` }, isError: true }
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

/**
 * A handler's return as the row will hold it: `undefined` (a `Promise<void>` handler) becomes
 * `null`, as does a function or a Symbol, which `JSON.stringify` returns `undefined` for
 * instead of throwing (a block with no `content` otherwise, V-6); a value `JSON.stringify`
 * rejects (a BigInt, a cycle) becomes an `is_error` envelope, logged, instead of a row that
 * cannot be written or read back.
 */
export function serialisableOutcome(
  raw: unknown,
  name: string,
  ctx: AuthContext,
  extras: ToolHandlerExtras,
  logTag: string,
): ToolOutcome {
  try {
    const output = JSON.stringify(raw) === undefined ? null : raw
    return { output, isError: isErrorEnvelope(output) }
  } catch (err) {
    log('warn', logTag, 'tool output not serialisable', {
      userId: ctx.userId,
      tool: name,
      reason: errorReason(err),
      requestId: extras.requestId,
    })
    return { output: { error: `tool output not serialisable: ${errorReason(err)}` }, isError: true }
  }
}
