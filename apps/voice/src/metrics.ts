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

/** What LiveKit reports on an assistant item (seconds), as the item exposes it. */
export interface AssistantItemLike {
  role?: string
  interrupted?: boolean
  textContent?: string | undefined
  metrics?: {
    e2eLatency?: number | undefined
    transcriptionDelay?: number | undefined
    endOfTurnDelay?: number | undefined
    llmNodeTtft?: number | undefined
    ttsNodeTtfb?: number | undefined
  }
}

const ms = (s: number | undefined): number | null => (s === undefined ? null : Math.round(s * 1000))

/** The `turns.jsonl` entry for an assistant item: the framework's own latencies and the text
 * length. Null when the item is not an assistant reply with metrics. */
export function turnEntry(
  item: AssistantItemLike,
  settings: Record<string, number | string>,
): Record<string, unknown> | null {
  if (item.role !== 'assistant' || !item.metrics) return null
  const m = item.metrics
  return {
    ...settings,
    e2e_ms: ms(m.e2eLatency),
    transcription_delay_ms: ms(m.transcriptionDelay),
    end_of_turn_delay_ms: ms(m.endOfTurnDelay),
    llm_ttft_ms: ms(m.llmNodeTtft),
    tts_ttfb_ms: ms(m.ttsNodeTtfb),
    interrupted: Boolean(item.interrupted),
    text_len: (item.textContent ?? '').length,
  }
}
