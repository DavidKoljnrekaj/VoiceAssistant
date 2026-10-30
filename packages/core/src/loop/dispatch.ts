// Tool dispatch: the gate at the moment of use, zod re-validation, the per-tool timeout and the
// child abort signal. Unknown and forbidden names, invalid input, a thrown handler, a timeout
// and an output JSON cannot hold all become `is_error` results; the loop never throws because
// of a tool.
import type { AuthContext } from '../auth.js'
import type { Channel } from '../channel.js'
import { errorReason, log } from '../log.js'
import type { ToolHandlerExtras } from '../tools/define.js'
import type { ToolRegistry } from '../tools/registry.js'

/** What a tool round persists and emits for one `tool_use`. `output` always serialises to JSON:
 * `dispatchToolWithTimeout` turns `undefined` into `null` and anything `JSON.stringify` rejects
 * into an error envelope, so the `tool_result` row can always be written (invariant 3). */
export interface ToolOutcome {
  output: unknown
  isError: boolean
}

/** A handler's `{ error }` return is an error result too (Landmark's convention). */
export function isErrorEnvelope(output: unknown): boolean {
  return output !== null && typeof output === 'object' && 'error' in output
}

/**
 * Resolves the name through the same role-and-channel filter as advertisement, validates the
 * input with the tool's zod schema and runs the handler with `signal`. A refusal throws (the
 * caller turns it into an error result); invalid input returns the error envelope without
 * calling the handler.
 */
export async function dispatchTool(
  registry: ToolRegistry,
  name: string,
  input: unknown,
  ctx: AuthContext,
  extras: ToolHandlerExtras,
  channel: Channel,
  signal: AbortSignal,
  logTag: string,
): Promise<unknown> {
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
      error: 'invalid tool input',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    }
  }
  return await tool.handler(parsed.data, ctx, extras, signal)
}

/**
 * `dispatchTool` raced against `timeoutMs`. The handler gets a child signal that fires on the
 * timeout and on the loop's own abort; the timer is cleared however the race ends, including
 * the loop's abort while a handler that ignores its signal is still running, and a late result
 * from a timed-out or aborted handler is discarded.
 */
export async function dispatchToolWithTimeout(
  registry: ToolRegistry,
  name: string,
  input: unknown,
  ctx: AuthContext,
  extras: ToolHandlerExtras,
  timeoutMs: number,
  channel: Channel,
  signal: AbortSignal,
  logTag: string,
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
    const output = await Promise.race([
      dispatchTool(registry, name, input, ctx, extras, channel, child, logTag),
      expired,
    ])
    return serialisableOutcome(output, name, ctx, extras, logTag)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'tool_timeout') {
      log('warn', logTag, 'tool timeout', {
        userId: ctx.userId,
        tool: name,
        timeoutMs,
        requestId: extras.requestId,
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
 * `null`; a value `JSON.stringify` rejects (a BigInt, a cycle) becomes an `is_error` envelope,
 * logged, instead of a row that cannot be written or read back.
 */
export function serialisableOutcome(
  raw: unknown,
  name: string,
  ctx: AuthContext,
  extras: ToolHandlerExtras,
  logTag: string,
): ToolOutcome {
  const output = raw === undefined ? null : raw
  try {
    JSON.stringify(output)
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
