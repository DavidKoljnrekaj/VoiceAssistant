// The chat channel's MessageStore: one insert per row, through the service client, scoped to
// the session the request resolved (invariant 6).
import type { AuthContext, MessageStore } from '@va/core'

export function dbMessageStore(ctx: AuthContext, sessionId: string): MessageStore {
  return {
    async insert(row) {
      const { data, error } = await ctx.serviceClient
        .from('ai_messages')
        .insert({ session_id: sessionId, ...row })
        .select('id')
        .single()
      return { id: data?.id ?? null, ...(error ? { code: error.code } : {}) }
    },
  }
}
