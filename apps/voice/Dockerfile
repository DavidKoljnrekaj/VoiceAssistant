# syntax=docker/dockerfile:1
# Multi-stage: install the workspace with the frozen lockfile, then run the worker with its
# workspace packages. The workspace packages export their TypeScript sources, so the runtime
# image runs through tsx rather than a tsc build (docs/backlog/ops.md OPS-1), like the API's.
# The native pieces (onnxruntime-node for Silero, @livekit/rtc-node) are prebuilt for linux-x64;
# their build scripts are allowed through `pnpm.onlyBuiltDependencies` in the root package.json.
# The worker is an outbound WebSocket client of LiveKit Cloud: no port is exposed.
FROM node:25-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/voice/package.json apps/voice/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/tools-demo/package.json packages/tools-demo/
RUN pnpm install --frozen-lockfile --filter @va/voice...

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/voice/node_modules ./apps/voice/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/tools-demo/node_modules ./packages/tools-demo/node_modules
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/voice ./apps/voice
COPY packages/core ./packages/core
COPY packages/db ./packages/db
COPY packages/tools-demo ./packages/tools-demo
RUN pnpm --filter @va/voice typecheck
RUN mkdir -p apps/voice/logs && chown node apps/voice/logs
USER node
WORKDIR /app/apps/voice
CMD ["node", "--import", "tsx", "src/agent.ts", "start"]
