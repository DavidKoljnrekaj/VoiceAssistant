// Whose mailbox may this user connect? Their own: the UPN Microsoft vouches for must equal the
// address the assistant account was created for, and that address must be one GoTrue confirmed
// (a sign-up that claimed a colleague's address and never confirmed it connects nothing). The
// profile and the auth user are both re-read now (invariant 7); a banned user connects nothing.
// ASCII only: case folding of other characters (the Kelvin sign is a "k") is not compared.
import type { DbClient } from '@va/db'

export type MailboxOwnership = 'ok' | 'mismatch' | 'no_profile' | 'lookup_failed'

const ASCII = /^[\x21-\x7e]+$/

export async function ownsMailbox(
  service: DbClient,
  userId: string,
  upn: string,
  signal: AbortSignal,
): Promise<MailboxOwnership> {
  const { data: profile, error } = await service
    .from('users')
    .select('auth_user_id, email')
    .eq('id', userId)
    .abortSignal(signal)
    .maybeSingle()
  if (error) return 'lookup_failed'
  if (!profile) return 'no_profile'
  const { data, error: authError } = await service.auth.admin.getUserById(profile.auth_user_id)
  if (authError && authError.status === 404) return 'no_profile'
  if (authError || !data.user) return 'lookup_failed'
  const auth = data.user
  if (!auth.email_confirmed_at) return 'mismatch'
  if (auth.banned_until && Date.parse(auth.banned_until) > Date.now()) return 'mismatch'
  const want = normalise(upn)
  return want !== null && normalise(profile.email) === want && normalise(auth.email) === want
    ? 'ok'
    : 'mismatch'
}

function normalise(address: string | null | undefined): string | null {
  const a = address?.trim() ?? ''
  return ASCII.test(a) ? a.toLowerCase() : null
}
