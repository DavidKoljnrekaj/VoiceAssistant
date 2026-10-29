// Root Vitest config: every workspace package is a project, so `pnpm test` runs all suites.
// (Vitest 4 removed vitest.workspace.ts; `test.projects` is its replacement.) Coverage is
// collected across the projects by `pnpm test:coverage` (CI uploads `coverage/` as an artifact).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        'packages/core/src/test/**', // the fakes and the harness
        'packages/db/src/database.ts', // generated
        'apps/web/src/**/*.tsx', // components: no DOM tests yet (Playwright covers the shell)
        'apps/web/src/main.tsx',
      ],
    },
  },
})
