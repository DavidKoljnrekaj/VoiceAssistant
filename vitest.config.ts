// Root Vitest config: every workspace package is a project, so `pnpm test` runs all suites.
// (Vitest 4 removed vitest.workspace.ts; `test.projects` is its replacement.)
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
})
