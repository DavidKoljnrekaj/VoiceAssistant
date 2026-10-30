// @vitest-environment jsdom
// The call hook through renderHook: the API and GoTrue are the fake backend over fetch, and
// livekit-client is a scripted module (WebRTC has no wire protocol a fetch fake could answer, so
// this is the one SDK stood in for). Assertions: the requests sent, the audio elements in the
// document, and the state the button renders.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  API_ORIGIN,
  type FakeBackend,
  signInTestUser,
  signOutTestUser,
  installFakeBackend,
  json,
} from '../../../test/fake-backend'
import { useVoiceCall } from './useVoiceCall'

type Listener = (...args: unknown[]) => void

/** A scripted room: `on` records listeners, `emit` fires them, connect/disconnect are spied. */
class FakeRoom {
  static last: FakeRoom | null = null
  static connectError: Error | null = null
  readonly listeners = new Map<string, Listener[]>()
  readonly connect = vi.fn(async () => {
    if (FakeRoom.connectError) throw FakeRoom.connectError
  })
  readonly disconnect = vi.fn(async () => {
    this.emit('disconnected')
  })
  readonly localParticipant = { identity: 'me', setMicrophoneEnabled: vi.fn(async () => {}) }
  constructor() {
    FakeRoom.last = this
  }
  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }
  emit(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args)
  }
}

vi.mock('livekit-client', () => ({
  Room: FakeRoom,
  RoomEvent: {
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    Disconnected: 'disconnected',
  },
  Track: { Kind: { Audio: 'audio', Video: 'video' } },
}))

/** A remote audio track whose attach() creates an element and detach() hands them back. */
function fakeTrack(kind = 'audio') {
  const elements: HTMLMediaElement[] = []
  return {
    kind,
    elements,
    attach: vi.fn(() => {
      const el = document.createElement('audio')
      el.dataset.track = 'fake'
      elements.push(el)
      return el
    }),
    detach: vi.fn(() => elements.splice(0)),
  }
}

let backend: FakeBackend
const SESSION = { url: 'wss://livekit.test', token: 'room-token', room: 'r1', session_id: 'vc-1' }

beforeAll(async () => {
  backend = installFakeBackend()
  await signInTestUser(backend, { id: 'auth-1', email: 'ana@example.com' })
})
beforeEach(() => {
  backend.requests.length = 0
  FakeRoom.last = null
  FakeRoom.connectError = null
  backend.route('POST', API_ORIGIN, '/voice/sessions', (req) =>
    json(req.url.pathname === '/voice/sessions' ? SESSION : { ok: true }),
  )
})
afterEach(() => {
  cleanup()
  document.querySelectorAll('audio').forEach((el) => el.remove())
})
afterAll(async () => {
  await signOutTestUser()
  backend.restore()
})

const audioInDocument = () => document.querySelectorAll('audio[data-track="fake"]').length

async function startCall() {
  const rendered = renderHook(() => useVoiceCall())
  await act(async () => {
    await rendered.result.current.start()
  })
  await waitFor(() => expect(rendered.result.current.state).toBe('live'))
  const room = FakeRoom.last!
  const track = fakeTrack()
  act(() => room.emit('trackSubscribed', track))
  expect(audioInDocument()).toBe(1)
  return { ...rendered, room, track }
}

describe('useVoiceCall', () => {
  it('V01: start posts /voice/sessions, joins the room and plays the agent track; hang-up ends the call', async () => {
    const { result, room, track } = await startCall()
    expect(backend.sent('POST', '/voice/sessions')).toHaveLength(1)
    expect(room.connect).toHaveBeenCalledWith(SESSION.url, SESSION.token)
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ echoCancellation: true }),
    )
    expect(track.elements[0]?.style.display).toBe('none')

    act(() => room.emit('activeSpeakersChanged', [{ identity: 'agent' }]))
    expect(result.current.agentSpeaking).toBe(true)

    await act(async () => {
      result.current.end()
    })
    expect(result.current.state).toBe('idle')
    expect(room.disconnect).toHaveBeenCalled()
    expect(audioInDocument()).toBe(0)
    await waitFor(() =>
      expect(backend.sent('POST', `/voice/sessions/${SESSION.session_id}/end`)).toHaveLength(1),
    )
  })

  it('V02: a failed room connect ends the call once, as start_failed', async () => {
    FakeRoom.connectError = new Error('ice failed')
    const { result } = renderHook(() => useVoiceCall())
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.state).toBe('idle')
    expect(result.current.error).toBe('start_failed')
    await waitFor(() =>
      expect(backend.sent('POST', `/voice/sessions/${SESSION.session_id}/end`)).toHaveLength(1),
    )
  })

  it('WEB-10: a closed tab (pagehide) ends the call with a keepalive request', async () => {
    const { result } = await startCall()
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await waitFor(() =>
      expect(backend.sent('POST', `/voice/sessions/${SESSION.session_id}/end`)).toHaveLength(1),
    )
    expect(backend.sent('POST', `/voice/sessions/${SESSION.session_id}/end`)[0]?.keepalive).toBe(true)
    expect(result.current.state).toBe('idle')
    expect(audioInDocument()).toBe(0)
  })

  it('WEB-10: tracks are detached before their elements go, and an unsubscribed track takes its element with it', async () => {
    const { result, room, track } = await startCall()
    const second = fakeTrack()
    act(() => room.emit('trackSubscribed', second))
    expect(audioInDocument()).toBe(2)

    act(() => room.emit('trackUnsubscribed', second))
    expect(second.detach).toHaveBeenCalled()
    expect(audioInDocument()).toBe(1)

    await act(async () => {
      result.current.end()
    })
    expect(track.detach).toHaveBeenCalled()
    expect(audioInDocument()).toBe(0)
  })
})
