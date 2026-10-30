// E scenarios, part two: abort as a first-class exit, the per-tool timeout, and the invariant
// that no exit path leaves the branch on a bare tool_use.
import { describe, expect, it, vi } from 'vitest'

import { answer, callTools, toolUse } from '../test/fake-anthropic.js'
import {
  anthropic,
  authAs,
  blocksOf,
  db,
  logs,
  reset,
  runChat,
  scenario,
  sessionMessages,
} from '../test/harness.js'
import { BufferedSink } from '../sinks/buffered.js'
import { awaitHandlerEvent, EDGE_PACK, handlerEvents, openGate, TEST_PACK } from '../test/tools.js'
import { CANCELLED_BEFORE_RETURN, CANCELLED_BEFORE_RUN } from './tool-round.js'

const kinds = (sessionId: string) => sessionMessages(sessionId).map((r) => r.turn_kind)

/** Invariant 3: the newest row of the branch is never an assistant row with an unanswered tool_use. */
function expectBranchClosed(sessionId: string): void {
  const rows = sessionMessages(sessionId)
  const leaf = rows.at(-1)!
  const uses = blocksOf(leaf.content, 'tool_use')
  expect(uses, `leaf ${leaf.turn_kind} with ${uses.length} tool_use`).toHaveLength(0)
  for (const row of rows.filter((r) => r.turn_kind === 'assistant')) {
    const ids = blocksOf(row.content, 'tool_use').map((b) => b.id)
    if (ids.length === 0) continue
    const child = rows.find((r) => r.parent_id === row.id)
    expect(child?.turn_kind).toBe('tool_result')
    expect(blocksOf(child!.content, 'tool_result').map((b) => b.tool_use_id)).toEqual(ids)
  }
}

