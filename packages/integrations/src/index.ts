// @va/integrations: connections to outside services, shared by the API and the voice worker.
// The public surface is what docs/MAIL.md lists.
export { listConnections, type ConnectionState } from './connections.js'
export { open, parseIntegrationsKey, seal, SealError, tokenAad, type IntegrationsKeys } from './crypto.js'
export type { IntegrationStatus, Provider } from './db.js'
export { IntegrationError, type IntegrationErrorCode } from './errors.js'
export {
  createMicrosoftOAuth,
  MICROSOFT_SCOPES,
  MicrosoftOAuthError,
  newPkce,
  type MicrosoftAccount,
  type MicrosoftOAuth,
  type MicrosoftOAuthConfig,
  type MicrosoftOAuthErrorKind,
  type Pkce,
  type TokenSet,
} from './microsoft/oauth.js'
export {
  createTokenStore,
  disconnectMicrosoft,
  REFRESH_MARGIN_MS,
  type TokenForOptions,
  type TokenStore,
  type TokenStoreConfig,
} from './microsoft/tokens.js'
