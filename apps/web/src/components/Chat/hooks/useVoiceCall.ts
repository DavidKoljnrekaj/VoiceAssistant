// One in-app voice call: start, mute, hang up. Ported from Landmark's useVoiceCall. livekit-client
// loads on the first call, not with the panel; the agent's audio plays through hidden audio
// elements (detached when the track or the call goes); a refreshed JWT is passed on to the call
// while it lasts; a closed tab ends the call with a keepalive request (WEB-10).
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
  /** The agent's subscribed audio tracks; their elements are detached with them. */
  tracks: Set<RemoteTrack>
  unsubscribe: () => void
  onPageHide: () => void
}

function detach(track: RemoteTrack): void {
  track.detach().forEach((el) => el.remove())
}

export function useVoiceCall(): VoiceCall {
  const [state, setState] = useState<VoiceCallState>('idle')
  const [muted, setMuted] = useState(false)
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [error, setError] = useState<VoiceCallErrorCode | null>(null)
  const live = useRef<Live | null>(null)

  const teardown = useCallback((reason: 'hangup' | 'pagehide' = 'hangup') => {
    const current = live.current
    live.current = null
    if (!current) return
    current.unsubscribe()
    window.removeEventListener('pagehide', current.onPageHide)
    current.tracks.forEach(detach)
    current.tracks.clear()
    void current.room.disconnect()
    // Best effort: the credential also expires and is swept server-side. On pagehide the request
    // must outlive the page, so it is sent with keepalive.
    endVoiceCall(current.sessionId, { keepalive: reason === 'pagehide' }).catch(() => {})
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
      const tracks = new Set<RemoteTrack>()
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return
        const el = track.attach()
        el.style.display = 'none'
        document.body.appendChild(el)
        tracks.add(track)
      })
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (!tracks.delete(track)) return
        detach(track)
      })
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setAgentSpeaking(speakers.some((p) => p.identity !== room.localParticipant.identity))
      })
      room.on(RoomEvent.Disconnected, () => teardown())
      const onPageHide = () => teardown('pagehide')
      window.addEventListener('pagehide', onPageHide)
      live.current = {
        room,
        sessionId: session.session_id,
        tracks,
        unsubscribe: onAccessTokenRefreshed(() => {
          refreshVoiceCall(session.session_id).catch(() => {})
        }),
        onPageHide,
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
  useEffect(() => () => teardown(), [teardown])

  const end = useCallback(() => teardown(), [teardown])

  return { state, muted, agentSpeaking, error, start, end, toggleMute }
}
