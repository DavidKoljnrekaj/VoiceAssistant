// The seeded world every scenario starts from: two users (admin, member), the member's chat
// session with a three-row chain (as `supabase/seed.sql`), the `demo_items` the demo pack reads,
// and the `ai_session_history` RPC.
import type { FakeSupabase, Row } from './fake-supabase.js'

export const ANON_KEY = 'fake-anon-key'
export const SERVICE_ROLE_KEY = 'fake-service-role-key'

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const TOKENS = {
  admin: 'tok-admin',
  member: 'tok-member',
  /** A valid auth user with no `public.users` row. */
  orphan: 'tok-orphan',
} as const

export const USERS = {
  admin: { id: uuid(101), authId: uuid(201), role: 'admin', email: 'admin@va.test', language: 'hr' },
  member: { id: uuid(102), authId: uuid(202), role: 'member', email: 'member@va.test', language: 'hr' },
} as const
const ORPHAN_AUTH_ID = uuid(299)

/** The member's chat session: user → assistant (tool_use) → tool_result. */
export const SESSION_MEMBER_CHAT = uuid(301)
export const MSG_USER = uuid(401)
export const MSG_ASSISTANT = uuid(402)
export const MSG_TOOL_RESULT = uuid(403)

export const ITEMS = {
  lamp: { id: uuid(501), name: 'Stolna lampa', category: 'furniture', price: 49.9 },
  desk: { id: uuid(502), name: 'Radni stol', category: 'furniture', price: 320 },
  chair: { id: uuid(503), name: 'Uredska stolica', category: 'furniture', price: 189.5 },
  laptop: { id: uuid(504), name: 'Prijenosno računalo', category: 'it', price: 1299 },
  screen: { id: uuid(505), name: 'Monitor 27"', category: 'it', price: 275 },
  /** Names with LIKE metacharacters, so an unescaped pattern matches more than it should. */
  coupon: { id: uuid(506), name: 'Kupon 100% popusta', category: 'promo', price: 0 },
  bulk: { id: uuid(507), name: 'Kutija 100 komada', category: 'promo', price: 12 },
  cable: { id: uuid(508), name: 'Kabel 1_5 m', category: 'it', price: 4.5 },
  cable2: { id: uuid(509), name: 'Kabel 125 m', category: 'it', price: 60 },
} as const

export function seedWorld(db: FakeSupabase): void {
  db.authUsers[TOKENS.admin] = { id: USERS.admin.authId, email: USERS.admin.email }
  db.authUsers[TOKENS.member] = { id: USERS.member.authId, email: USERS.member.email }
  db.authUsers[TOKENS.orphan] = { id: ORPHAN_AUTH_ID, email: 'nitko@va.test' }
  db.seed(
    'users',
    Object.values(USERS).map((u) => ({
      id: u.id,
      auth_user_id: u.authId,
      role: u.role,
      email: u.email,
      language: u.language,
    })),
  )
  db.seed('ai_sessions', [
    { id: SESSION_MEMBER_CHAT, user_id: USERS.member.id, channel: 'chat', title: 'Probni razgovor' },
  ])
  db.seed('ai_messages', [
    {
      id: MSG_USER,
      session_id: SESSION_MEMBER_CHAT,
      role: 'user',
      turn_kind: 'user',
      content: [{ type: 'text', text: 'Koliko je sati?' }],
      parent_id: null,
    },
    {
      id: MSG_ASSISTANT,
      session_id: SESSION_MEMBER_CHAT,
      role: 'assistant',
      turn_kind: 'assistant',
      content: [
        { type: 'text', text: 'Provjeravam.' },
        { type: 'tool_use', id: 'toolu_seed_01', name: 'current_time', input: {} },
      ],
      parent_id: MSG_USER,
      model: 'claude-opus-5-5',
      input_tokens: 1200,
      output_tokens: 40,
      cache_read_tokens: 1000,
      cache_write_tokens: 0,
      stop_reason: 'tool_use',
    },
    {
      id: MSG_TOOL_RESULT,
      session_id: SESSION_MEMBER_CHAT,
      role: 'user',
      turn_kind: 'tool_result',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_seed_01', content: '2026-10-28T10:00:00+01:00' }],
      parent_id: MSG_ASSISTANT,
    },
  ])
  db.seed(
    'demo_items',
    Object.values(ITEMS).map((i) => ({
      ...i,
      description: `Opis: ${i.name}`,
      updated_at: '2026-10-01T08:00:00.000Z',
    })),
  )
  db.rpcs.ai_session_history = (args) => sessionHistory(db, args)
}

/** `ai_session_history(p_leaf_id, p_max_rows)`: the active branch root → leaf, bounded, stopping
 * after the session's summary boundary, never crossing into another session. */
function sessionHistory(db: FakeSupabase, args: Row): Row[] {
  const leafId = args.p_leaf_id as string
  const max = (args.p_max_rows as number | undefined) ?? 200
  const messages = db.rows('ai_messages')
  const leaf = messages.find((m) => m.id === leafId)
  if (!leaf) return []
  const session = db.rows('ai_sessions').find((s) => s.id === leaf.session_id)
  const boundary = session?.summary_through_message_id ?? null
  const chain: Row[] = []
  let cur: Row | undefined = leaf
  while (cur && chain.length < max) {
    chain.push(cur)
    if (cur.id === boundary) break
    const parentId: unknown = cur.parent_id
    cur = parentId ? messages.find((m) => m.id === parentId && m.session_id === leaf.session_id) : undefined
  }
  return chain.reverse()
}
