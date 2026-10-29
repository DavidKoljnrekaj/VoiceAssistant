// The voice call lifecycle against the API (docs/API.md → Voice call lifecycle): start creates the
// call's session and hands the caller's JWT to the worker by an opaque token; refresh passes on a
// rotated JWT; end deletes the credential. The browser only ever gets a token to join the room.
import { apiJson } from '../../../lib/api'
import { supabase } from '../../../lib/supabase'
import type { VoiceCallSession } from '../../../types/api'

export async function startVoiceCall(): Promise<VoiceCallSession> {
  return apiJson<VoiceCallSession>('/voice/sessions', { method: 'POST' })
}

/** Hands the browser's refreshed JWT to the live call; the call's 15-minute cap does not move. */
export async function refreshVoiceCall(sessionId: string): Promise<void> {
  await apiJson<{ ok: true }>(`/voice/sessions/${sessionId}/refresh`, { method: 'POST' })
}

/** Deletes the call's stored credential. The session row and its messages stay. */
export async function endVoiceCall(sessionId: string): Promise<void> {
  await apiJson<{ ok: true }>(`/voice/sessions/${sessionId}/end`, { method: 'POST' })
}

/** Calls back whenever supabase-js refreshes the access token; returns the unsubscribe. */
export function onAccessTokenRefreshed(callback: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'TOKEN_REFRESHED') setTimeout(callback, 0)
  })
  return () => data.subscription.unsubscribe()
}
