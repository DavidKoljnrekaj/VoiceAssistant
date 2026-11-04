// The mail pack's token provider for this process: `tokenFor` of @va/integrations, so the pack
// never sees a refresh token or the key (decision 0016). The read goes through the service
// client with the user's own id as the filter (docs/SECURITY.md → The service role). Without
// the MS_ variables every mail tool answers outlook_unavailable.
import { IntegrationError, type TokenStore } from '@va/integrations'
import { MailAccessError, type MailTokenProvider } from '@va/tools-mail'

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
