// Tests for the fake PostgREST / GoTrue through the real supabase-js clients.
import { describe, expect, it } from 'vitest'

import { createServiceClient, createUserClient } from '@va/db'

import { ITEMS, MSG_TOOL_RESULT, MSG_USER, SESSION_MEMBER_CHAT, TOKENS, USERS } from './fixtures.js'
import { db, reset } from './harness.js'

describe('fake-supabase', () => {
  it('G01: select with eq, ilike, order and limit', async () => {
    reset()
    const { data, error } = await createServiceClient()
      .from('users')
      .select('id, email')
      .eq('role', 'member')
      .ilike('email', '%@va.test')
      .order('email')
      .limit(10)
    expect(error).toBeNull()
    expect(data).toEqual([{ id: USERS.member.id, email: USERS.member.email }])
  })

  it('G02: insert returns the representation with defaults, and bumps the session', async () => {
    reset()
    const before = db.rows('ai_sessions').find((s) => s.id === SESSION_MEMBER_CHAT)!.updated_at
    const { data, error } = await createServiceClient()
      .from('ai_messages')
      .insert({
        session_id: SESSION_MEMBER_CHAT,
        role: 'user',
        turn_kind: 'user',
        content: [{ type: 'text', text: 'Bok' }],
        parent_id: MSG_TOOL_RESULT,
      })
      .select('id, stop_reason')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(data?.stop_reason).toBeNull()
    expect(db.rows('ai_sessions').find((s) => s.id === SESSION_MEMBER_CHAT)!.updated_at).not.toBe(before)
  })

  it('G03: maybeSingle, is null, and an injected fault', async () => {
    reset()
    const client = createServiceClient()
    const root = await client
      .from('ai_messages')
      .select('id')
      .eq('session_id', SESSION_MEMBER_CHAT)
      .is('parent_id', null)
      .maybeSingle()
    expect(root.data?.id).toBe(MSG_USER)
    db.fault((r) => r.table === 'ai_messages', { status: 500 })
    const failed = await client.from('ai_messages').select('id').eq('session_id', SESSION_MEMBER_CHAT)
    expect(failed.error?.code).toBe('XX000')
  })

  it('G04: GoTrue answers the user client by token, and rejects an unknown one', async () => {
    reset()
    const ok = await createUserClient(TOKENS.admin).auth.getUser(TOKENS.admin)
    expect(ok.data.user?.id).toBe(USERS.admin.authId)
    const bad = await createUserClient('nope').auth.getUser('nope')
    expect(bad.data.user).toBeNull()
    expect(bad.error).not.toBeNull()
  })

  it('G06: a hung request rejects with an AbortError when the caller aborts', async () => {
    reset()
    db.fault((r) => r.table === 'users', { hang: true })
    const controller = new AbortController()
    const pending = createServiceClient().from('users').select('id').abortSignal(controller.signal)
    setTimeout(() => controller.abort(), 10)
    const { error } = await pending
    expect(error?.message).toMatch(/abort/i)
    expect(db.requestsTo('users', 'GET')[0]!.finished).toBe(true)
  })

  it('G05: the ai_session_history RPC walks root → leaf and stops at the summary boundary', async () => {
    reset()
    const client = createServiceClient()
    const whole = await client.rpc('ai_session_history', { p_leaf_id: MSG_TOOL_RESULT, p_max_rows: 200 })
    expect(whole.data?.map((m) => m.id)).toEqual([MSG_USER, expect.any(String), MSG_TOOL_RESULT])
    const bounded = await client.rpc('ai_session_history', { p_leaf_id: MSG_TOOL_RESULT, p_max_rows: 2 })
    expect(bounded.data).toHaveLength(2)
    const unknown = await client.rpc('ai_session_history', { p_leaf_id: ITEMS.lamp.id, p_max_rows: 200 })
    expect(unknown.data).toEqual([])
  })
})