describe('abort, timeout and the no-bare-tool_use invariant', () => {
  scenario('E20 an abort seen at an iteration boundary returns silently; rows so far stay', async () => {
    anthropic.script(callTools(toolUse('echo', { text: 'a' })))
    const ctx = await authAs('member')
    const controller = new AbortController()
    const sink = new BufferedSink()
    // Cancel once a tool result has been emitted: the next check is the iteration boundary.
    const run = await runChat(ctx, 'x', {
      controller,
      sink,
      hooks: {
        isCancelled: async () => {
          if (sink.toolResults.length > 0) controller.abort()
          return controller.signal.aborted
        },
      },
    })
    expect(anthropic.calls).toHaveLength(1)
    expect(kinds(run.sessionId)).toEqual(['user', 'assistant', 'tool_result'])
    expect(run.sink.doneEvent).toBeNull()
    expect(run.sink.errorEvent).toBeNull()
    expect(run.completed).toBe(0)
    expectBranchClosed(run.sessionId)
  })

  scenario('E21 an abort during the model call: no assistant row, no event, silent return', async () => {
    anthropic.script({ hangUntilAborted: true })
    const ctx = await authAs('member')
    const controller = new AbortController()
    anthropic.onRequest(() => controller.abort())
    const run = await runChat(ctx, 'x', { controller })
    expect(kinds(run.sessionId)).toEqual(['user'])
    expect(run.sink.order).toEqual([])
    expect(logs.some((l) => l.line.includes('model call aborted'))).toBe(true)
    expectBranchClosed(run.sessionId)
  })

  scenario(
    'E22 an abort between the model call and dispatch: the tools never run, synthetic results are persisted, no result event',
    async () => {
      anthropic.script(callTools(toolUse('gate', { key: 'g' })))
      const ctx = await authAs('member')
      const controller = new AbortController()
      db.onRequest((r) => {
        if (
          r.table === 'ai_messages' &&
          r.method === 'POST' &&
          (r.body as { turn_kind: string }).turn_kind === 'assistant'
        )
          controller.abort()
      })
      const run = await runChat(ctx, 'x', { controller })
      expect(handlerEvents).toEqual([])
      expect(kinds(run.sessionId)).toEqual(['user', 'assistant', 'tool_result'])
      expect(blocksOf(run.rows()[2]!.content, 'tool_result')[0]).toMatchObject({
        is_error: true,
        content: JSON.stringify(CANCELLED_BEFORE_RUN),
      })
      expect(run.sink.toolCalls).toHaveLength(1)
      expect(run.sink.toolResults).toEqual([])
      expect(run.sink.doneEvent).toBeNull()
      expectBranchClosed(run.sessionId)
    },
  )

  scenario(
    'E23 an abort during dispatch: finished tools keep their output, the rest get synthetic results, one row, silent return',
    async () => {
      anthropic.script(callTools(toolUse('gate', { key: 'fast' }), toolUse('gate', { key: 'slow' })))
      openGate('fast', { ok: true })
      const ctx = await authAs('member')
      const controller = new AbortController()
      const pending = runChat(ctx, 'x', { controller })
      await awaitHandlerEvent('end:fast')
      await awaitHandlerEvent('start:slow')
      // Let the fast dispatch's promise chain settle before the abort flips `signal.aborted`.
      await new Promise((resolve) => setImmediate(resolve))
      controller.abort()
      const run = await pending
      expect(handlerEvents).toContain('aborted:slow')
      const blocks = blocksOf(run.rows()[2]!.content, 'tool_result')
      expect(blocks[0]).toMatchObject({ is_error: false, content: JSON.stringify({ ok: true }) })
      expect(blocks[1]).toMatchObject({ is_error: true, content: JSON.stringify(CANCELLED_BEFORE_RETURN) })
      expect(kinds(run.sessionId)).toEqual(['user', 'assistant', 'tool_result'])
      expect(run.sink.toolResults).toEqual([])
      expect(run.sink.doneEvent).toBeNull()
      expect(run.sink.errorEvent).toBeNull()
      expectBranchClosed(run.sessionId)
    },
  )

  scenario(
    'E35 CORE-8: an abort during the assistant-row insert on a terminal stop keeps the row and says nothing more: no done, no onComplete',
    async () => {
      anthropic.script(answer('Gotovo.'))
      const ctx = await authAs('member')
      const controller = new AbortController()
      db.onRequest((r) => {
        if (r.table === 'ai_messages' && (r.body as { turn_kind?: string })?.turn_kind === 'assistant')
          controller.abort()
      })
      const run = await runChat(ctx, 'x', { controller })
      expect(kinds(run.sessionId)).toEqual(['user', 'assistant'])
      expect(run.rows()[1]).toMatchObject({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Gotovo.' }] })
      expect(run.sink.doneEvent).toBeNull()
      expect(run.sink.errorEvent).toBeNull()
      expect(run.completed).toBe(0)
      expect(logs.some((l) => l.line.includes('aborted after model call'))).toBe(true)
      expectBranchClosed(run.sessionId)
    },
  )

  scenario(
    'E35b CORE-8: an abort during the assistant-row insert on a truncation persists the synthetic results and stops: no explanation row, no done',
    async () => {
      anthropic.script({ content: [toolUse('echo', { text: 'a' })], stop_reason: 'max_tokens' })
      const ctx = await authAs('member')
      const controller = new AbortController()
      db.onRequest((r) => {
        if (r.table === 'ai_messages' && (r.body as { turn_kind?: string })?.turn_kind === 'assistant')
          controller.abort()
      })
      const run = await runChat(ctx, 'x', { controller })
      expect(kinds(run.sessionId)).toEqual(['user', 'assistant', 'tool_result'])
      expect(blocksOf(run.rows()[2]!.content, 'tool_result')[0]).toMatchObject({ is_error: true })
      expect(run.sink.toolResults).toEqual([])
      expect(run.sink.blocks).toEqual([])
      expect(run.sink.doneEvent).toBeNull()
      expect(run.sink.errorEvent).toBeNull()
      expect(run.completed).toBe(0)
      expectBranchClosed(run.sessionId)
    },
  )

  it('E36 CORE-8: an abort during dispatch leaves no per-tool timer running, even for a handler that ignores its signal', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      reset()
      anthropic.script(callTools(toolUse('ignores_signal', { key: 'stubborn' })))
      const ctx = await authAs('member')
      const controller = new AbortController()
      const pending = runChat(ctx, 'x', {
        controller,
        packs: [TEST_PACK, EDGE_PACK],
        settings: { toolTimeoutMs: 15_000 },
      })
      await awaitHandlerEvent('start:stubborn')
      expect(vi.getTimerCount()).toBe(1)
      controller.abort()
      const run = await pending
      expect(vi.getTimerCount()).toBe(0)
      expect(kinds(run.sessionId)).toEqual(['user', 'assistant', 'tool_result'])
      expect(blocksOf(run.rows()[2]!.content, 'tool_result')[0]).toMatchObject({
        is_error: true,
        content: JSON.stringify(CANCELLED_BEFORE_RETURN),
      })
      expect(run.sink.doneEvent).toBeNull()
      // Nothing fires later: no timeout log, no second result.
      await vi.advanceTimersByTimeAsync(15_000)
      openGate('stubborn', { late: true })
      await vi.advanceTimersByTimeAsync(1)
      expect(logs.some((l) => l.line.includes('tool timeout'))).toBe(false)
      expect(run.sink.toolResults).toEqual([])
      expectBranchClosed(run.sessionId)
    } finally {
      vi.useRealTimers()
    }
  })

  it('E25 the per-tool timeout: a tool_timeout error result, the handler told to stop, no leaked timer, late result discarded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      reset()
      anthropic.script(callTools(toolUse('gate', { key: 'never' })), answer('ok'))
      const ctx = await authAs('member')
      const pending = runChat(ctx, 'x', { settings: { toolTimeoutMs: 15_000 } })
      await awaitHandlerEvent('start:never')
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      await vi.advanceTimersByTimeAsync(15_000)
      const run = await pending
      expect(handlerEvents).toContain('aborted:never')
      expect(run.sink.toolResults[0]).toMatchObject({
        isError: true,
        output: { error: expect.stringMatching(/tool_timeout/) },
      })
      expect(run.sink.doneEvent?.stopReason).toBe('end_turn')
      expect(vi.getTimerCount()).toBe(0)
      openGate('never', { late: true })
      await vi.advanceTimersByTimeAsync(1)
      expect(run.sink.toolResults).toHaveLength(1)
      expect(logs.some((l) => l.line.includes('tool timeout'))).toBe(true)
      expect(anthropic.unexpectedCalls).toBe(0)
      expect(anthropic.remaining).toBe(0)
      expectBranchClosed(run.sessionId)
    } finally {
      vi.useRealTimers()
    }
  })

  // E24: every exit path that can write leaves the branch closed. The cases replay the write
  // paths of E15–E23 with the smallest setup each.
  const cases: Array<[string, (controller: AbortController) => Promise<string>]> = [
    [
      'truncation mid tool_use',
      async () => {
        anthropic.script({ content: [toolUse('echo', { text: 'a' })], stop_reason: 'max_tokens' })
        return (await runChat(await authAs('member'), 'x')).sessionId
      },
    ],
    [
      'iteration cap',
      async () => {
        anthropic.script(callTools(toolUse('echo', { text: 'x' })), callTools(toolUse('echo', { text: 'x' })))
        return (await runChat(await authAs('member'), 'x', { settings: { maxIterations: 2 } })).sessionId
      },
    ],
    [
      'abort before dispatch',
      async (controller) => {
        anthropic.script(callTools(toolUse('gate', { key: 'g' })))
        db.onRequest((r) => {
          if (r.table === 'ai_messages' && (r.body as { turn_kind?: string })?.turn_kind === 'assistant')
            controller.abort()
        })
        return (await runChat(await authAs('member'), 'x', { controller })).sessionId
      },
    ],
    [
      'abort during dispatch',
      async (controller) => {
        anthropic.script(callTools(toolUse('gate', { key: 'g' })))
        const pending = runChat(await authAs('member'), 'x', { controller })
        await awaitHandlerEvent('start:g')
        controller.abort()
        return (await pending).sessionId
      },
    ],
    [
      'handler timeout then answer',
      async () => {
        anthropic.script(callTools(toolUse('gate', { key: 'g' })), answer('ok'))
        return (await runChat(await authAs('member'), 'x', { settings: { toolTimeoutMs: 5 } })).sessionId
      },
    ],
    [
      'handler throws',
      async () => {
        anthropic.script(callTools(toolUse('boom', {})), answer('ok'))
        return (await runChat(await authAs('member'), 'x')).sessionId
      },
    ],
  ]
  for (const [name, run] of cases) {
    scenario(`E24 invariant: after ${name} the branch does not end on a bare tool_use`, async () => {
      const sessionId = await run(new AbortController())
      expectBranchClosed(sessionId)
    })
  }
})
