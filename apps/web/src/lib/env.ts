// The three build-time variables, validated once. A missing one fails at boot with its name, never
// a value (.claude/rules/architecture.md → Configuration).
import { z } from 'zod'

const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
  VITE_API_URL: z.url(),
})

export type WebEnv = z.infer<typeof schema>

export function parseWebEnv(source: Record<string, string | undefined>): WebEnv {
  const result = schema.safeParse(source)
  if (!result.success) {
    const names = result.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`Invalid web environment: ${names}`)
  }
  return {
    ...result.data,
    VITE_API_URL: result.data.VITE_API_URL.replace(/\/+$/, ''),
  }
}

export const env: WebEnv = parseWebEnv({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  VITE_API_URL: import.meta.env.VITE_API_URL,
})
