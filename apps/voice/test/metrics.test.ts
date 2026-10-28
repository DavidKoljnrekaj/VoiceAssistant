// W13: the metrics lines carry timings, flags and lengths, never text. W15: the hints file.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { assertNoContent, createMetrics, turnEntry } from '../src/metrics.js'
import { loadHints, parseHints } from '../src/providers/hints.js'

describe('metrics', () => {
  it('W13 a turns.jsonl line has the latencies and the text length and no text field', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'va-voice-metrics-'))
    try {
      const metrics = createMetrics(dir)
      const entry = turnEntry(
        {
          role: 'assistant',
          interrupted: true,
          textContent: 'Samo trenutak. Imamo dva stola.',
          metrics: {
            e2eLatency: 1.234,
            transcriptionDelay: 0.2,
            endOfTurnDelay: 0.35,
            llmNodeTtft: 0.9,
            ttsNodeTtfb: 0.13,
          },
        },
        { endpoint_delay_ms: 500 },
      )
      expect(entry).toEqual({
        endpoint_delay_ms: 500,
        e2e_ms: 1234,
        transcription_delay_ms: 200,
        end_of_turn_delay_ms: 350,
        llm_ttft_ms: 900,
        tts_ttfb_ms: 130,
        interrupted: true,
        text_len: 31,
      })
      await metrics.write('turns.jsonl', { room: 'voice-x', ...entry! })
      await metrics.write('turns.jsonl', { room: 'voice-x', e2e_ms: null })
      const lines = (await readFile(join(dir, 'turns.jsonl'), 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(2)
      for (const line of lines) {
        const parsed = JSON.parse(line) as Record<string, unknown>
        expect(parsed).not.toHaveProperty('text')
        expect(parsed).not.toHaveProperty('transcript')
        expect(parsed.at).toEqual(expect.any(String))
        expect(line).not.toContain('stola')
      }
      expect(turnEntry({ role: 'user', textContent: 'x' }, {})).toBeNull()
      expect(turnEntry({ role: 'assistant' }, {})).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('W13b the writer refuses an entry that carries content', async () => {
    expect(() => assertNoContent({ text: 'x' })).toThrow('text')
    expect(() => assertNoContent({ transcript: 'x' })).toThrow('transcript')
    expect(() => assertNoContent({ heard: 'x' })).toThrow('heard')
    expect(() => assertNoContent({ text_len: 3, e2e_ms: 1 })).not.toThrow()
    const metrics = createMetrics(join(tmpdir(), 'never-created'))
    await expect(metrics.write('bargein.jsonl', { said: 'x' })).rejects.toThrow('said')
  })

  it('W15 hints are one term per line, comments stripped, duplicates dropped', () => {
    expect(parseHints('# komentar\nOIB\n\nradni stol  # stol\nOIB\n')).toEqual(['OIB', 'radni stol'])
    const committed = loadHints()
    expect(committed.length).toBeGreaterThan(5)
    expect(committed).toContain('OIB')
    expect(new Set(committed).size).toBe(committed.length)
  })
})
