// The three Supabase settings every server-side app needs, validated once with zod. Values are
// never logged or echoed: an invalid environment names the variables, not their contents.
import { z } from 'zod'

export const dbEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
})

export type DbEnv = z.infer<typeof dbEnvSchema>

/**
 * Parses the Supabase settings from an environment map. Throws on the first invalid or missing
 * variable, naming the variables and the problem, never a value.
 */
export function parseDbEnv(source: Record<string, string | undefined>): DbEnv {
  const result = dbEnvSchema.safeParse(source)
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid Supabase environment: ${problems}`)
  }
  return result.data
}

let cached: DbEnv | undefined

/**
 * The process environment, parsed once on first use. The first caller that hits a missing
 * variable gets the error; later callers get the cached value.
 */
export function getDbEnv(): DbEnv {
  cached ??= parseDbEnv(process.env)
  return cached
}

/** Forgets the cached environment. For tests that change `process.env` between cases. */
export function resetDbEnvCache(): void {
  cached = undefined
}
