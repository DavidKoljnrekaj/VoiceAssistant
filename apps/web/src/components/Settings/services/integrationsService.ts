// The Outlook connection against the API (docs/API.md → Integrations): its state, the start of a
// connect (the API answers Microsoft's authorize URL; the browser goes there and Microsoft sends
// it back to Settings through the API's callback), and disconnecting. No token ever reaches the
// browser.
import { apiFetch, apiJson } from '../../../lib/api'

export type ConnectionStatus = 'active' | 'reauth_required' | 'revoked'

export interface Connection {
  provider: 'microsoft'
  account: string
  status: ConnectionStatus
  connected_at: string
}

export interface IntegrationsState {
  available: { microsoft: boolean }
  integrations: Connection[]
}

/** Why a connect did not finish, as the callback puts it in `?connect_error=`. */
export const CONNECT_ERRORS = [
  'state_invalid',
  'denied',
  'exchange_failed',
  'account_mismatch',
  'failed',
] as const
export type ConnectError = (typeof CONNECT_ERRORS)[number]

const MICROSOFT_LOGIN = 'https://login.microsoftonline.com'

export async function loadIntegrations(): Promise<IntegrationsState> {
  return apiJson<IntegrationsState>('/integrations')
}

/** Microsoft's authorize URL for this user's connect; anything but Microsoft's sign-in is refused. */
export async function startOutlookConnect(): Promise<string> {
  const { url } = await apiJson<{ url: string }>('/integrations/microsoft/start')
  if (new URL(url).origin !== MICROSOFT_LOGIN) throw new Error('unexpected authorize URL')
  return url
}

export async function disconnectOutlook(): Promise<void> {
  await apiFetch('/integrations/microsoft', { method: 'DELETE' })
}
