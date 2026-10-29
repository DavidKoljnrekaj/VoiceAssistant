// ElevenLabs text-to-speech from the environment: eleven_v4_turbo, the configured voice (Karlo
// by default), Croatian. Everything it reads has been through `speakable()` in the sink.
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs'

import type { VoiceEnv } from '../env.js'

export const ELEVENLABS_MODEL = 'eleven_v4_turbo'

export function createTts(env: Pick<VoiceEnv, 'ELEVENLABS_API_KEY' | 'VOICE_ID'>): elevenlabs.TTS {
  return new elevenlabs.TTS({
    apiKey: env.ELEVENLABS_API_KEY,
    voiceId: env.VOICE_ID,
    model: ELEVENLABS_MODEL,
    language: 'hr',
  })
}
