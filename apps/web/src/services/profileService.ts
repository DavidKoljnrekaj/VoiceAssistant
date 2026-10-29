// The `users` profile: the self-read every session starts with, and the one client write RLS
// allows (`language`, and `display_name`).
import { supabase } from '../lib/supabase'
import type { UserRow } from '../types/database'

export type Profile = Pick<UserRow, 'id' | 'auth_user_id' | 'email' | 'display_name' | 'role' | 'language'>

/** The caller's profile row, or null when the auth user has none (`no_profile`). Throws on a failed read. */
export async function loadProfile(authUserId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, auth_user_id, email, display_name, role, language')
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function updateLanguage(userId: string, language: string): Promise<void> {
  const { data, error } = await supabase.from('users').update({ language }).eq('id', userId).select('id')
  if (error) throw error
  if (data.length === 0) throw new Error('profile not updated')
}
