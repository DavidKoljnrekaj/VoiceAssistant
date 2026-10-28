// The AgentSession's turn handling from the environment, as data: Soniox's own end of turn
// (LiveKit's turn detector has no Croatian), Landmark's measured delays, barge-in by Silero or
// by Soniox's first words, and nothing that LiveKit would do on its own account: no preemptive
// generation (it would run speculative engine turns on partial transcripts, count them against
// the call and persist them), no hosted "adaptive" interruption model, no session recording.
import type { VAD, voice } from '@livekit/agents'

import type { VoiceEnv } from './env.js'

export type TuningEnv = Pick<
  VoiceEnv,
  'INTERRUPT_ON' | 'INTERRUPT_MIN_MS' | 'TURN_MIN_DELAY_MS' | 'OUTPUT_QUEUE_MS'
>

export type TurnHandling = NonNullable<voice.AgentSessionOptions['turnHandling']>

export function turnHandlingOptions(env: TuningEnv): TurnHandling {
  return {
    turnDetection: 'stt',
    // In 'stt' mode LiveKit adds minDelay after Soniox's end-of-turn token, which already follows
    // the final words, so its 500 ms default is pure waiting.
    endpointing: { minDelay: env.TURN_MIN_DELAY_MS },
    // mode 'vad' only means "not LiveKit's hosted adaptive model"; without a VAD the framework
    // interrupts on the STT's interim words instead.
    interruption: { enabled: true, mode: 'vad', minDuration: env.INTERRUPT_MIN_MS },
    preemptiveGeneration: { enabled: false },
  }
}

/** The VAD the session gets: Silero, or `null` (which opts out of LiveKit's bundled one) when
 * Soniox's first words are the interruption signal. */
export function vadFor(env: Pick<VoiceEnv, 'INTERRUPT_ON'>, vad: VAD): VAD | null {
  return env.INTERRUPT_ON === 'stt' ? null : vad
}

/** `session.start` options beyond the agent and the room: never let the project's observability
 * setting upload audio, transcripts or traces (`record` defaults to the job's recording flag). */
export function startOptions(env: Pick<VoiceEnv, 'OUTPUT_QUEUE_MS'>): {
  outputOptions: { queueSizeMs: number }
  record: false
} {
  return { outputOptions: { queueSizeMs: env.OUTPUT_QUEUE_MS }, record: false }
}
