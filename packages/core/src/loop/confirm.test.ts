// E40–E45: the write protocol. A tool with `confirmation: 'required'` previews, the sink gets
// the id after the row, the model never sees it, and the handler runs once on a confirmed
// request with the same input.
import { describe, expect, it } from 'vitest'

import { answer, callTools, toolUse } from '../test/fake-anthropic.js'
import { anthropic, authAs, blocksOf, logs, runChat, scenario } from '../test/harness.js'
import { CONFIRM_PACK, confirmedWrite, executions, TEST_PACK } from '../test/tools.js'
import { defineTool } from '../tools/define.js'
import { ToolRegistry } from '../tools/registry.js'
import { CONFIRMATION_TTL_MS, inputHash, MemoryConfirmationStore, stableStringify } from './confirmations.js'

const PACKS = { packs: [CONFIRM_PACK], allowlist: { chat: 'all' } as const }
const INPUT = { text: 'Naručiti dva.' }

/** The whole world's text: every Anthropic request body and every log line. */
function everythingTheModelAndLogsSaw(): string {
  return [...anthropic.calls.map((c) => JSON.stringify(c.body)), ...logs.map((l) => l.line)].join('\n')
}

async function preview(store: MemoryConfirmationStore, sessionId?: string, parentId?: string | null) {
  anthropic.script(callTools(toolUse('confirmed_write', INPUT)), answer('Želite li da zapišem?'))
  const ctx = await authAs('member')
  return runChat(ctx, 'Zapiši: naručiti dva.', {
    ...PACKS,
    confirmations: store,
    ...(sessionId ? { sessionId, parentId: parentId ?? null } : {}),
  })
}

