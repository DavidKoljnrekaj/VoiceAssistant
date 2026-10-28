# Backlog — ops

Ids: OPS-3 (next free)

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

### OPS-2 · Low · `pnpm.overrides` pin `sharp` and `adm-zip` for the production audit

- **Check:** Confirmed
- **Where:** root `package.json` → `pnpm.overrides` (`sharp` 0.35.5, `adm-zip` 0.6.1)
- **What happens:** `@livekit/agents` 1.9.2 pins `sharp` 0.35.4 and `onnxruntime-node` 1.24.3
  depends on `adm-zip` 0.5.x, both with high advisories; the overrides lift them so
  `pnpm audit --prod --audit-level=high` passes. An override hides a future bump upstream
- **Fix direction:** drop each override when the dependency that pulls it moves past the patched
  version (`@livekit/agents` ≥ 1.9.3 pins `sharp` 0.35.5; watch `onnxruntime-node`)

## Resolved

Nothing yet.
