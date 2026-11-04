// What a caller of the token store can be told. A tool maps these to its own result
// (`outlook_not_connected` in 13b); the API maps them to its error envelope.
export type IntegrationErrorCode =
  | 'not_connected'
  | 'reauth_required'
  | 'refresh_failed'
  | 'misconfigured'
  | 'token_unreadable'
  | 'store_failed'

export class IntegrationError extends Error {
  constructor(readonly code: IntegrationErrorCode) {
    super(`integration: ${code}`)
    this.name = 'IntegrationError'
  }
}
