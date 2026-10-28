// S: the spoken-text sink. Landmark's sink.test.ts cases (S01–S07) plus the plan's additions
// (S08–S10) and the end-of-stream contract (S11–S12). Assertions are on what `say` received.
import { describe, expect, it } from 'vitest'

import { MESSAGES_HR } from '../errors.js'
import { speakable } from './speakable.js'
import { SpokenTextSink, type SpokenEnd } from './spoken.js'

const USAGE = { input_tokens: 0, output_tokens: 0 }

function harness() {
  const said: string[] = []
  const ends: SpokenEnd[] = []
  const sink = new SpokenTextSink(
    async (text) => {
      said.push(text)
    },
    async (reason) => {
      ends.push(reason)
    },
    () => 'Samo trenutak.',
  )
  return { sink, said, ends, text: () => said.join('') }
}

describe('speakable', () => {
  it('S01: TIC, OIB and IBAN as declined words; R1 and PDV stay; markup and EUR go', () => {
    expect(speakable('Prema TIC-u, bez TIC-a, TIC je spremljen.')).toBe(
      'Prema ticu, bez tica, tic je spremljen.',
    )
    expect(speakable('OIB-a nema, IBAN-a ni IBAN.')).toBe('oiba nema, ibana ni iban.')
    expect(speakable('R1 račun i PDV ostaju.')).toBe('R1 račun i PDV ostaju.')
    expect(speakable('**Ukupno** 100 EUR')).toBe('Ukupno 100 eura')
    expect(speakable('Iznos je 20 €, __važno__ `kod`')).toBe('Iznos je 20 eura, važno kod')
    expect(speakable('# Naslov\n- prva\n* druga')).toBe('Naslov\nprva\ndruga')
  })

  it('S08: a markdown link is reduced to its text, an image to its alt text', () => {
    expect(speakable('Vidi [upute](https://example.com/a?b=c) i dalje.')).toBe('Vidi upute i dalje.')
    expect(speakable('Slika ![graf](https://example.com/g.png) ovdje.')).toBe('Slika graf ovdje.')
    expect(speakable('[**Bold link**](http://x)')).toBe('Bold link')
  })

  it('S09: three or more newlines collapse to two, two stay', () => {
    expect(speakable('Prva.\n\n\nDruga.')).toBe('Prva.\n\nDruga.')
    expect(speakable('Prva.\n\n\n\n\nDruga.')).toBe('Prva.\n\nDruga.')
    expect(speakable('Prva.\n\nDruga.')).toBe('Prva.\n\nDruga.')
  })
})

describe('SpokenTextSink', () => {
  it('S02: an abbreviation split across deltas is still rewritten: text is released a word at a time', async () => {
    const h = harness()
    await h.sink.textDelta('Prema TI')
    await h.sink.textDelta('C-u je sve u redu. Dalje')
    await h.sink.textDelta(' ništa.')
    await h.sink.done('end_turn', USAGE)
    expect(h.text()).toBe('Prema ticu je sve u redu. Dalje ništa.')
    for (const chunk of h.said) expect(chunk).not.toMatch(/TIC/)
  })

  it('S03: the filler is spoken once per request, and streamed text is not repeated by textBlock', async () => {
    const h = harness()
    await h.sink.toolStarting()
    await h.sink.toolStarting()
    await h.sink.textDelta('Gotovo je.')
    await h.sink.textBlock('Gotovo je.', 'row-1')
    await h.sink.done('end_turn', USAGE)
    expect(h.text()).toBe('Samo trenutak.\n\nGotovo je.')
  })

  it("S04: a textBlock that was never streamed (the loop's own message) is spoken", async () => {
    const h = harness()
    await h.sink.textBlock(MESSAGES_HR.tool_limit_reached, 'row-2')
    await h.sink.done('tool_limit_reached', USAGE)
    expect(h.text()).toBe(MESSAGES_HR.tool_limit_reached)
  })

  it('S05: a sentence announcing a lookup is dropped when a tool call follows it', async () => {
    const h = harness()
    await h.sink.textDelta('Trebam prvo pronaći ')
    await h.sink.textDelta('projekt, dajte mi trenutak.')
    await h.sink.toolStarting()
    await h.sink.toolCall('search_items', { query: 'x' }, 'tu_1')
    await h.sink.toolResult('search_items', { items: [] }, 'tu_1', false)
    await h.sink.textDelta('Projekt nije pronađen.')
    await h.sink.done('end_turn', USAGE)
    expect(h.text()).toBe('Samo trenutak.\n\nProjekt nije pronađen.')
  })

  it('S06: an announcement without a full stop is dropped too', async () => {
    const h = harness()
    await h.sink.textDelta('Provjerit ću')
    await h.sink.toolStarting()
    await h.sink.done('end_turn', USAGE)
    expect(h.text()).toBe('Samo trenutak.\n\n')
  })

  it('S07: the first sentence is released as soon as the next one begins; a one-sentence answer is spoken at the end', async () => {
    const h = harness()
    await h.sink.textDelta('Projekt Tar je unutar proračuna.')
    expect(h.said).toHaveLength(0) // held: a tool call could still follow
    await h.sink.textDelta(' Planirani')
    expect(h.text()).toBe('Projekt Tar je unutar proračuna. ')
    await h.sink.textDelta(' budžet je postavljen.')
    await h.sink.done('end_turn', USAGE)
    expect(h.text()).toBe('Projekt Tar je unutar proračuna. Planirani budžet je postavljen.')

    const one = harness()
    await one.sink.textDelta('Bok!')
    expect(one.said).toHaveLength(0)
    await one.sink.done('end_turn', USAGE)
    expect(one.text()).toBe('Bok!')
  })

  it('S10: error after partial speech appends the message with a space, then ends with error', async () => {
    const h = harness()
    await h.sink.textDelta('Prema TIC-u je sve u redu. Još')
    await h.sink.error('model_timeout', MESSAGES_HR.model_timeout)
    expect(h.text()).toBe(`Prema ticu je sve u redu. Još ${MESSAGES_HR.model_timeout}`)
    expect(h.ends).toEqual(['error'])

    const silent = harness()
    await silent.sink.error('model_unreachable', MESSAGES_HR.model_unreachable)
    expect(silent.text()).toBe(MESSAGES_HR.model_unreachable)
    expect(silent.ends).toEqual(['error'])
  })

  it('S11: a refusal with nothing spoken says the refusal line; after speech it adds nothing', async () => {
    const h = harness()
    await h.sink.done('refusal', USAGE)
    expect(h.text()).toBe(MESSAGES_HR.model_refused)
    expect(h.ends).toEqual(['done'])

    const spoke = harness()
    await spoke.sink.textDelta('Evo odgovora. Drugi dio.')
    await spoke.sink.done('refusal', USAGE)
    expect(spoke.text()).toBe('Evo odgovora. Drugi dio.')
  })

  it('S12: every chunk is speakable, the filler and a late textBlock are joined with a space, and end is called once', async () => {
    const h = harness()
    await h.sink.textDelta('Iznos je **sto** EUR. Dalje.')
    await h.sink.toolStarting()
    await h.sink.textBlock('Dostignut je limit.', 'row-3')
    await h.sink.done('end_turn', USAGE)
    expect(h.text()).toBe('Iznos je sto eura. Dalje. Samo trenutak.\n\nDostignut je limit.')
    expect(h.sink.spoken).toBe(h.text())
    expect(h.sink.firstOutputAt).not.toBeNull()
    expect(h.ends).toEqual(['done'])
  })
})
