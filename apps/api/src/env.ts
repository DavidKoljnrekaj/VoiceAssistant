// The API's environment, validated once at startup with zod. Values are never logged or echoed:
// an invalid environment names the variables and the problem. The three Supabase variables are
// validated here too, so a misconfigured process fails before it serves, but the clients come
// from @va/db (which reads them itself).
import { z } from 'zod'

const optional = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional()

export const apiEnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  /** Only for tests and local fakes; the SDK reads it too. */
  ANTHROPIC_BASE_URL: optional,
  AI_CHAT_MODEL: optional,
  AI_CHAT_EFFORT: optional,
  AI_VOICE_MODEL: optional,
  AI_VOICE_EFFORT: optional,
  LIVEKIT_URL: optional,
  LIVEKIT_API_KEY: optional,
  LIVEKIT_API_SECRET: optional,
  VOICE_AGENT_NAME: z.string().trim().min(1).default('va-voice'),
  /** Comma-separated origins, or `*`. */
  CORS_ORIGINS: z.string().trim().min(1).default('*'),
})

export type ApiEnv = z.infer<typeof apiEnvSchema>

export function parseApiEnv(source: Record<string, string | undefined>): ApiEnv {
  const result = apiEnvSchema.safeParse(source)
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid API environment: ${problems}`)
  }
  return result.data
}

/** `CORS_ORIGINS` as the cors middleware wants it. */
export function corsOrigins(env: Pick<ApiEnv, 'CORS_ORIGINS'>): string | string[] {
  if (env.CORS_ORIGINS === '*') return '*'
  return env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}
