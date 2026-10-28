// The demo tables, typed by hand. `demo_items` and `demo_notes` exist only in the fakes (no
// migration, no generated type: see docs/backlog/core.md CORE-2), so the pack narrows the user
// client to this shape. A real pack reads tables that are in `@va/db`'s generated `Database`
// and needs no cast.
import type { SupabaseClient } from '@supabase/supabase-js'

import type { AuthContext } from '@va/core'

export type DemoItem = {
  id: string
  name: string
  category: string
  price: number
  description: string | null
  updated_at: string
}

export type DemoNote = {
  id: string
  user_id: string
  item_id: string
  text: string
  created_at: string
}

export type DemoDatabase = {
  public: {
    Tables: {
      demo_items: {
        Row: DemoItem
        Insert: Omit<DemoItem, 'id' | 'updated_at'>
        Update: Partial<DemoItem>
        Relationships: []
      }
      demo_notes: {
        Row: DemoNote
        Insert: Omit<DemoNote, 'id' | 'created_at'>
        Update: Partial<DemoNote>
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

/** The user's RLS client, narrowed to the demo tables. Still the user's JWT: RLS applies. */
export function demoClient(ctx: AuthContext): SupabaseClient<DemoDatabase> {
  return ctx.userClient as unknown as SupabaseClient<DemoDatabase>
}

/**
 * Escapes the LIKE metacharacters so user text never widens an `ilike` pattern. PostgREST also
 * treats `*` in a filter value as `%`, and `\\*` becomes a literal `%`, so `*` cannot be
 * escaped: schemas that feed this must reject it (`NO_STAR`).
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** For zod: a search string PostgREST cannot be made to take literally. */
export const NO_STAR = /^[^*]*$/

/** Voice reads at most this many list items aloud. */
export const VOICE_MAX_ITEMS = 5

/** Clips free text for speech. */
export function clip(text: string | null, max = 160): string | null {
  if (text === null) return null
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
