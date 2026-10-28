// The two Supabase clients the apps use. Neither keeps a session: the API and the voice worker
// are servers, and the user's JWT arrives with every request (CLAUDE.md invariants 6 and 7).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from './database.js'
import { getDbEnv } from './env.js'

export type DbClient = SupabaseClient<Database>

const serverAuth = { persistSession: false, autoRefreshToken: false } as const

/**
 * A client that acts as the user: the anon key plus the user's JWT, so every table read goes
 * through RLS. Tools read through this one (`ctx.userClient`).
 */
export function createUserClient(jwt: string): DbClient {
  const env = getDbEnv()
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: serverAuth,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
}

/**
 * A client with the service role: bypasses RLS. For persistence only, and every call carries an
 * explicit `user_id` or `session_id` filter (`ctx.serviceClient`).
 */
export function createServiceClient(): DbClient {
  const env = getDbEnv()
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: serverAuth,
  })
}