describe('the write protocol', () => {
  scenario(
    'E40 a confirmed tool previews: the row holds the summary and no id, the sink gets the id after the result, nothing is written',
    async () => {
      const store = new MemoryConfirmationStore()
      const run = await preview(store)
      const rows = run.rows()
      expect(rows.map((r) => r.turn_kind)).toEqual(['user', 'assistant', 'tool_result', 'assistant'])
      const result = blocksOf(rows[2]!.content, 'tool_result')[0]!
      const content = JSON.parse(result.content as string) as Record<string, unknown>
      expect(content).toMatchObject({ pending_confirmation: true, summary: 'Zapisat ću: "Naručiti dva."' })
      expect(content.instruction).toMatch(/Do not call this tool again/)
      expect(result.is_error).toBe(false)
      expect(run.sink.order.filter((o) => o !== 'textDelta')).toEqual([
        'toolStarting',
        'toolCall',
        'toolResult',
        'confirm',
        'textBlock',
        'done',
      ])
      const confirm = run.sink.confirms[0]!
      expect(confirm).toMatchObject({
        tool: 'confirmed_write',
        toolUseId: run.sink.toolCalls[0]!.id,
        summary: 'Zapisat ću: "Naručiti dva."',
      })
      expect(confirm.id).toMatch(/^cf-/)
      expect(Date.parse(confirm.expiresAt) - Date.now()).toBeLessThanOrEqual(CONFIRMATION_TTL_MS)
      expect(executions).toEqual([])
      expect(store.rows).toEqual([
        expect.objectContaining({
          id: confirm.id,
          sessionId: run.sessionId,
          tool: 'confirmed_write',
          inputHash: inputHash(INPUT),
          outcome: 'pending',
        }),
      ])
      // The id is the channel's: not in the row, not in any request to the model, not in a log line.
      expect(JSON.stringify(rows)).not.toContain(confirm.id)
      expect(everythingTheModelAndLogsSaw()).not.toContain(confirm.id)
      expect(run.sink.doneEvent?.stopReason).toBe('end_turn')
    },
  )

  scenario(
    'E40b the model calling again without the user’s answer gets another preview, never an execution',
    async () => {
      const store = new MemoryConfirmationStore()
      const first = await preview(store)
      const second = await preview(store, first.sessionId, first.rows().at(-1)!.id as string)
      expect(executions).toEqual([])
      expect(store.rows.map((r) => r.outcome)).toEqual(['pending', 'pending'])
      expect(second.sink.confirms).toHaveLength(1)
      expect(second.sink.confirms[0]!.id).not.toBe(first.sink.confirms[0]!.id)
    },
  )

  scenario(
    'E41 the channel’s confirmation runs the handler once; the store says executed; the id never reaches the model',
    async () => {
      const store = new MemoryConfirmationStore()
      const first = await preview(store)
      const id = first.sink.confirms[0]!.id
      anthropic.script(callTools(toolUse('confirmed_write', INPUT)), answer('Zapisano.'))
      const ctx = await authAs('member')
      const run = await runChat(ctx, 'Da.', {
        ...PACKS,
        confirmations: store,
        sessionId: first.sessionId,
        parentId: first.rows().at(-1)!.id as string,
        extras: { confirmation: { id } },
      })
      expect(executions).toEqual(['Naručiti dva.'])
      expect(run.sink.toolResults[0]).toMatchObject({
        tool: 'confirmed_write',
        isError: false,
        output: { written: 'Naručiti dva.' },
      })
      expect(run.sink.confirms).toEqual([])
      expect(store.rows[0]).toMatchObject({ id, outcome: 'executed' })
      expect(everythingTheModelAndLogsSaw()).not.toContain(id)
      expect(logs.some((l) => l.line.includes('confirmed write executed'))).toBe(true)
    },
  )

  scenario(
    'E42 a changed input, a used id or a foreign session do not execute: a fresh preview, with the reason logged',
    async () => {
      const store = new MemoryConfirmationStore()
      const first = await preview(store)
      const id = first.sink.confirms[0]!.id
      const ctx = await authAs('member')
      // The model changed the text after the user confirmed: the hash does not match.
      anthropic.script(callTools(toolUse('confirmed_write', { text: 'Naručiti tri.' })), answer('Želite li?'))
      const changed = await runChat(ctx, 'Da.', {
        ...PACKS,
        confirmations: store,
        sessionId: first.sessionId,
        parentId: first.rows().at(-1)!.id as string,
        extras: { confirmation: { id } },
      })
      expect(executions).toEqual([])
      expect(changed.sink.confirms).toHaveLength(1)
      expect(store.rows.map((r) => r.outcome)).toEqual(['pending', 'pending'])
      expect(logs.find((l) => l.line.includes('confirmation not consumed'))?.line).toContain(
        '"reason":"mismatch"',
      )

      // The right input, confirmed: executes. The same id again: used.
      anthropic.script(callTools(toolUse('confirmed_write', INPUT)), answer('Zapisano.'))
      await runChat(ctx, 'Da.', {
        ...PACKS,
        confirmations: store,
        sessionId: first.sessionId,
        parentId: changed.rows().at(-1)!.id as string,
        extras: { confirmation: { id } },
      })
      expect(executions).toEqual(['Naručiti dva.'])
      anthropic.script(callTools(toolUse('confirmed_write', INPUT)), answer('Želite li?'))
      const again = await runChat(ctx, 'Da.', {
        ...PACKS,
        confirmations: store,
        sessionId: first.sessionId,
        extras: { confirmation: { id } },
      })
      expect(executions).toEqual(['Naručiti dva.'])
      expect(again.sink.confirms).toHaveLength(1)
      expect(logs.filter((l) => l.line.includes('confirmation not consumed')).at(-1)?.line).toContain(
        '"reason":"used"',
      )

      // Another user's session cannot consume it.
      const admin = await authAs('admin')
      anthropic.script(callTools(toolUse('confirmed_write', INPUT)), answer('Želite li?'))
      const foreign = await runChat(admin, 'Da.', {
        ...PACKS,
        confirmations: store,
        extras: { confirmation: { id } },
      })
      expect(executions).toEqual(['Naručiti dva.'])
      expect(foreign.sink.confirms).toHaveLength(1)
      expect(logs.filter((l) => l.line.includes('confirmation not consumed')).at(-1)?.line).toContain(
        '"reason":"not_found"',
      )
    },
  )

  scenario(
    'E43 a handler that throws or returns an error envelope after the confirmation settles failed; the result is the usual error',
    async () => {
      const store = new MemoryConfirmationStore()
      const ctx = await authAs('member')
      for (const [text, code, isError] of [
        ['boom', 'Error: kaboom', true],
        ['envelope', 'error_envelope', true],
      ] as const) {
        anthropic.script(callTools(toolUse('confirmed_write', { text })), answer('Želite li?'))
        const first = await runChat(ctx, 'Zapiši.', { ...PACKS, confirmations: store })
        const id = first.sink.confirms[0]!.id
        anthropic.script(callTools(toolUse('confirmed_write', { text })), answer('Nije uspjelo.'))
        const run = await runChat(ctx, 'Da.', {
          ...PACKS,
          confirmations: store,
          sessionId: first.sessionId,
          parentId: first.rows().at(-1)!.id as string,
          extras: { confirmation: { id } },
        })
        expect(run.sink.toolResults[0]!.isError).toBe(isError)
        expect(store.rows.find((r) => r.id === id)).toMatchObject({ outcome: 'failed', errorCode: code })
      }
      expect(executions).toEqual([])
    },
  )

  scenario(
    'E44 an expired confirmation previews again and is marked expired; a failed preview is an error result and issues nothing',
    async () => {
      const clock = { ms: Date.now() }
      const store = new MemoryConfirmationStore(() => clock.ms)
      const first = await preview(store)
      const id = first.sink.confirms[0]!.id
      clock.ms = Date.now() + CONFIRMATION_TTL_MS + 1000
      anthropic.script(callTools(toolUse('confirmed_write', INPUT)), answer('Želite li?'))
      const ctx = await authAs('member')
      const late = await runChat(ctx, 'Da.', {
        ...PACKS,
        confirmations: store,
        sessionId: first.sessionId,
        parentId: first.rows().at(-1)!.id as string,
        extras: { confirmation: { id } },
      })
      expect(executions).toEqual([])
      expect(store.rows[0]!.outcome).toBe('expired')
      expect(late.sink.confirms).toHaveLength(1)

      anthropic.script(callTools(toolUse('confirmed_write', { text: 'preview-boom' })), answer('Ne mogu.'))
      const broken = await runChat(ctx, 'Zapiši.', { ...PACKS, confirmations: store })
      expect(broken.sink.toolResults[0]).toMatchObject({
        isError: true,
        output: { error: expect.stringMatching(/preview failed/) },
      })
      expect(broken.sink.confirms).toEqual([])
      expect(store.rows).toHaveLength(2)
    },
  )

  it('E45: a confirmed write may be named for a spoken channel, a plain write may not; defineTool guards the pair', () => {
    expect(
      () => new ToolRegistry([CONFIRM_PACK], { voice: ['confirmed_write'], phone: ['confirmed_write'] }),
    ).not.toThrow()
    expect(() => new ToolRegistry([TEST_PACK], { voice: ['write_note'] })).toThrow(
      /writes without confirmation: write_note/,
    )
    expect(() => defineTool({ ...confirmedWrite, readOnly: true })).toThrow(
      /read-only tool needs no confirmation/,
    )
    const { preview: _preview, ...withoutPreview } = confirmedWrite
    expect(() => defineTool(withoutPreview)).toThrow(/needs a preview/)
    expect(stableStringify({ b: [{ z: 1, a: 2 }], a: null })).toBe('{"a":null,"b":[{"a":2,"z":1}]}')
    expect(inputHash({ a: 1, b: 2 })).toBe(inputHash({ b: 2, a: 1 }))
  })
})
