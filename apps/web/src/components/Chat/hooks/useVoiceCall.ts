// One in-app voice call: start, mute, hang up. Ported from Landmark's useVoiceCall. livekit-client
// loads on the first call, not with the panel; the agent's audio plays through hidden audio
// elements; a refreshed JWT is passed on to the call while it lasts.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteTrack, Room } from 'livekit-client'

import {
  endVoiceCall,
  onAccessTokenRefreshed,
  refreshVoiceCall,
  startVoiceCall,
} from '../services/voiceCallService'

export type VoiceCallState = 'idle' | 'connecting' | 'live'
export type VoiceCallErrorCode = 'mic_denied' | 'start_failed'

export interface VoiceCall {
  state: VoiceCallState
  muted: boolean
  agentSpeaking: boolean
  /** The last failure; the component turns it into a toast. */
  error: VoiceCallErrorCode | null
  start: () => Promise<void>
  end: () => void
  toggleMute: () => Promise<void>
}

interface Live {
  room: Room
  sessionId: string
  audio: HTMLMediaElement[]
  unsubscribe: () => void
}

export function useVoiceCall(): VoiceCall {
  const [state, setState] = useState<VoiceCallState>('idle')
  const [muted, setMuted] = useState(false)
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [error, setError] = useState<VoiceCallErrorCode | null>(null)
  const live = useRef<Live | null>(null)

  const teardown = useCallback(() => {
    const current = live.current
    live.current = null
    if (!current) return
    current.unsubscribe()
    current.audio.forEach((el) => el.remove())
    void current.room.disconnect()
    // Best effort: the credential also expires and is swept server-side.
    endVoiceCall(current.sessionId).catch(() => {})
    setState('idle')
    setMuted(false)
    setAgentSpeaking(false)
  }, [])

  const start = useCallback(async () => {
    if (live.current) return
    setError(null)
    setState('connecting')
    let sessionId: string | null = null
    const { Room, RoomEvent, Track } = await import('livekit-client')
    const room = new Room()
    try {
      const session = await startVoiceCall()
      sessionId = session.session_id
      const audio: HTMLMediaElement[] = []
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return
        const el = track.attach()
        el.style.display = 'none'
        document.body.appendChild(el)
        audio.push(el)
      })
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setAgentSpeaking(speakers.some((p) => p.identity !== room.localParticipant.identity))
      })
      room.on(RoomEvent.Disconnected, () => teardown())
      live.current = {
        room,
        sessionId: session.session_id,
        audio,
        unsubscribe: onAccessTokenRefreshed(() => {
          refreshVoiceCall(session.session_id).catch(() => {})
        }),
      }
      await room.connect(session.url, session.token)
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      })
      setState('live')
    } catch (err) {
      const micDenied =
        err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')
      setError(micDenied ? 'mic_denied' : 'start_failed')
      if (live.current) teardown()
      else {
        void room.disconnect()
        if (sessionId) endVoiceCall(sessionId).catch(() => {})
        setState('idle')
      }
    }
  }, [teardown])

  const toggleMute = useCallback(async () => {
    const current = live.current
    if (!current) return
    const next = !muted
    await current.room.localParticipant.setMicrophoneEnabled(!next)
    setMuted(next)
  }, [muted])

  // Hang up when the panel goes away.
  useEffect(() => teardown, [teardown])

  return { state, muted, agentSpeaking, error, start, end: teardown, toggleMute }
}
