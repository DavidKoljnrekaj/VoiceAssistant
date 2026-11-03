// W35–W39: the write protocol on a call. The model previews, the worker keeps the pending id,
// and the caller's "da" or "ne" is decided in code before the model sees the turn.
import { describe, expect, it } from 'vitest'

import { answer, callTools, CONFIRM_PACK, executions, toolUse } from '@va/core/test'

import { classifyAnswer, normalizeAnswer } from '../src/answers.js'
import { anthropic, ask, logs, NOW, openCall, scenario } from './harness.js'

const PACK = { packs: [CONFIRM_PACK], allowlist: { voice: ['echo', 'confirmed_write'] } as const }
const WRITE = { text: 'Naručiti dva.' }

async function previewed(call: Awaited<ReturnType<typeof openCall>>) {
  anthropic.script(callTools(toolUse('confirmed_write', WRITE)), answer('Želite li da zapišem naručiti dva?'))
  const out = await (await ask(call, 'Zapiši: naručiti dva.')).done
  expect(out.text).toContain('Želite li da zapišem')
  expect(executions).toEqual([])
  expect(call.session.confirmations.rows).toHaveLength(1)
  expect(call.session.confirmations.rows[0]!.outcome).toBe('pending')
}

describe('the caller’s answer', () => {
  it('W35: a closed set of yeses and nos, whole after normalisation; anything else is a plain turn', () => {
    expect(normalizeAnswer('  Da, može! ')).toBe('da moze')
    for (const yes of [
      'Da.',
      'da',
      'Može.',
      'Da, može.',
      'U redu.',
      'Potvrđujem.',
      'Pošalji.',
      'OK',
      'Naravno.',
      'Tako je.',
    ])
      expect(classifyAnswer(yes), yes).toBe('yes')
    for (const no of ['Ne.', 'ne', 'Nemoj.', 'Odustani.', 'Ne, hvala.', 'Ne šalji.', 'Stop.', 'Prekini.'])
      expect(classifyAnswer(no), no).toBe('no')
    for (const other of [
      'Da, ali promijeni tekst.',
      'Koliko košta stol?',
      'Da pošalji Marku',
      '',
      'Možda.',
      'Ne znam.',
    ])
      expect(classifyAnswer(other), other).toBe('other')
  })

  scenario(
    'W36 "da" carries the pending id into the next turn: the write runs once, the store says executed',
    async () => {
      const call = await openCall(PACK)
      await previewed(call)
      const id = call.session.confirmations.rows[0]!.id
      anthropic.script(callTools(toolUse('confirmed_write', WRITE)), answer('Zapisano.'))
      const out = await (await ask(call, 'Da.')).done
      expect(out.text).toContain('Zapisano')
      expect(executions).toEqual(['Naručiti dva.'])
      expect(call.session.confirmations.rows[0]).toMatchObject({ id, outcome: 'executed' })
      expect(logs.find((l) => l.line.includes('confirmation answered'))?.line).toContain('"answer":"yes"')
      // The id never reached the model.
      expect(anthropic.calls.every((c) => !JSON.stringify(c.body).includes(id))).toBe(true)
      // Answered: a second "da" is a plain turn.
      anthropic.script(answer('Već je zapisano.'))
      await (
        await ask(call, 'Da.')
      ).done
      expect(executions).toEqual(['Naručiti dva.'])
    },
  )

  scenario('W37 "ne" settles the write as declined and the turn is a plain one', async () => {
    const call = await openCall(PACK)
    await previewed(call)
    anthropic.script(answer('U redu, neću.'))
    const out = await (await ask(call, 'Ne, hvala.')).done
    expect(out.text).toContain('neću')
    expect(executions).toEqual([])
    expect(call.session.confirmations.rows[0]!.outcome).toBe('declined')
    expect(logs.find((l) => l.line.includes('confirmation answered'))?.line).toContain('"answer":"no"')
    // Declined: the model calling again without a new yes previews again.
    anthropic.script(callTools(toolUse('confirmed_write', WRITE)), answer('Želite li?'))
    await (
      await ask(call, 'Ipak zapiši.')
    ).done
    expect(executions).toEqual([])
    expect(call.session.confirmations.rows.map((r) => r.outcome)).toEqual(['declined', 'pending'])
  })

  scenario(
    'W38 anything else is a plain turn and the write keeps waiting; "da" afterwards still runs it',
    async () => {
      const call = await openCall(PACK)
      await previewed(call)
      anthropic.script(answer('Stol košta tristo dvadeset eura.'))
      await (
        await ask(call, 'Koliko košta stol?')
      ).done
      expect(executions).toEqual([])
      expect(call.session.confirmations.rows[0]!.outcome).toBe('pending')
      expect(logs.some((l) => l.line.includes('confirmation answered'))).toBe(false)
      anthropic.script(callTools(toolUse('confirmed_write', WRITE)), answer('Zapisano.'))
      await (
        await ask(call, 'Može.')
      ).done
      expect(executions).toEqual(['Naručiti dva.'])
    },
  )

  scenario('W39 an expired pending write is forgotten: "da" is a plain turn and nothing runs', async () => {
    const call = await openCall(PACK)
    await previewed(call)
    call.clock.ms = NOW + 6 * 60_000
    anthropic.script(answer('Molim, recite ponovno što da zapišem.'))
    await (
      await ask(call, 'Da.')
    ).done
    expect(executions).toEqual([])
    expect(logs.some((l) => l.line.includes('confirmation expired'))).toBe(true)
    expect(call.session.confirmations.rows[0]!.outcome).toBe('pending')
  })
})
