// The prod-safety guard for the Playwright smoke, Landmark's e2e/support/env.ts ported: the
// smoke signs in as a real user (E03), so it must never run against production. The local
// Supabase stack is always allowed; any other project must equal E2E_ALLOWED_SUPABASE_URL, the
// one dev project URL, set on purpose (e2e.yml hardcodes it, docs/OPS.md → CI). The guard is a
// pure function so Vitest can pin it (G01–G04); env.ts applies it before any browser starts.

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal'])

export interface ProdSafetyInput {
  /** The project the PWA was built against (`VITE_SUPABASE_URL`). */
  supabaseUrl: string | undefined
  /** The one hosted project the smoke may talk to (`E2E_ALLOWED_SUPABASE_URL`). */
  allowedUrl: string | undefined
}

function normalise(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

/** True for the local Supabase stack (`supabase start`), which can never be production. */
export function isLocalStack(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/** The Supabase URL the smoke may use; throws with the reason when the run must be refused. */
export function assertSafeSupabaseUrl(input: ProdSafetyInput): string {
  const supabaseUrl = input.supabaseUrl?.trim() ?? ''
  if (!supabaseUrl) {
    throw new Error(
      '[e2e] VITE_SUPABASE_URL is not set: put it in apps/web/.env (the project the PWA was built ' +
        'against) or in the environment. Refusing to run.',
    )
  }
  if (isLocalStack(supabaseUrl)) return supabaseUrl
  const allowedUrl = input.allowedUrl?.trim() ?? ''
  if (!allowedUrl) {
    throw new Error(
      `[e2e] Prod-safety check failed: VITE_SUPABASE_URL (${supabaseUrl}) is a hosted project and ` +
        'E2E_ALLOWED_SUPABASE_URL is not set. Set it to the dev project URL, never production, and ' +
        'make VITE_SUPABASE_URL the same. Refusing to run.',
    )
  }
  if (normalise(allowedUrl) !== normalise(supabaseUrl)) {
    throw new Error(
      '[e2e] Prod-safety check failed.\n' +
        `  VITE_SUPABASE_URL         = ${supabaseUrl}\n` +
        `  E2E_ALLOWED_SUPABASE_URL  = ${allowedUrl}\n` +
        'Refusing to run. Set E2E_ALLOWED_SUPABASE_URL to the dev Supabase URL and ensure ' +
        'VITE_SUPABASE_URL points to the same project.',
    )
  }
  return supabaseUrl
}
