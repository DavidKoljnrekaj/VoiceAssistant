import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { errorReason, log, REASON_MAX_CHARS } from './log.js'

describe('log', () => {
  const lines: { level: string; line: string }[] = []
  beforeEach(() => {
    lines.length = 0
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push({ level: 'info', line }))
    vi.spyOn(console, 'warn').mockImplementation((line: string) => void lines.push({ level: 'warn', line }))
    vi.spyOn(console, 'error').mockImplementation((line: string) => void lines.push({ level: 'error', line }))
  })
  afterEach(() => vi.restoreAllMocks())

  it('L01: one JSON object per line with ts, tag, event and the fields, on the stream of its level', () => {
    log('info', '[api]', 'timing', { request_id: 'r1', total_ms: 12 })
    log('warn', '[voice]', 'turn limit reached', { turns: 51 })
    log('error', '[core]', 'tool timeout')
    expect(lines.map((l) => l.level)).toEqual(['info', 'warn', 'error'])
    const parsed = lines.map((l) => JSON.parse(l.line) as Record<string, unknown>)
    expect(parsed[0]).toMatchObject({ tag: '[api]', event: 'timing', request_id: 'r1', total_ms: 12 })
    expect(parsed[2]).toEqual({ ts: expect.any(String), tag: '[core]', event: 'tool timeout' })
    for (const p of parsed) expect(Number.isNaN(Date.parse(p.ts as string))).toBe(false)
    expect(Object.keys(parsed[0]!)).toEqual(['ts', 'tag', 'event', 'request_id', 'total_ms'])
  })

  it('L02: errorReason carries the class and a message cut to 200 characters', () => {
    class PostgrestError extends Error {}
    const long = new PostgrestError(`x${'y'.repeat(500)}`)
    const reason = errorReason(long)
    expect(reason.startsWith('PostgrestError: xyyy')).toBe(true)
    expect(reason.endsWith('…')).toBe(true)
    expect(reason.length).toBe('PostgrestError: '.length + REASON_MAX_CHARS + 1)
    expect(errorReason(new Error('short\n  message'))).toBe('Error: short message')
    expect(errorReason(new TypeError(''))).toBe('TypeError')
  })

  it('L03: a thrown non-Error is stringified and cut the same way', () => {
    expect(errorReason('tool_timeout')).toBe('tool_timeout')
    expect(errorReason({ code: 42 })).toBe('[object Object]')
    expect(errorReason('z'.repeat(300)).length).toBe(REASON_MAX_CHARS + 1)
  })
})
