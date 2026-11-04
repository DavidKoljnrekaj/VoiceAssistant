// Q08–Q10: short message refs per user, 30 minutes, bounded.
import { describe, expect, it } from 'vitest'

import { MessageRefs, REF_TTL_MS } from './refs.js'

describe('message refs', () => {
  it('Q08 a message keeps its ref; refs are per user; an unknown or malformed ref is null', () => {
    const refs = new MessageRefs(() => new Date(0))
    expect(refs.refFor('u1', 'AAMkAD-long-graph-id-1')).toBe('m1')
    expect(refs.refFor('u1', 'AAMkAD-long-graph-id-2')).toBe('m2')
    expect(refs.refFor('u1', 'AAMkAD-long-graph-id-1')).toBe('m1')
    expect(refs.resolve('u1', 'm2')).toBe('AAMkAD-long-graph-id-2')
    expect(refs.resolve('u2', 'm2')).toBeNull()
    expect(refs.refFor('u2', 'AAMkAD-long-graph-id-9')).toBe('m1')
    for (const bad of ['m3', 'M1', 'm0', 'm01', 'AAMkAD-long-graph-id-1', 'm1 ', '']) {
      expect(refs.resolve('u1', bad)).toBeNull()
    }
  })

  it('Q09 a ref lives 30 minutes after its last use; an expired number is never given to another message', () => {
    let now = 0
    const refs = new MessageRefs(() => new Date(now))
    refs.refFor('u1', 'a')
    refs.refFor('u1', 'b')
    now = REF_TTL_MS - 1
    expect(refs.resolve('u1', 'm1')).toBe('a')
    now = 2 * REF_TTL_MS - 2
    expect(refs.resolve('u1', 'm1')).toBe('a')
    expect(refs.resolve('u1', 'm2')).toBeNull()
    now = 3 * REF_TTL_MS
    expect(refs.resolve('u1', 'm1')).toBeNull()
    // A ref left in an old conversation stays expired: the next message gets a new number.
    expect(refs.refFor('u1', 'c')).toBe('m3')
    expect(refs.resolve('u1', 'm1')).toBeNull()
  })

  it('Q10 at most 200 refs per user: the least recently used goes first', () => {
    let now = 0
    const refs = new MessageRefs(() => new Date(now))
    for (let i = 1; i <= 200; i++) {
      now = i
      refs.refFor('u1', `id-${i}`)
    }
    now = 1000
    expect(refs.resolve('u1', 'm1')).toBe('id-1')
    now = 1001
    expect(refs.refFor('u1', 'id-201')).toBe('m201')
    expect(refs.resolve('u1', 'm1')).toBe('id-1')
    expect(refs.resolve('u1', 'm2')).toBeNull()
  })
})
