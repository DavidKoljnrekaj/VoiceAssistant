import { cors } from 'hono/cors'

import { type ApiEnv, corsOrigins } from '../env.js'

export const corsMiddleware = (env: Pick<ApiEnv, 'CORS_ORIGINS'>) =>
  cors({
    origin: corsOrigins(env),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 600,
  })
