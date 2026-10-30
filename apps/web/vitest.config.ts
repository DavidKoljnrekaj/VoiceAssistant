import { configDefaults, defineProject } from 'vitest/config'

export default defineProject({
  test: {
    environment: 'node',
    // The Playwright smoke (e2e/**/*.spec.ts) is run by `pnpm --filter @va/web test:e2e`, never
    // by Vitest; the smoke's own support code (e2e/support/*.test.ts) is a Vitest suite.
    exclude: [...configDefaults.exclude, 'e2e/**/*.spec.ts'],
  },
})
