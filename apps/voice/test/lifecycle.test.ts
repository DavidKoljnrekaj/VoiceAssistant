// VOICE-11, VOICE-12: how the worker ends a call. LiveKit-free: the hang-up helper and the
// decisions `agent.ts` wires to the room and session events.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HANGUP_GRACE_MS, HangUp, participantLeft, sessionErrorAction } from '../src/lifecycle.js'

describe('sessionErrorAction', () => {
  it('VOICE-12b a recoverable provider error is only logged; an unrecoverable one is spoken and ends the call, unless speech itself failed', () => {
    expect(sessionErrorAction({ type: 'stt_error', recoverable: true })).toBe('log')
    expect(sessionErrorAction({ type: 'tts_error', recoverable: true })).toBe('log')
    expect(sessionErrorAction({ type: 'stt_error', recoverable: false })).toBe('speak_and_hang_up')
    expect(sessionErrorAction({ type: 'llm_error', recoverable: false })).toBe('speak_and_hang_up')
    expect(sessionErrorAction({ type: 'tts_error', recoverable: false })).toBe('hang_up')
    // An error event without the flag (a realtime model, not used here) is not recoverable.
    expect(sessionErrorAction({ type: 'realtime_model_error' })).toBe('speak_and_hang_up')
  })
})

describe('participantLeft', () => {
  it("VOICE-12 only the caller's own disconnect ends the call; a recorder, egress or a reconnecting browser under a new identity does not", () => {
    const caller = '00000000-0000-4000-8000-000000000102'
    expect(participantLeft(caller, caller)).toBe('hang_up')
    expect(participantLeft('EG_abc123', caller)).toBe('ignore')
    expect(participantLeft('00000000-0000-4000-8000-000000000103', caller)).toBe('ignore')
    expect(participantLeft('', caller)).toBe('ignore')
  })
})

describe('HangUp', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('VOICE-11b after a spoken line the hang-up waits for the agent to finish, once', () => {
    const finished: string[] = []
    const h = new HangUp((r) => finished.push(r))
    h.afterSpeech('call_ended')
    expect(finished).toEqual([])
    h.afterSpeech('session_error') // a second request changes nothing
    h.spoke()
    expect(finished).toEqual(['call_ended'])
    h.spoke()
    h.now('participant_disconnected')
    expect(finished).toEqual(['call_ended'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('VOICE-11c when the agent never speaks (text-to-speech is what failed) the grace period hangs up', () => {
    const finished: string[] = []
    const h = new HangUp((r) => finished.push(r))
    h.afterSpeech('session_error')
    vi.advanceTimersByTime(HANGUP_GRACE_MS - 1)
    expect(finished).toEqual([])
    vi.advanceTimersByTime(1)
    expect(finished).toEqual(['session_error'])
  })

  it('VOICE-11d an immediate hang-up (the caller left) runs once and clears a pending one', () => {
    const finished: string[] = []
    const h = new HangUp((r) => finished.push(r))
    h.afterSpeech('call_ended')
    h.now('participant_disconnected')
    h.now('shutdown')
    h.spoke()
    expect(finished).toEqual(['participant_disconnected'])
    expect(vi.getTimerCount()).toBe(0)
    const fresh = new HangUp((r) => finished.push(r))
    fresh.spoke() // nothing pending: nothing happens
    expect(finished).toEqual(['participant_disconnected'])
  })
})
