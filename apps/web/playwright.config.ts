// The Playwright smoke (e2e/): the built PWA served by `vite preview`, driven in Chromium.
// Locally: `pnpm --filter @va/web build && pnpm --filter @va/web test:e2e` with the three
// VITE_ variables of the stack it should talk to. In CI it runs from .github/workflows/e2e.yml
// against the dev Supabase project, gated on secrets (docs/OPS.md → CI). Importing
// e2e/support/env.ts applies the prod-safety guard before any browser starts: the local stack
// always runs; a hosted project only when it equals E2E_ALLOWED_SUPABASE_URL.
import { defineConfig } from '@playwright/test'

import './e2e/support/env.js'

const PORT = 4173
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    // A trace records every action's arguments and all traffic (a typed password, the JWT GoTrue
    // returns), so it is never written where CI would upload it.
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    locale: 'hr-HR',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: `pnpm preview --host 127.0.0.1 --port ${PORT} --strictPort`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      }),
})
