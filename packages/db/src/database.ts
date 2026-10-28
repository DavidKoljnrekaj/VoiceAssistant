export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      ai_messages: {
        Row: {
          cache_read_tokens: number | null
          cache_write_tokens: number | null
          content: Json
          created_at: string
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          parent_id: string | null
          role: string
          session_id: string
          stop_reason: string | null
          turn_kind: string
        }
        Insert: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          content: Json
          created_at?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          parent_id?: string | null
          role: string
          session_id: string
          stop_reason?: string | null
          turn_kind: string
        }
        Update: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          content?: Json
          created_at?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          parent_id?: string | null
          role?: string
          session_id?: string
          stop_reason?: string | null
          turn_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ai_messages_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'ai_messages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ai_messages_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'ai_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      ai_sessions: {
        Row: {
          channel: string
          context_summary: string | null
          created_at: string
          external_id: string | null
          id: string
          summary_through_message_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: string
          context_summary?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          summary_through_message_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          context_summary?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          summary_through_message_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ai_sessions_summary_fk'
            columns: ['summary_through_message_id']
            isOneToOne: false
            referencedRelation: 'ai_messages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ai_sessions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      users: {
        Row: {
          auth_user_id: string
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          language: string
          phone_e164: string | null
          role: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          language?: string
          phone_e164?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          language?: string
          phone_e164?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      voice_calls: {
        Row: {
          access_token: string
          call_token_hash: string
          created_at: string
          expires_at: string
          id: string
          last_seen_at: string
          platform_call_id: string | null
          session_id: string
          user_id: string
        }
        Insert: {
          access_token: string
          call_token_hash: string
          created_at?: string
          expires_at: string
          id?: string
          last_seen_at?: string
          platform_call_id?: string | null
          session_id: string
          user_id: string
        }
        Update: {
          access_token?: string
          call_token_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_seen_at?: string
          platform_call_id?: string | null
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'voice_calls_session_id_fkey'
            columns: ['session_id']
            isOneToOne: true
            referencedRelation: 'ai_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'voice_calls_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_session_history: {
        Args: { p_leaf_id: string; p_max_rows?: number }
        Returns: {
          cache_read_tokens: number | null
          cache_write_tokens: number | null
          content: Json
          created_at: string
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          parent_id: string | null
          role: string
          session_id: string
          stop_reason: string | null
          turn_kind: string
        }[]
        SetofOptions: {
          from: '*'
          to: 'ai_messages'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      app_user_id: { Args: never; Returns: string }
      app_user_role: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
