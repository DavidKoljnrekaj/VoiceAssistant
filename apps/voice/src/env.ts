// The worker's environment, validated once at startup with zod. Values are never logged or
// echoed: an invalid environment names the variables and the problem. The defaults are
// Landmark's measured values (docs/VOICE.md → Settings); change one only with a measurement.
import { z } from 'zod'

const optional = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional()

const int = (def: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(def)

/** The voice worker may cache a caller's identity for at most a minute (invariant 7). */
export const IDENTITY_CACHE_MAX_MS = 60_000

export const voiceEnvSchema = z.object({
  /** Dispatch-only name; the API dispatches to it as `VOICE_AGENT_NAME`. */
  AGENT_NAME: z.string().trim().min(1),
  LIVEKIT_URL: z.string().trim().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  SONIOX_API_KEY: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  /** Only for tests and local fakes; the SDK reads it too. */
  ANTHROPIC_BASE_URL: optional,
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  AI_VOICE_MODEL: optional,
  AI_VOICE_EFFORT: optional,
  /** ElevenLabs voice: Karlo, chosen by Landmark on 2026-10-26. */
  VOICE_ID: z.string().trim().min(1).default('pTD8166KADi6ZFJ5FEXi'),
  /** Soniox v5 endpoint latency adjustment, 0 (slowest) to 3 (fastest). */
  ENDPOINT_LATENCY_LEVEL: int(3, 0, 3),
  /** Soniox maximum end-of-turn delay. */
  ENDPOINT_DELAY_MS: int(500, 500, 3000),
  /** LiveKit's own wait after Soniox's end-of-turn signal. */
  TURN_MIN_DELAY_MS: int(100, 0, 5000),
  /** What stops the agent: Silero (`vad`), Soniox's first interim words (`stt`), or both. */
  INTERRUPT_ON: z.enum(['vad', 'stt', 'both']).default('vad'),
  /** Speech needed before the agent stops talking. */
  INTERRUPT_MIN_MS: int(50, 0, 5000),
  /** Agent audio queued ahead of playout, cleared on an interruption. */
  OUTPUT_QUEUE_MS: int(50, 10, 2000),
  VAD_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),
  VAD_MIN_SPEECH_MS: int(30, 0, 2000),
  /** Per-call identity re-read interval; capped at a minute. */
  IDENTITY_CACHE_MS: int(IDENTITY_CACHE_MAX_MS, 0, IDENTITY_CACHE_MAX_MS),
  /** Where the JSONL metrics go; defaults to `apps/voice/logs` (gitignored). */
  VOICE_LOGS_DIR: optional,
})

export type VoiceEnv = z.infer<typeof voiceEnvSchema>

export function parseVoiceEnv(source: Record<string, string | undefined>): VoiceEnv {
  const result = voiceEnvSchema.safeParse(source)
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid voice environment: ${problems}`)
  }
  return result.data
}
