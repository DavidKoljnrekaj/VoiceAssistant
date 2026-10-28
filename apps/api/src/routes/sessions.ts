// The PWA reads sessions and messages through supabase-js (RLS); the API only mutates. Both
// writes go through the service role with a user_id filter, and a filtered write that touches
// zero rows is a 404, never a silent success.
import { Hono } from 'hono'
import { z } from 'zod'

import { log } from '@va/core'

import type { AppEnv } from '../deps.js'
import { fail } from '../errors.js'

const idSchema = z.uuid()
const patchSchema = z.object({ title: z.string().trim().min(1).max(200) })

export function sessionsRoute(): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .patch('/sessions/:id', async (c) => {
      const id = idSchema.safeParse(c.req.param('id'))
      if (!id.success) return fail(c, 'session_not_found')
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return fail(c, 'bad_request')
      }
      const parsed = patchSchema.safeParse(body)
      if (!parsed.success) return fail(c, 'bad_request')
      const ctx = c.get('ctx')
      const { data, error } = await ctx.serviceClient
        .from('ai_sessions')
        .update({ title: parsed.data.title })
        .eq('id', id.data)
        .eq('user_id', ctx.userId)
        .select('id')
      if (error) {
        log('error', '[api]', 'session update failed', {
          request_id: c.get('requestId'),
          user_id: ctx.userId,
          session_id: id.data,
          code: error.code,
        })
        return fail(c, 'internal_error')
      }
      if (!assertRowsAffected(data)) return fail(c, 'session_not_found')
      return c.json({ ok: true })
    })
    .delete('/sessions/:id', async (c) => {
      const id = idSchema.safeParse(c.req.param('id'))
      if (!id.success) return fail(c, 'session_not_found')
      const ctx = c.get('ctx')
      const { data, error } = await ctx.serviceClient
        .from('ai_sessions')
        .delete()
        .eq('id', id.data)
        .eq('user_id', ctx.userId)
        .select('id')
      if (error) {
        log('error', '[api]', 'session delete failed', {
          request_id: c.get('requestId'),
          user_id: ctx.userId,
          session_id: id.data,
          code: error.code,
        })
        return fail(c, 'internal_error')
      }
      if (!assertRowsAffected(data)) return fail(c, 'session_not_found')
      return c.json({ ok: true })
    })
}

/** True when a filtered update or delete returned at least one row. */
export function assertRowsAffected(rows: unknown[] | null): boolean {
  return Array.isArray(rows) && rows.length > 0
}
