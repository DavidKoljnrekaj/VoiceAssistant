// K02: the DB-backed confirmation store keeps the same contract as the in-memory one, over the
// PostgREST fake; K03 fixes the conditional update's shape, the single-use guarantee on real
// Postgres (the pgTAP test runs that statement twice).
import { describe, expect, it } from 'vitest'

import { authAs, confirmationStoreContract, db, reset, SESSION_MEMBER_CHAT, USERS, uuid } from '@va/core/test'

import { dbConfirmationStore, declineConfirmation } from '../src/chat/confirmations.js'

describe('dbConfirmationStore', () => {
  it('K02: keeps the confirmation store contract', async () => {
    reset()
    const ctx = await authAs('member')
    const clock = { ms: Date.now() }
    const other = uuid(302)
    db.seed('ai_sessions', [{ id: other, user_id: USERS.member.id, channel: 'chat' }])
    await confirmationStoreContract({
      store: (sessionId) => dbConfirmationStore(ctx, sessionId, () => new Date(clock.ms)),
      decline: async (_store, id, sessionId) =>
        (await declineConfirmation(ctx, sessionId, id, new Date(clock.ms), new AbortController().signal)) ===
        'ok',
      clock,
      sessionId: SESSION_MEMBER_CHAT,
      userId: USERS.member.id,
      otherSessionId: other,
    })
  })

  it('K03: the consume is one conditional update on the pending, unconfirmed, unexpired row of this session and user', async () => {
    reset()
    const ctx = await authAs('member')
    const store = dbConfirmationStore(ctx, SESSION_MEMBER_CHAT, () => new Date())
    const { id } = await store.issue({
      sessionId: SESSION_MEMBER_CHAT,
      userId: USERS.member.id,
      tool: 't',
      inputHash: 'h',
      summary: 's',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    await store.consume(id!, {
      sessionId: SESSION_MEMBER_CHAT,
      userId: USERS.member.id,
      tool: 't',
      inputHash: 'h',
    })
    const patch = db.requestsTo('tool_confirmations', 'PATCH')[0]!
    expect(Object.fromEntries(patch.params)).toMatchObject({
      id: `eq.${id}`,
      session_id: `eq.${SESSION_MEMBER_CHAT}`,
      user_id: `eq.${USERS.member.id}`,
      tool: 'eq.t',
      input_hash: 'eq.h',
      outcome: 'eq.pending',
      confirmed_at: 'is.null',
    })
    expect(patch.params.get('expires_at')).toMatch(/^gt\./)
    expect(patch.body).toEqual({ confirmed_at: expect.any(String) })
  })
})
