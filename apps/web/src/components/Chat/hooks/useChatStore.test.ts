// @vitest-environment jsdom
// The store through renderHook over a scripted chatService (src/test/fake-chat-service.ts): the
// tests drive streams event by event and assert on what the message list would render, the
// session list, the statuses and the service calls made.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assistantText,
  fakeChat,
  messageRow,
  sessionSummary,
  userText,
} from '../../../test/fake-chat-service'
import { ApiHttpError } from '../../../types/api'
import { ERROR_LABELS_HR } from '../lib/labels'
import { useChatStore } from './useChatStore'

vi.mock('../services/chatService', async () => {
  const { fakeChat } = await import('../../../test/fake-chat-service')
  return {
    streamMessage: fakeChat.streamMessage,
    listSessions: fakeChat.listSessions,
    loadSession: fakeChat.loadSession,
    renameSession: fakeChat.renameSession,
    deleteSession: fakeChat.deleteSession,
  }
})

const auth = vi.hoisted(() => ({ profile: { id: 'user-1' } as { id: string } | null }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: auth.profile }) }))

const S1 = '11111111-1111-4111-8111-111111111111'

/** A persisted turn of S1: user "Bok" → assistant "Dobar dan". Returned by the reload. */
function persistedTurn() {
  const user = messageRow({
    id: 'u1',
    session_id: S1,
    role: 'user',
    content: userText('Bok'),
    parent_id: null,
  })
  const assistant = messageRow({
    id: 'a1',
    session_id: S1,
    role: 'assistant',
    content: assistantText('Dobar dan'),
    parent_id: 'u1',
  })
  return [user, assistant]
}

const kinds = (store: ReturnType<typeof useChatStore>) => store.messages.map((m) => m.kind)

beforeEach(() => {
  auth.profile = { id: 'user-1' }
  fakeChat.reset()
})
afterEach(() => cleanup())

