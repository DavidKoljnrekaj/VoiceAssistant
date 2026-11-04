// @va/integrations: connections to outside services, shared by the API and the voice worker.
// The public surface is what docs/MAIL.md lists.
export {
  open,
  parseIntegrationsKey,
  seal,
  SealError,
  tokenAad,
  type IntegrationsKeys,
} from './crypto.js'
