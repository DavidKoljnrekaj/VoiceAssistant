// The in-memory confirmation store keeps the store contract (the API's DB-backed store runs the
// same contract in apps/api).
import { describe, it } from 'vitest'

import { confirmationStoreContract } from '../test/confirmation-store-contract.js'
import { MemoryConfirmationStore } from './confirmations.js'

describe('MemoryConfirmationStore', () => {
  it('K01: keeps the confirmation store contract', async () => {
    const clock = { ms: Date.now() }
    await confirmationStoreContract({
      store: () => new MemoryConfirmationStore(() => clock.ms),
      decline: (store, id, sessionId, userId) =>
        (store as MemoryConfirmationStore).decline(id, { sessionId, userId }),
      clock,
      sessionId: '00000000-0000-4000-8000-000000000301',
      userId: '00000000-0000-4000-8000-000000000102',
      otherSessionId: '00000000-0000-4000-8000-000000000302',
    })
  })
})