describe('useChatStore', () => {
  it('H01: a new conversation streams deltas, takes the turn as canonical and reloads the rows', async () => {
    fakeChat.listSessions.mockResolvedValue([sessionSummary('older', 'Stariji')])
    const { result } = renderHook(() => useChatStore())
    await waitFor(() => expect(result.current.sessionsStatus).toBe('ready'))

    let sent!: Promise<void>
    act(() => {
      sent = result.current.sendMessage('Bok')
    })
    const stream = await fakeChat.nextStream()
    expect(stream.args.sessionId).toBeNull()
    expect(stream.args.parentMessageId).toBeNull()
    expect(stream.args.message).toBe('Bok')
    expect(result.current.isStreaming).toBe(true)
    expect(kinds(result.current)).toEqual(['user'])

    await act(async () => {
      stream.emit({ type: 'session', session_id: S1 })
      stream.emit({ type: 'delta', text: 'Dobar ' })
      stream.emit({ type: 'delta', text: 'dan' })
    })
    expect(result.current.currentSessionId).toBe(S1)
    expect(result.current.sessions.map((s) => s.id)).toEqual([S1, 'older'])
    expect(result.current.pendingText).toBe('Dobar dan')

    fakeChat.loadSession.mockResolvedValue(persistedTurn())
    await act(async () => {
      stream.emit({ type: 'turn', role: 'assistant', text: 'Dobar dan', message_id: 'a1' })
      stream.emit({ type: 'done', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } })
      stream.finish()
      await sent
    })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.pendingText).toBeNull()
    expect(result.current.messages).toMatchObject([
      { kind: 'user', rowId: 'u1', text: 'Bok' },
      { kind: 'assistant', rowId: 'a1', text: 'Dobar dan', provisional: false },
    ])
    expect(fakeChat.loadSession).toHaveBeenCalledWith(S1)
    // The list is refetched after the turn (the API set the title).
    expect(fakeChat.listSessions).toHaveBeenCalledTimes(2)
  })

  it('H02: stop keeps the streamed text as a provisional bubble with the interrupted marker and moves the leaf', async () => {
    const { result } = renderHook(() => useChatStore())
    await waitFor(() => expect(result.current.sessionsStatus).toBe('ready'))
    let sent!: Promise<void>
    act(() => {
      sent = result.current.sendMessage('Bok')
    })
    const stream = await fakeChat.nextStream()
    await act(async () => {
      stream.emit({ type: 'session', session_id: S1 })
      stream.emit({ type: 'delta', text: 'Dobar' })
    })
    fakeChat.loadSession.mockResolvedValue([persistedTurn()[0]!])
    await act(async () => {
      result.current.stop()
      await sent
    })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.messages).toMatchObject([
      { kind: 'user', text: 'Bok' },
      { kind: 'assistant', text: 'Dobar', provisional: true },
      { kind: 'interrupted' },
    ])
    // The next send continues from the persisted user row, not from a stale leaf.
    act(() => {
      void result.current.sendMessage('Nastavi')
    })
    const next = await fakeChat.nextStream()
    expect(next.args.sessionId).toBe(S1)
    expect(next.args.parentMessageId).toBe('u1')
  })

  it('H03: selecting a conversation renders its branch; a failed read is an error state, not an empty list', async () => {
    fakeChat.loadSession.mockResolvedValueOnce(persistedTurn())
    const { result } = renderHook(() => useChatStore())
    await act(async () => {
      await result.current.selectSession(S1)
    })
    expect(result.current.messagesStatus).toBe('ready')
    expect(kinds(result.current)).toEqual(['user', 'assistant'])

    fakeChat.loadSession.mockRejectedValueOnce(new Error('PostgREST down'))
    await act(async () => {
      result.current.newConversation()
      await result.current.selectSession(S1)
    })
    expect(result.current.messagesStatus).toBe('error')
    expect(result.current.messages).toEqual([])
  })

  it('H04: a failed session list is an error state and a retry recovers', async () => {
    fakeChat.listSessions.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useChatStore())
    await waitFor(() => expect(result.current.sessionsStatus).toBe('error'))
    fakeChat.listSessions.mockResolvedValueOnce([sessionSummary(S1, 'Prvi')])
    await act(async () => {
      await result.current.fetchSessions()
    })
    expect(result.current.sessionsStatus).toBe('ready')
    expect(result.current.sessions.map((s) => s.title)).toEqual(['Prvi'])
  })

  it('H05: a pre-stream failure on a new conversation keeps the typed row and adds the inline error', async () => {
    const { result } = renderHook(() => useChatStore())
    await waitFor(() => expect(result.current.sessionsStatus).toBe('ready'))
    let sent!: Promise<void>
    act(() => {
      sent = result.current.sendMessage('Bok')
    })
    const stream = await fakeChat.nextStream()
    await act(async () => {
      stream.fail(new ApiHttpError(429, 'rate_limited', 'Previše zahtjeva.'))
      await sent
    })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.messages).toMatchObject([
      { kind: 'user', text: 'Bok' },
      { kind: 'error', code: 'rate_limited', message: ERROR_LABELS_HR.rate_limited },
    ])
    expect(fakeChat.loadSession).not.toHaveBeenCalled()
  })

  it('H06: rename and delete go through the service; a failed rename is an inline error row', async () => {
    fakeChat.listSessions.mockResolvedValue([sessionSummary(S1, 'Prvi'), sessionSummary('s2', 'Drugi')])
    const { result } = renderHook(() => useChatStore())
    await waitFor(() => expect(result.current.sessionsStatus).toBe('ready'))
    await act(async () => {
      await result.current.renameSession(S1, '  Novi naslov ')
    })
    expect(fakeChat.renameSession).toHaveBeenCalledWith(S1, 'Novi naslov')
    expect(result.current.sessions[0]?.title).toBe('Novi naslov')

    fakeChat.renameSession.mockRejectedValueOnce(new ApiHttpError(404, 'session_not_found', 'Nema'))
    await act(async () => {
      await result.current.renameSession(S1, 'Opet')
    })
    expect(result.current.messages).toMatchObject([{ kind: 'error', code: 'rename_failed' }])

    await act(async () => {
      await result.current.selectSession(S1)
    })
    await act(async () => {
      await result.current.deleteSession(S1)
    })
    expect(fakeChat.deleteSession).toHaveBeenCalledWith(S1)
    expect(result.current.sessions.map((s) => s.id)).toEqual(['s2'])
    expect(result.current.currentSessionId).toBeNull()
  })

  it('WEB-4: a pre-stream failure on an existing conversation keeps the typed row and the error after the reload', async () => {
    fakeChat.loadSession.mockResolvedValue(persistedTurn())
    const { result } = renderHook(() => useChatStore())
    await act(async () => {
      await result.current.selectSession(S1)
    })
    expect(kinds(result.current)).toEqual(['user', 'assistant'])
    let sent!: Promise<void>
    act(() => {
      sent = result.current.sendMessage('Još jedno')
    })
    const stream = await fakeChat.nextStream()
    await act(async () => {
      stream.fail(new ApiHttpError(429, 'rate_limited', 'Previše zahtjeva.'))
      await sent
    })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.messages).toMatchObject([
      { kind: 'user', rowId: 'u1', text: 'Bok' },
      { kind: 'assistant', rowId: 'a1' },
      { kind: 'user', rowId: null, text: 'Još jedno' },
      { kind: 'error', code: 'rate_limited', message: ERROR_LABELS_HR.rate_limited },
    ])
  })

  it('WEB-4: a mid-stream error event survives the reload, after the canonical rows', async () => {
    fakeChat.loadSession.mockResolvedValue(persistedTurn())
    const { result } = renderHook(() => useChatStore())
    await act(async () => {
      await result.current.selectSession(S1)
    })
    let sent!: Promise<void>
    act(() => {
      sent = result.current.sendMessage('Još jedno')
    })
    const stream = await fakeChat.nextStream()
    // The server persisted the user row before the stream opened, then timed out.
    const persisted = persistedTurn()
    const u2 = messageRow({ id: 'u2', session_id: S1, role: 'user', content: userText('Još jedno'), parent_id: 'a1' })
    fakeChat.loadSession.mockResolvedValue([...persisted, u2])
    await act(async () => {
      stream.emit({ type: 'session', session_id: S1 })
      stream.emit({ type: 'delta', text: 'Poč' })
      stream.emit({ type: 'error', code: 'request_timeout', message: 'Isteklo je vrijeme.' })
      stream.finish()
      await sent
    })
    expect(result.current.pendingText).toBeNull()
    expect(result.current.messages).toMatchObject([
      { kind: 'user', rowId: 'u1' },
      { kind: 'assistant', rowId: 'a1' },
      { kind: 'user', rowId: 'u2', text: 'Još jedno' },
      { kind: 'error', code: 'request_timeout', message: 'Isteklo je vrijeme.' },
    ])
    // The next send continues from the persisted user row.
    act(() => {
      void result.current.sendMessage('Opet')
    })
    const next = await fakeChat.nextStream()
    expect(next.args.parentMessageId).toBe('u2')
  })

  it('H07: a sign-out empties the store and aborts the open stream', async () => {
    fakeChat.listSessions.mockResolvedValue([sessionSummary(S1, 'Prvi')])
    const { result, rerender } = renderHook(() => useChatStore())
    await waitFor(() => expect(result.current.sessionsStatus).toBe('ready'))
    let sent!: Promise<void>
    act(() => {
      sent = result.current.sendMessage('Bok')
    })
    const stream = await fakeChat.nextStream()
    await act(async () => {
      stream.emit({ type: 'session', session_id: S1 })
    })
    auth.profile = null
    // Two act scopes: the reset effect that aborts the stream runs when the first one closes.
    await act(async () => {
      rerender()
    })
    await act(async () => {
      await sent
    })
    expect(stream.args.signal.aborted).toBe(true)
    expect(result.current.sessions).toEqual([])
    expect(result.current.currentSessionId).toBeNull()
    expect(result.current.messages).toEqual([])
    expect(result.current.isStreaming).toBe(false)
  })
})
