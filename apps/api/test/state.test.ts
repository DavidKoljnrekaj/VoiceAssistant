// B17–B19: the OAuth state store: single take, ten minutes, bounded per user and overall.
import { describe, expect, it } from 'vitest'

import { memoryStateStore, STATE_TTL_MS } from '../src/integrations/state.js'

describe('OAuth state store', () => {
  it('B17 a state is taken once, within ten minutes; it is 43 url-safe characters', () => {
    let now = 0
    const store = memoryStateStore(() => new Date(now))
    const state = store.issue('u1', 'verifier-1')
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(store.take(state)).toEqual({ userId: 'u1', verifier: 'verifier-1' })
    expect(store.take(state)).toBeNull()
    const late = store.issue('u1', 'verifier-2')
    now += STATE_TTL_MS
    expect(store.take(late)).toBeNull()
    expect(store.take('never-issued')).toBeNull()
  })

  it('B18 a user holds at most five pending states; the oldest goes first, others are untouched', () => {
    const store = memoryStateStore(() => new Date(0))
    const other = store.issue('u2', 'v-other')
    const mine = Array.from({ length: 6 }, (_, i) => store.issue('u1', `v${i}`))
    expect(store.take(mine[0]!)).toBeNull()
    expect(mine.slice(1).map((s) => store.take(s)?.verifier)).toEqual(['v1', 'v2', 'v3', 'v4', 'v5'])
    expect(store.take(other)).toEqual({ userId: 'u2', verifier: 'v-other' })
  })

  it('B19 at most 1000 pending states overall, oldest evicted; expired ones are swept on issue', () => {
    let now = 0
    const store = memoryStateStore(() => new Date(now))
    const states = Array.from({ length: 1001 }, (_, i) => store.issue(`u${i}`, `v${i}`))
    expect(store.take(states[0]!)).toBeNull()
    expect(store.take(states[1]!)?.verifier).toBe('v1')
    expect(store.take(states[1000]!)?.verifier).toBe('v1000')
    now += STATE_TTL_MS
    const fresh = Array.from({ length: 999 }, (_, i) => store.issue(`w${i}`, `x${i}`))
    expect(store.take(states[2]!)).toBeNull()
    expect(store.take(fresh[0]!)?.verifier).toBe('x0')
  })
})
