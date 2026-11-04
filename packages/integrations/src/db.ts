// `user_integrations`, typed by hand until `/db-types` runs with its migration applied (REL-12);
// then the generated `Database` replaces `IntegrationsDatabase` and the cast goes.
import type { SupabaseClient } from '@supabase/supabase-js'

import type { DbClient } from '@va/db'

export type Provider = 'microsoft'
export type IntegrationStatus = 'active' | 'reauth_required' | 'revoked'

export type IntegrationRow = {
  id: string
  user_id: string
  provider: Provider
  account: string
  scopes: string[]
  refresh_token_enc: string | null
  access_token_enc: string | null
  access_expires_at: string | null
  status: IntegrationStatus
  last_error_code: string | null
  connected_at: string
  updated_at: string
}

type IntegrationsDatabase = {
  public: {
    Tables: {
      user_integrations: {
        Row: IntegrationRow
        Insert: Pick<IntegrationRow, 'user_id' | 'provider' | 'account' | 'scopes'> & Partial<IntegrationRow>
        Update: Partial<IntegrationRow>
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export function integrations(client: DbClient) {
  return (client as unknown as SupabaseClient<IntegrationsDatabase>).from('user_integrations')
}
