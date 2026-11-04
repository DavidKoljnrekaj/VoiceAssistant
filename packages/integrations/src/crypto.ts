// Tokens at rest: AES-256-GCM under INTEGRATIONS_KEY. A sealed value is
// "<key id>:<base64url of iv | tag | ciphertext>", so the key can rotate: the first key in the
// variable seals, every listed key opens. The additional data binds a value to its row and
// column (`tokenAad`), so a ciphertext copied to another user or column does not open.
// Nothing here logs; a failure never carries a key, a plaintext or a ciphertext.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32
const KEY_ID = /^[a-z0-9]{1,16}$/

export interface IntegrationsKeys {
  /** The key id new values are sealed under. */
  readonly current: string
  readonly keys: ReadonlyMap<string, Buffer>
}

/** A sealed value that does not open: unknown key id, tampered, or bound to other data. */
export class SealError extends Error {
  constructor(readonly reason: 'malformed' | 'unknown_key' | 'unauthentic') {
    super(`sealed value does not open: ${reason}`)
    this.name = 'SealError'
  }
}

/**
 * `INTEGRATIONS_KEY`: `"<id>:<base64 of 32 bytes>"`, optionally followed by older keys after
 * commas (`"k2:…,k1:…"`). Throws naming the problem and the position, never a value.
 */
export function parseIntegrationsKey(value: string): IntegrationsKeys {
  const keys = new Map<string, Buffer>()
  const parts = value.split(',').map((p) => p.trim())
  parts.forEach((part, i) => {
    const colon = part.indexOf(':')
    const id = colon > 0 ? part.slice(0, colon) : ''
    if (!KEY_ID.test(id))
      throw new Error(`INTEGRATIONS_KEY entry ${i + 1}: expected "<id>:<base64>", id a-z0-9`)
    if (keys.has(id)) throw new Error(`INTEGRATIONS_KEY entry ${i + 1}: key id repeated`)
    const encoded = part.slice(colon + 1)
    const key = Buffer.from(encoded, 'base64')
    // Buffer drops characters that are not base64; a mangled key must not pass as another one.
    if (key.toString('base64') !== encoded)
      throw new Error(`INTEGRATIONS_KEY entry ${i + 1}: key is not canonical base64`)
    if (key.length !== KEY_BYTES) throw new Error(`INTEGRATIONS_KEY entry ${i + 1}: key is not 32 bytes`)
    keys.set(id, key)
  })
  return { current: parts[0]!.slice(0, parts[0]!.indexOf(':')), keys }
}

/** The additional data a token column is sealed with. */
export function tokenAad(userId: string, provider: string, column: string): string {
  return `user_integrations:${userId}:${provider}:${column}`
}

export function seal(keys: IntegrationsKeys, plaintext: string, aad: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keys.keys.get(keys.current)!, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const packed = Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
  return `${keys.current}:${packed.toString('base64url')}`
}

export function open(keys: IntegrationsKeys, sealed: string, aad: string): string {
  const colon = sealed.indexOf(':')
  if (colon <= 0) throw new SealError('malformed')
  const key = keys.keys.get(sealed.slice(0, colon))
  if (!key) throw new SealError('unknown_key')
  const packed = Buffer.from(sealed.slice(colon + 1), 'base64url')
  if (packed.length < IV_BYTES + TAG_BYTES) throw new SealError('malformed')
  const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, IV_BYTES), {
    authTagLength: TAG_BYTES,
  })
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
  try {
    return Buffer.concat([decipher.update(packed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString(
      'utf8',
    )
  } catch {
    throw new SealError('unauthentic')
  }
}
