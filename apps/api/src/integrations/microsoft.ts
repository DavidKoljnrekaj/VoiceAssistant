// The Microsoft connection's dependencies, built once from the environment; null when the
// MS_ variables are not set (the env schema allows all or none).
import {
  createMicrosoftOAuth,
  createTokenStore,
  parseIntegrationsKey,
  type MicrosoftOAuth,
  type TokenStore,
} from '@va/integrations'

import type { ApiEnv } from '../env.js'
import { memoryStateStore, type OAuthStateStore } from './state.js'

export interface MicrosoftDeps {
  oauth: MicrosoftOAuth
  tokens: TokenStore
  states: OAuthStateStore
  /** The PWA's origin, where the callback sends the browser back. */
  webAppUrl: string
}

export function createMicrosoft(
  env: ApiEnv,
  clock: () => Date,
  fetchImpl: typeof fetch = fetch,
): MicrosoftDeps | null {
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI, INTEGRATIONS_KEY, WEB_APP_URL } = env
  if (
    !MS_TENANT_ID ||
    !MS_CLIENT_ID ||
    !MS_CLIENT_SECRET ||
    !MS_REDIRECT_URI ||
    !INTEGRATIONS_KEY ||
    !WEB_APP_URL
  )
    return null
  const oauth = createMicrosoftOAuth({
    tenantId: MS_TENANT_ID,
    clientId: MS_CLIENT_ID,
    clientSecret: MS_CLIENT_SECRET,
    redirectUri: MS_REDIRECT_URI,
    fetch: fetchImpl,
    clock,
  })
  return {
    oauth,
    tokens: createTokenStore({ keys: parseIntegrationsKey(INTEGRATIONS_KEY), oauth, clock }),
    states: memoryStateStore(clock),
    webAppUrl: WEB_APP_URL,
  }
}
