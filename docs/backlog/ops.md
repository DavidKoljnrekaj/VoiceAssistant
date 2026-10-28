# Backlog — ops

Ids: OPS-2 (next free)

CI, hooks, env, logging, deploy, dependencies.

## Open

### OPS-1 · Low · The API container runs TypeScript through tsx instead of a built `dist`

- **Check:** Code reading (the image has not been built: Docker builds need a `docker` call the
  harness asks about)
- **Where:** `apps/api/Dockerfile`, the workspace packages' `exports` (`./src/index.ts`)
- **What happens:** `node apps/api/dist/index.js` cannot run because `@va/core`, `@va/db` and
  `@va/tools-demo` resolve to their TypeScript sources with `.js` specifiers; the runtime stage
  therefore runs `node --import tsx apps/api/src/index.ts`, which works but compiles on start
- **Fix direction:** give every workspace package conditional exports (`types` → `src`,
  `default` → `dist`), build them in the image, and switch the CMD to the plan's
  `node apps/api/dist/index.js`; the `build` scripts already emit `dist`

## Resolved

Nothing yet.
