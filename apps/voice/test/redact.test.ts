// W18: no `lk.pii.*` key leaves the process; W19: the session's turn handling as data.
import { Writable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { PII_PREFIX, redactChunk, redactLine } from '../src/redact.js'
import { startOptions, turnHandlingOptions, vadFor } from '../src/session-options.js'

describe('log redaction', () => {
  it('W18 a pino line loses every lk.pii.* key and counts them; other lines pass as they are', () => {
    const line = JSON.stringify({
      level: 30,
      time: 1,
      msg: 'playout completed',
      speech_id: 'sp_1',
      'lk.pii.message': 'Imamo dva stola.',
      'lk.pii.user_input': 'Koji stolovi postoje?',
    })
    const out = JSON.parse(redactLine(line)) as Record<string, unknown>
    expect(out).toEqual({ level: 30, time: 1, msg: 'playout completed', speech_id: 'sp_1', redacted: 2 })
    expect(redactLine(line)).not.toContain('stol')
    expect(Object.keys(out).some((k) => k.startsWith(PII_PREFIX))).toBe(false)

    const plain = JSON.stringify({ tag: '[voice]', event: 'timing', total_ms: 12 })
    expect(redactLine(plain)).toBe(plain)
    expect(redactLine('not json lk.pii.message')).toBe('not json lk.pii.message')
    expect(redactLine('{"broken": lk.pii.message')).toBe('{"broken": lk.pii.message')
    expect(redactChunk(`${plain}\n${line}\n`)).toBe(`${plain}\n${redactLine(line)}\n`)
  })

  it('W18b the installed stream wrapper rewrites what pino would write', async () => {
    const { installStdoutRedaction } = await import('../src/redact.js')
    const written: string[] = []
    const sink = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        written.push(chunk.toString())
        cb()
      },
    })
    installStdoutRedaction(sink)
    sink.write(`${JSON.stringify({ msg: 'x', 'lk.pii.transcript': 'tajna' })}\n`)
    sink.write(Buffer.from(`${JSON.stringify({ msg: 'y', 'lk.pii.new_transcript': 'tajna' })}\n`))
    sink.write('plain text\n')
    await new Promise((r) => setTimeout(r, 5))
    expect(written.join('')).not.toContain('tajna')
    expect(written).toEqual([
      `${JSON.stringify({ msg: 'x', redacted: 1 })}\n`,
      `${JSON.stringify({ msg: 'y', redacted: 1 })}\n`,
      'plain text\n',
    ])
  })
})

describe('session options', () => {
  const env = {
    INTERRUPT_ON: 'vad' as const,
    INTERRUPT_MIN_MS: 50,
    TURN_MIN_DELAY_MS: 100,
    OUTPUT_QUEUE_MS: 50,
  }

  it('W19 Soniox end of turn, VAD interruption, no preemptive generation, no recording', () => {
    expect(turnHandlingOptions(env)).toEqual({
      turnDetection: 'stt',
      endpointing: { minDelay: 100 },
      interruption: { enabled: true, mode: 'vad', minDuration: 50 },
      preemptiveGeneration: { enabled: false },
    })
    expect(turnHandlingOptions({ ...env, TURN_MIN_DELAY_MS: 250, INTERRUPT_MIN_MS: 80 })).toMatchObject({
      endpointing: { minDelay: 250 },
      interruption: { minDuration: 80 },
    })
    expect(startOptions(env)).toEqual({ outputOptions: { queueSizeMs: 50 }, record: false })
    const vad = { label: 'silero' } as unknown as Parameters<typeof vadFor>[1]
    expect(vadFor(env, vad)).toBe(vad)
    expect(vadFor({ INTERRUPT_ON: 'both' }, vad)).toBe(vad)
    expect(vadFor({ INTERRUPT_ON: 'stt' }, vad)).toBeNull()
  })
})
