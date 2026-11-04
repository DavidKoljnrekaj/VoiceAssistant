// The worker's Outlook access (Part 13b): its own token store over the same rows and key as the
// API's, refresh only (the connect flow is the API's), and the mail pack's token provider over
// it. The same adapter as apps/api/src/mail.ts: an app composes the pack, the pack never imports
// @va/integrations (decision 0016).
import {
  createMicrosoftOAuth,
  createTokenStore,
  IntegrationError,
  parseIntegrationsKey,
  type TokenStore,
} from '@va/integrations'
import { MailAccessError, type MailTokenProvider } from '@va/tools-mail'

import type { VoiceEnv } from './env.js'

/** Null without the MS_ variables: the mail tools then answer outlook_unavailable. */
export function createVoiceTokenStore(env: VoiceEnv, clock: () => Date): TokenStore | null {
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, INTEGRATIONS_KEY } = env
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET || !INTEGRATIONS_KEY) return null
  const oauth = createMicrosoftOAuth({
    tenantId: MS_TENANT_ID,
    clientId: MS_CLIENT_ID,
    clientSecret: MS_CLIENT_SECRET,
    clock,
  })
  return createTokenStore({ keys: parseIntegrationsKey(INTEGRATIONS_KEY), oauth, clock })
}

export function mailTokenProvider(tokens: TokenStore | null): MailTokenProvider {
  return async (ctx, { signal, forceRefresh }) => {
    if (!tokens) throw new MailAccessError('unavailable')
    try {
      return await tokens.tokenFor(ctx.serviceClient, ctx.userId, {
        signal,
        ...(forceRefresh ? { forceRefresh: true } : {}),
      })
    } catch (e) {
      if (!(e instanceof IntegrationError)) throw e
      // reauth_required is a reconnect for the user, like never having connected.
      const connected = e.code !== 'not_connected' && e.code !== 'reauth_required'
      throw new MailAccessError(connected ? 'unavailable' : 'not_connected')
    }
  }
}
