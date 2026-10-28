// Soniox speech-to-text from the environment: the EU host (the key comes from the EU project),
// stt-rt-v5 (the plugin still defaults to v4), Croatian only, the vocabulary hints, and
// Landmark's measured endpoint settings. Turns end on Soniox's own end-of-turn token
// (`turnDetection: 'stt'` in the session): LiveKit's turn detector has no Croatian.
import * as soniox from '@livekit/agents-plugin-soniox'

import type { VoiceEnv } from '../env.js'

export const SONIOX_EU_URL = 'wss://stt-rt.eu.soniox.com/transcribe-websocket'
export const SONIOX_MODEL = 'stt-rt-v5'

export function createStt(
  env: Pick<VoiceEnv, 'SONIOX_API_KEY' | 'ENDPOINT_DELAY_MS' | 'ENDPOINT_LATENCY_LEVEL'>,
  hints: string[],
): soniox.STT {
  return new soniox.STT({
    apiKey: env.SONIOX_API_KEY,
    baseUrl: SONIOX_EU_URL,
    model: SONIOX_MODEL,
    languageHints: ['hr'],
    languageHintsStrict: true,
    enableLanguageIdentification: false,
    maxEndpointDelayMs: env.ENDPOINT_DELAY_MS,
    endpointLatencyAdjustmentLevel: env.ENDPOINT_LATENCY_LEVEL,
    context: { terms: hints },
  })
}
