// The three JSONL logs Landmark's prototype wrote, minus any transcript text: timings, flags,
// lengths and counts only. The writer refuses an entry that carries content (invariant 9).
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { errorReason, log } from '@va/core'

import { LOG_TAG } from './config.js'

export type MetricsFile =
  'turns.jsonl' | 'bargein.jsonl' | 'warm.jsonl' | 'llm-bench.jsonl' | 'calltest.jsonl'

/** Keys that would carry what someone said. */
const CONTENT_KEYS = new Set([
  'text',
  'transcript',
  'content',
  'message',
  'heard',
  'said',
  'question',
  'answer',
])

export function assertNoContent(entry: Record<string, unknown>): void {
  for (const key of Object.keys(entry)) {
    if (CONTENT_KEYS.has(key)) throw new Error(`metrics entry must not carry content: ${key}`)
  }
}

export interface MetricsWriter {
  readonly dir: string
  /** Appends one line; a failed write is logged, never thrown (metrics are off the hot path). */
  write(file: MetricsFile, entry: Record<string, unknown>): Promise<void>
}

export function createMetrics(dir: string): MetricsWriter {
  let ready: Promise<void> | null = null
  return {
    dir,
    async write(file, entry) {
      assertNoContent(entry)
      try {
        ready ??= mkdir(dir, { recursive: true }).then(() => {})
        await ready
        await appendFile(join(dir, file), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
      } catch (err) {
        log('error', LOG_TAG, 'metrics write failed', {
          file,
          reason: errorReason(err),
        })
      }
    },
  }
}

/**
 * What `@livekit/agents` 1.9.2 sets on a chat item (seconds), as `voice/agent_activity.js`
 * creates them. The **user** message carries the Soniox figures (`transcriptionDelay`,
 * `endOfTurnDelay`, when the user started and stopped speaking); the assistant reply carries the
 * model's and the synthesiser's (`llmNodeTtft`, `ttsNodeTtfb`, `e2eLatency`, playback); a
 * `say()` item (the greeting) only the synthesiser's. Both reach `ConversationItemAdded`, the
 * user item first. The class defaults `metrics` to `{}`.
 */
export interface ChatItemLike {
  role?: string
  interrupted?: boolean
  textContent?: string | undefined
  metrics?: {
    startedSpeakingAt?: number | undefined
    stoppedSpeakingAt?: number | undefined
    transcriptionDelay?: number | undefined
    endOfTurnDelay?: number | undefined
    onUserTurnCompletedDelay?: number | undefined
    llmNodeTtft?: number | undefined
    ttsNodeTtfb?: number | undefined
    e2eLatency?: number | undefined
    playbackLatency?: number | undefined
  }
}

const ms = (s: number | undefined): number | null => (s === undefined ? null : Math.round(s * 1000))

export interface TurnMetrics {
  /** Feeds one added item; returns the `turns.jsonl` entry once a reply completes a turn, else
   * null. */
  add(item: ChatItemLike): Record<string, unknown> | null
}

/**
 * Joins each user item's Soniox delays with the reply that follows it into one `turns.jsonl`
 * entry: the framework's own latencies and the text length. The greeting and any other `say()`
 * item (no model figure, no e2e) is not a turn. A user item is used once; a reply with no user
 * item before it (nothing was transcribed) carries null delays.
 */
export function createTurnMetrics(settings: Record<string, number | string>): TurnMetrics {
  let user: ChatItemLike['metrics'] | null = null
  return {
    add(item) {
      const m = item.metrics ?? {}
      if (item.role === 'user') {
        user = m
        return null
      }
      if (item.role !== 'assistant' || (m.llmNodeTtft === undefined && m.e2eLatency === undefined)) {
        return null
      }
      const u = user
      user = null
      return {
        ...settings,
        e2e_ms: ms(m.e2eLatency),
        transcription_delay_ms: ms(u?.transcriptionDelay),
        end_of_turn_delay_ms: ms(u?.endOfTurnDelay),
        llm_ttft_ms: ms(m.llmNodeTtft),
        tts_ttfb_ms: ms(m.ttsNodeTtfb),
        interrupted: Boolean(item.interrupted),
        text_len: (item.textContent ?? '').length,
      }
    },
  }
}
