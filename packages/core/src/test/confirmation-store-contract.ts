// The contract every ConfirmationStore keeps, run by the in-memory store's tests and the API's
// DB-backed store's tests alike: single use at consume time (not only after settle), the four
// match columns, expiry, decline, and the outcomes.
import { expect } from 'vitest'

import type { ConfirmationStore, PendingConfirmation } from '../loop/ports.js'

export interface ContractOptions {
  /** A store for the given session and user; the clock is the test's. */
  store: (sessionId: string, userId: string) => ConfirmationStore
  /** Declines a pending id as the channel would; the memory store exposes it, the API's prepare does. */
  decline: (store: ConfirmationStore, id: string, sessionId: string, userId: string) => Promise<boolean>
  clock: { ms: number }
  sessionId: string
  userId: string
  otherSessionId: string
}

export async function confirmationStoreContract(o: ContractOptions): Promise<void> {
  const base: PendingConfirmation = {
    sessionId: o.sessionId,
    userId: o.userId,
    tool: 'confirmed_write',
    inputHash: 'hash-a',
    summary: 'Zapisat ću: "a"',
    expiresAt: new Date(o.clock.ms + 60_000).toISOString(),
  }
  const match = { sessionId: o.sessionId, userId: o.userId, tool: 'confirmed_write', inputHash: 'hash-a' }
  const store = o.store(o.sessionId, o.userId)

  const issued = await store.issue(base)
  expect(issued.id).toBeTruthy()
  const id = issued.id!

  // The four match columns, each on its own.
  expect(await store.consume(id, { ...match, inputHash: 'hash-b' })).toBe('mismatch')
  expect(await store.consume(id, { ...match, tool: 'other' })).toBe('mismatch')
  expect(await store.consume(id, { ...match, sessionId: o.otherSessionId })).toBe('not_found')
  expect(await store.consume(id, { ...match, userId: '00000000-0000-4000-8000-000000000bad' })).toBe(
    'not_found',
  )
  expect(await store.consume('00000000-0000-4000-8000-000000000bad', match)).toBe('not_found')

  // Single use from the moment of the consume, before any settle: a concurrent second consume loses.
  const [first, second] = await Promise.all([store.consume(id, match), store.consume(id, match)])
  expect([first, second].sort()).toEqual(['ok', 'used'])
  expect(await store.consume(id, match)).toBe('used')
  await store.settle(id, 'executed')
  expect(await store.consume(id, match)).toBe('used')
  expect(await o.decline(store, id, o.sessionId, o.userId)).toBe(false)

  // A failed settle records the reason; the id stays used.
  const failing = await store.issue({ ...base, inputHash: 'hash-f' })
  expect(await store.consume(failing.id!, { ...match, inputHash: 'hash-f' })).toBe('ok')
  await store.settle(failing.id!, 'failed', 'Error: kaboom')
  expect(await store.consume(failing.id!, { ...match, inputHash: 'hash-f' })).toBe('used')

  // Expiry: a pending id past its time is not consumable and is marked expired.
  const late = await store.issue({
    ...base,
    inputHash: 'hash-l',
    expiresAt: new Date(o.clock.ms + 1000).toISOString(),
  })
  o.clock.ms += 2000
  expect(await store.consume(late.id!, { ...match, inputHash: 'hash-l' })).toBe('expired')
  expect(await store.consume(late.id!, { ...match, inputHash: 'hash-l' })).toBe('used')

  // Decline: once, only while pending, only by the owner in the session.
  const declined = await store.issue({
    ...base,
    inputHash: 'hash-d',
    expiresAt: new Date(o.clock.ms + 60_000).toISOString(),
  })
  expect(await o.decline(store, declined.id!, o.otherSessionId, o.userId)).toBe(false)
  expect(await o.decline(store, declined.id!, o.sessionId, o.userId)).toBe(true)
  expect(await o.decline(store, declined.id!, o.sessionId, o.userId)).toBe(false)
  expect(await store.consume(declined.id!, { ...match, inputHash: 'hash-d' })).toBe('used')
}
