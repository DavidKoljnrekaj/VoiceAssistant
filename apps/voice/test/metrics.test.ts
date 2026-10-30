// W13: the metrics lines carry timings, flags and lengths, never text. W15: the hints file.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { llm } from '@livekit/agents'
import { describe, expect, it } from 'vitest'

import { GREETING_HR } from '../src/greeting.js'
import { assertNoContent, createMetrics, createTurnMetrics } from '../src/metrics.js'
import { loadHints, parseHints } from '../src/providers/hints.js'

// The items as `@livekit/agents` 1.9.2 creates them (`voice/agent_activity.js`): the user
// message gets `metrics` with the Soniox figures when the turn is committed, the assistant
// reply gets its own set at the end of the reply, and the greeting (`session.say`) a third,
// smaller one. The seconds are what the activity divides its milliseconds into.
const userItem = (overrides: Partial<Record<string, number>> = {}) =>
  llm.ChatMessage.create({
    role: 'user',
    content: 'Koji stolovi postoje?',
    metrics: {
      startedSpeakingAt: 1761730000.1,
      stoppedSpeakingAt: 1761730001.4,
      transcriptionDelay: 0.2,
      endOfTurnDelay: 0.35,
      onUserTurnCompletedDelay: 0.001,
      ...overrides,
    },
  })
const replyItem = (interrupted: boolean) =>
  llm.ChatMessage.create({
    role: 'assistant',
    content: 'Samo trenutak. Imamo dva stola.',
    interrupted,
    metrics: {
      llmNodeTtft: 0.9,
      ttsNodeTtfb: 0.13,
      startedSpeakingAt: 1761730002.634,
      stoppedSpeakingAt: 1761730005.0,
      playbackLatency: 0.02,
      e2eLatency: 1.234,
    },
  })
const greetingItem = () =>
  llm.ChatMessage.create({
    role: 'assistant',
    content: GREETING_HR,
    metrics: { ttsNodeTtfb: 0.13, startedSpeakingAt: 1761729990.0, stoppedSpeakingAt: 1761729991.0 },
  })

describe('metrics', () => {
  it('VOICE-6 a turns.jsonl line joins the user item (Soniox delays) and the reply (model, TTS, e2e)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'va-voice-metrics-'))
    try {
      const metrics = createMetrics(dir)
      const turns = createTurnMetrics({ endpoint_delay_ms: 500 })
      // The activity adds the user item first (no line yet), then the reply.
      expect(turns.add(userItem())).toBeNull()
      const entry = turns.add(replyItem(true))
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
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('VOICE-6b the greeting is not a turn; a reply without a user item still has its own figures; the delays are not reused', () => {
    const turns = createTurnMetrics({})
    expect(turns.add(greetingItem())).toBeNull()
    // A `say()` reply has no model figure and no e2e; it is not a turn.
    expect(turns.add(llm.ChatMessage.create({ role: 'assistant', content: 'x' }))).toBeNull()
    expect(turns.add(replyItem(false))).toMatchObject({
      e2e_ms: 1234,
      transcription_delay_ms: null,
      end_of_turn_delay_ms: null,
      llm_ttft_ms: 900,
      interrupted: false,
    })
    // Soniox did not report a delay for this turn: the item has no such key.
    turns.add(userItem({ transcriptionDelay: undefined, endOfTurnDelay: undefined }))
    expect(turns.add(replyItem(false))).toMatchObject({ transcription_delay_ms: null, end_of_turn_delay_ms: null })
    // The next turn's user item replaces the last one; a second reply does not reuse the delays.
    turns.add(userItem({ transcriptionDelay: 0.5 }))
    turns.add(userItem({ transcriptionDelay: 0.25 }))
    expect(turns.add(replyItem(false))).toMatchObject({ transcription_delay_ms: 250 })
    expect(turns.add(replyItem(false))).toMatchObject({ transcription_delay_ms: null })
  })

  it('W13 the writer refuses an entry that carries content', async () => {
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
