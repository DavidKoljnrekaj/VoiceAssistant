import { configDefaults, defineProject } from 'vitest/config'

export default defineProject({
  test: {
    environment: 'node',
    // The Playwright smoke in e2e/ is run by `pnpm --filter @va/web test:e2e`, never by Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
