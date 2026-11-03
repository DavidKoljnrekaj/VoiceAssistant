// The caller's JWT for a phone call. No browser signed in, and the project signs tokens with a
// key the worker does not hold (decision 0013), so the worker asks GoTrue for a session the way
// a magic link would: `generateLink` with the service role, then `verifyOtp` on an anon client.
// The link's hash and the tokens are never logged; the refresh token is dropped; the session is
// revoked at hang-up so nothing outlives the call (docs/plan/11-phone-channel.md §4).
import type { DbClient } from '@va/db'

export interface CallerSession {
  accessToken: string
  /** GoTrue's `expires_at`, in ms. The call's row caps it at 15 minutes anyway. */
  expiresAtMs: number
}

export async function createCallerSession(
  service: DbClient,
  anon: DbClient,
  email: string,
): Promise<CallerSession> {
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error)
    throw new Error(`generate_link failed: ${link.error.status ?? 0} ${link.error.code ?? ''}`.trim())
  const hashed = link.data.properties?.hashed_token
  if (!hashed) throw new Error('generate_link returned no token hash')
  const verified = await anon.auth.verifyOtp({ token_hash: hashed, type: 'magiclink' })
  if (verified.error) {
    throw new Error(`verify failed: ${verified.error.status ?? 0} ${verified.error.code ?? ''}`.trim())
  }
  const session = verified.data.session
  if (!session) throw new Error('verify returned no session')
  return {
    accessToken: session.access_token,
    expiresAtMs: session.expires_at ? session.expires_at * 1000 : Date.now() + session.expires_in * 1000,
  }
}

/** Revokes the call's session. Idempotent from the caller's point of view: a token GoTrue no
 * longer knows (expired, already revoked) is a success. */
export async function revokeCallerSession(service: DbClient, accessToken: string): Promise<void> {
  const { error } = await service.auth.admin.signOut(accessToken, 'local')
  if (error && error.status !== 401 && error.status !== 403 && error.status !== 404) {
    throw new Error(`logout failed: ${error.status ?? 0} ${error.code ?? ''}`.trim())
  }
}
