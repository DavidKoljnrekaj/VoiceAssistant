// The environment the smoke runs against, guarded before any browser starts (imported by
// playwright.config.ts). VITE_SUPABASE_URL comes from the process environment first (e2e.yml
// passes the secret to the smoke step), then from apps/web/.env* exactly as Vite's production
// build reads them, so the guard sees the project the bundle was built against. Locally the
// file is the developer's own .env; the harness never reads it.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv } from 'vite'

import { assertSafeSupabaseUrl } from './prod-safety.js'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fromFiles = loadEnv('production', webRoot, 'VITE_')

export const env = {
  supabaseUrl: assertSafeSupabaseUrl({
    supabaseUrl: process.env.VITE_SUPABASE_URL ?? fromFiles.VITE_SUPABASE_URL,
    allowedUrl: process.env.E2E_ALLOWED_SUPABASE_URL,
  }),
}
