// The generated Supabase types, re-exported from @va/db (types only: the web app never imports its
// server-side client factories).
export type { Database, Json, Tables } from '@va/db'

import type { Tables } from '@va/db'

export type UserRow = Tables<'users'>
export type SessionRow = Tables<'ai_sessions'>

/** A message row as the PWA reads it (the columns `loadSession` selects). */
export type MessageRow = Pick<
  Tables<'ai_messages'>,
  'id' | 'session_id' | 'role' | 'turn_kind' | 'content' | 'parent_id' | 'created_at' | 'stop_reason'
>
