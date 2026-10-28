// Silero voice activity detection, loaded once per process in `prewarm`. Landmark's thresholds
// (0.3 / 30 ms against Silero's own 0.5 / 50 ms): barge-in is limited by how fast this notices
// speech. It also reacts to breath; `INTERRUPT_ON=stt` drops it for Soniox's first words.
import type { VAD } from '@livekit/agents'
import * as silero from '@livekit/agents-plugin-silero'

import type { VoiceEnv } from '../env.js'

export async function loadVad(env: Pick<VoiceEnv, 'VAD_THRESHOLD' | 'VAD_MIN_SPEECH_MS'>): Promise<VAD> {
  return await silero.VAD.load({
    activationThreshold: env.VAD_THRESHOLD,
    minSpeechDuration: env.VAD_MIN_SPEECH_MS,
  })
}
