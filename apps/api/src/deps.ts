// What `createApp` is given: the real services in index.ts, the fakes in the tests.
import type Anthropic from '@anthropic-ai/sdk'

import type { AuthContext, ToolRegistry } from '@va/core'

import type { ApiEnv } from './env.js'
import type { MicrosoftDeps } from './integrations/microsoft.js'
import type { LiveKitPort } from './voice/livekit.js'

export interface AppDeps {
  anthropic: Anthropic
  registry: ToolRegistry
  env: ApiEnv
  /** Null when the LiveKit variables are not set: voice start answers 500 and writes nothing. */
  livekit: LiveKitPort | null
  /** Null when the MS_ variables are not set: the connect routes answer 503 integration_unavailable. */
  microsoft: MicrosoftDeps | null
  clock: () => Date
}

/** The per-request variables the middleware sets. */
export interface AppVariables {
  requestId: string
  ctx: AuthContext
  jwt: string
  authMs: number
}

export type AppEnv = { Variables: AppVariables }
