// Row shapes are `type`s, not interfaces: supabase-js's typed query parser needs the implicit
// index signature an interface lacks, or every query collapses to `never`.
// `voice_caller_identities` typed by hand until `20261103120000_phone_channel.sql` is on the dev
// project and `/db-types` regenerates `packages/db/src/database.ts` (docs/backlog/release.md
// REL-10); the precedent is the demo pack's former `DemoDatabase` cast. Drop this file's types
// for the generated ones then: the shapes below are the migration's columns.
import type { SupabaseClient } from '@supabase/supabase-js'

import type { DbClient } from '@va/db'

export type CallerIdentityRow = {
  id: string
  user_id: string
  phone_e164: string
  label: string | null
  pin_hash: string | null
  pin_failed_attempts: number
  pin_locked_until: string | null
  active: boolean
  created_at: string
  created_by: string | null
}

type UserRow = {
  id: string
  auth_user_id: string
  email: string | null
  role: string
}

type SessionRow = {
  id: string
  user_id: string
  channel: string
  external_id: string | null
  title: string | null
  caller_identity_id: string | null
  created_at: string
  updated_at: string
}

type Table<R, Required extends keyof R> = {
  Row: R
  Insert: Pick<R, Required> & Partial<R>
  Update: Partial<R>
}

export type PhoneDatabase = {
  public: {
    Tables: {
      voice_caller_identities: Table<CallerIdentityRow, 'user_id' | 'phone_e164'> & {
        Relationships: [
          {
            foreignKeyName: 'voice_caller_identities_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'voice_caller_identities_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      users: Table<UserRow, 'auth_user_id'> & { Relationships: [] }
      /** Only for the insert with `caller_identity_id`, which the generated types lack until `REL-10`. */
      ai_sessions: Table<SessionRow, 'user_id'> & { Relationships: [] }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

/** The service client, narrowed to the phone channel's tables. Still the service role: every
 * query filters by the number or the identity id. */
export function phoneDb(service: DbClient): SupabaseClient<PhoneDatabase> {
  return service as unknown as SupabaseClient<PhoneDatabase>
}
