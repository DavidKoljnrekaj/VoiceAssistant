// The OAuth state of a connect in progress: who started it and their PKCE verifier, for ten
// minutes, once. In process memory, because the API is one process on one VM (decision 0016,
// API-13 for a second instance). Only the state's SHA-256 is a key, so a heap dump does not
// hold a usable state; the verifier never leaves this map except into the token request.
import { createHash, randomBytes } from 'node:crypto'

export const STATE_TTL_MS = 10 * 60_000
const MAX_ENTRIES = 1_000
const MAX_PER_USER = 5

export interface PendingConnect {
  userId: string
  verifier: string
}

export interface OAuthStateStore {
  /** A fresh 43-character state for this user's connect. */
  issue(userId: string, verifier: string): string
  /** The connect the state belongs to, once: a second take, or one after ten minutes, is null. */
  take(state: string): PendingConnect | null
}

export function memoryStateStore(clock: () => Date): OAuthStateStore {
  const entries = new Map<string, PendingConnect & { expiresAt: number }>()
  const key = (state: string) => createHash('sha256').update(state).digest('hex')

  function sweep(now: number): void {
    for (const [k, e] of entries) if (e.expiresAt <= now) entries.delete(k)
  }

  return {
    issue(userId, verifier) {
      const now = clock().getTime()
      sweep(now)
      // Bounded: a user's oldest pending connects go first, then anyone's oldest (insertion order).
      const own = [...entries].filter(([, e]) => e.userId === userId)
      for (const [k] of own.slice(0, Math.max(0, own.length - MAX_PER_USER + 1))) entries.delete(k)
      while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!)
      const state = randomBytes(32).toString('base64url')
      entries.set(key(state), { userId, verifier, expiresAt: now + STATE_TTL_MS })
      return state
    },

    take(state) {
      const k = key(state)
      const entry = entries.get(k)
      entries.delete(k)
      if (!entry || entry.expiresAt <= clock().getTime()) return null
      return { userId: entry.userId, verifier: entry.verifier }
    },
  }
}
