// J scenarios: tokens sealed at rest with AES-256-GCM, key rotation, bound to their row.
import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { open, parseIntegrationsKey, seal, SealError, tokenAad } from './crypto.js'

const k = (id: string) => `${id}:${randomBytes(32).toString('base64')}`
const AAD = tokenAad('user-1', 'microsoft', 'refresh_token_enc')

describe('crypto', () => {
  it('J01: a sealed value opens with the same key and data, and carries the key id, not the plaintext', () => {
    const keys = parseIntegrationsKey(k('k1'))
    const sealed = seal(keys, 'refresh-secret', AAD)
    expect(sealed).toMatch(/^k1:[A-Za-z0-9_-]+$/)
    expect(sealed).not.toContain('refresh-secret')
    expect(open(keys, sealed, AAD)).toBe('refresh-secret')
    expect(seal(keys, 'refresh-secret', AAD)).not.toBe(sealed)
  })

  it('J02: a value bound to another user or column does not open', () => {
    const keys = parseIntegrationsKey(k('k1'))
    const sealed = seal(keys, 'refresh-secret', AAD)
    expect(() => open(keys, sealed, tokenAad('user-2', 'microsoft', 'refresh_token_enc'))).toThrow(
      new SealError('unauthentic'),
    )
    expect(() => open(keys, sealed, tokenAad('user-1', 'microsoft', 'access_token_enc'))).toThrow(SealError)
  })

  it('J03: a tampered or truncated value does not open', () => {
    const keys = parseIntegrationsKey(k('k1'))
    const sealed = seal(keys, 'refresh-secret', AAD)
    const body = Buffer.from(sealed.slice(3), 'base64url')
    body[body.length - 1] ^= 1
    expect(() => open(keys, `k1:${body.toString('base64url')}`, AAD)).toThrow(new SealError('unauthentic'))
    expect(() => open(keys, 'k1:AAAA', AAD)).toThrow(new SealError('malformed'))
    expect(() => open(keys, 'no-key-id', AAD)).toThrow(new SealError('malformed'))
  })

  it('J04: rotation: the first key seals, an older listed key still opens, a dropped key does not', () => {
    const old = k('k1')
    const sealedOld = seal(parseIntegrationsKey(old), 'refresh-secret', AAD)
    const rotated = parseIntegrationsKey(`${k('k2')},${old}`)
    expect(rotated.current).toBe('k2')
    expect(open(rotated, sealedOld, AAD)).toBe('refresh-secret')
    expect(seal(rotated, 'x', AAD)).toMatch(/^k2:/)
    expect(() => open(parseIntegrationsKey(k('k2')), sealedOld, AAD)).toThrow(new SealError('unknown_key'))
  })

  it('J05: a malformed INTEGRATIONS_KEY is refused, naming the problem but never the value', () => {
    const short = `k1:${randomBytes(16).toString('base64')}`
    const bad = [short, 'k1', `K1:${randomBytes(32).toString('base64')}`, `${k('k1')},${k('k1')}`]
    const messages = bad.map((v) => {
      try {
        parseIntegrationsKey(v)
        return 'accepted'
      } catch (e) {
        return (e as Error).message
      }
    })
    expect(messages).toEqual([
      'INTEGRATIONS_KEY entry 1: key is not 32 bytes',
      'INTEGRATIONS_KEY entry 1: expected "<id>:<base64>", id a-z0-9',
      'INTEGRATIONS_KEY entry 1: expected "<id>:<base64>", id a-z0-9',
      'INTEGRATIONS_KEY entry 2: key id repeated',
    ])
    expect(messages.join(' ')).not.toContain(short.slice(3))
  })

  it('J06: a key that is not canonical base64 is refused, even when it decodes to 32 bytes', () => {
    const key = randomBytes(32).toString('base64')
    expect(() => parseIntegrationsKey(`k1:${key.slice(0, 10)}!${key.slice(10)}`)).toThrow(
      'INTEGRATIONS_KEY entry 1: key is not canonical base64',
    )
  })
})
