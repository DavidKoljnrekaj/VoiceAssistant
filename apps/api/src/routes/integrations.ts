// Connecting Outlook (Part 13a, decision 0016). The PWA asks `start` for Microsoft's authorize
// URL and sends the browser there; Microsoft sends it back to `callback` with a code and the
// state. The callback is the one route without a bearer token: who is connecting is the
// single-use state (user id + PKCE verifier, ten minutes), the profile is re-read from that id,
// and the mailbox's UPN must equal the user's email, so a user connects their own mailbox and
// nobody else's. The tokens go straight from Microsoft to the sealed row; the browser only ever
// sees the redirect back to Settings with `connected=1` or `connect_error=<code>`.
import type { Context } from 'hono'
import { Hono } from 'hono'

import { log } from '@va/core'
import { createServiceClient } from '@va/db'
import { disconnectMicrosoft, listConnections, newPkce } from '@va/integrations'

import type { AppDeps, AppEnv } from '../deps.js'
import { fail } from '../errors.js'
import { ownsMailbox } from '../integrations/identity.js'

/** Why a connect did not finish, as the PWA's Settings reads it from the query. */
export type ConnectError = 'state_invalid' | 'denied' | 'exchange_failed' | 'account_mismatch' | 'failed'

export function integrationsRoute(deps: AppDeps): Hono<AppEnv> {
  const ms = deps.microsoft

  return (
    new Hono<AppEnv>()
      .get('/integrations', async (c) => {
        const ctx = c.get('ctx')
        try {
          const integrations = await listConnections(ctx.userClient, c.req.raw.signal)
          return c.json({ available: { microsoft: ms !== null }, integrations })
        } catch {
          log('error', '[api]', 'integrations lookup failed', {
            request_id: c.get('requestId'),
            user_id: ctx.userId,
          })
          return fail(c, 'internal_error')
        }
      })

      .get('/integrations/microsoft/start', (c) => {
        // Hono answers HEAD with the GET handler: a HEAD must not issue a state.
        if (c.req.method === 'HEAD') return fail(c, 'method_not_allowed')
        if (!ms) return fail(c, 'integration_unavailable')
        const ctx = c.get('ctx')
        const pkce = newPkce()
        const state = ms.states.issue(ctx.userId, pkce.verifier)
        log('info', '[api]', 'microsoft connect started', {
          request_id: c.get('requestId'),
          user_id: ctx.userId,
        })
        c.header('Cache-Control', 'no-store')
        return c.json({ url: ms.oauth.authorizeUrl({ state, challenge: pkce.challenge }) })
      })

      .get('/integrations/microsoft/callback', async (c) => {
        // A link scanner's HEAD must not spend the state or exchange the code.
        if (c.req.method === 'HEAD') return fail(c, 'method_not_allowed')
        if (!ms) return fail(c, 'integration_unavailable')
        const requestId = c.get('requestId')
        const back = (outcome: { connected: true } | { error: ConnectError }, userId: string | null) => {
          if ('error' in outcome)
            log('warn', '[api]', 'microsoft connect refused', {
              request_id: requestId,
              user_id: userId,
              reason: outcome.error,
            })
          return backToSettings(c, ms.webAppUrl, outcome)
        }

        // The state is consumed first, whatever else the query says: it never works twice.
        const state = c.req.query('state')
        const pending = state ? ms.states.take(state) : null
        if (!pending) return back({ error: 'state_invalid' }, null)
        const { userId } = pending
        const msError = c.req.query('error')
        if (msError)
          return back({ error: msError === 'access_denied' ? 'denied' : 'exchange_failed' }, userId)
        const code = c.req.query('code')
        if (!code) return back({ error: 'exchange_failed' }, userId)

        const signal = c.req.raw.signal
        let tokens, account
        try {
          tokens = await ms.oauth.exchangeCode(code, pending.verifier, signal)
          account = await ms.oauth.readAccount(tokens.accessToken, signal)
        } catch {
          return back({ error: 'exchange_failed' }, userId)
        }

        // Identity is re-read now (invariant 7), from the id the state was issued to.
        const service = createServiceClient()
        const owner = await ownsMailbox(service, userId, account.upn, signal)
        if (owner !== 'ok') {
          if (owner !== 'mismatch')
            log('error', '[api]', 'connect identity check failed', {
              request_id: requestId,
              user_id: userId,
              reason: owner,
            })
          return back({ error: owner === 'mismatch' ? 'account_mismatch' : 'failed' }, userId)
        }

        try {
          await ms.tokens.saveConnection(service, userId, { account: account.upn, tokens }, signal)
        } catch {
          return back({ error: 'failed' }, userId)
        }
        log('info', '[api]', 'microsoft connected', { request_id: requestId, user_id: userId })
        return back({ connected: true }, userId)
      })

      // Works without the MS_ variables too: deleting our copy needs no key and no secret.
      .delete('/integrations/microsoft', async (c) => {
        const ctx = c.get('ctx')
        try {
          await disconnectMicrosoft(ctx.serviceClient, ctx.userId, c.req.raw.signal)
        } catch {
          return fail(c, 'internal_error')
        }
        log('info', '[api]', 'microsoft disconnected', {
          request_id: c.get('requestId'),
          user_id: ctx.userId,
        })
        return c.body(null, 204)
      })
  )
}

function backToSettings(
  c: Context<AppEnv>,
  webAppUrl: string,
  outcome: { connected: true } | { error: ConnectError },
): Response {
  const query = 'error' in outcome ? `connect_error=${outcome.error}` : 'connected=1'
  // The callback URL carried a code: nothing caches it and the next page is not told it.
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.redirect(`${webAppUrl}/settings?${query}`, 302)
}
