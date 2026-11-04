// @vitest-environment jsdom
// Y scenarios: Settings → Outlook against the fake backend (GoTrue and the API over fetch; the
// real supabase-js and lib/api.ts run). Assertions: the requests sent, where the browser would be
// sent, and what the page shows for each state of the connection.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../contexts/ToastContext'
import i18n from '../../i18n'
import {
  API_ORIGIN,
  apiError,
  type FakeBackend,
  installFakeBackend,
  json,
  signInTestUser,
  signOutTestUser,
} from '../../test/fake-backend'
import SettingsPage from './SettingsPage'

const AUTHORIZE = 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=s'
const CONNECTED = {
  provider: 'microsoft',
  account: 'member@va.test',
  status: 'active',
  connected_at: '2026-11-04T10:00:00Z',
}

let backend: FakeBackend

function integrations(body: unknown) {
  backend.route('GET', API_ORIGIN, '/integrations', () => json(body))
}

/** The router's current query, rendered so the test reads it from the page. */
function Where() {
  return <output data-testid="search">{useLocation().search}</output>
}

function renderPage(path = '/settings', strict = false) {
  const redirect = vi.fn()
  const page = (
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/settings"
            element={
              <>
                <SettingsPage redirect={redirect} />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  )
  render(strict ? <StrictMode>{page}</StrictMode> : page)
  return redirect
}

const t = (key: string, options: Record<string, string> = {}) => i18n.t(key, options)

beforeAll(async () => {
  backend = installFakeBackend()
  await signInTestUser(backend, { id: 'auth-1', email: 'member@va.test' })
})
afterAll(async () => {
  await signOutTestUser()
  backend.restore()
})
beforeEach(() => {
  backend.requests.length = 0
})
afterEach(() => cleanup())

describe('Settings → Outlook', () => {
  it('Y01 not connected: "Poveži Outlook" asks the API to start and sends the browser to Microsoft', async () => {
    integrations({ available: { microsoft: true }, integrations: [] })
    backend.route('GET', API_ORIGIN, '/integrations/microsoft/start', () => json({ url: AUTHORIZE }))
    const redirect = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('settings.outlook.connect') }))
    await waitFor(() => expect(redirect).toHaveBeenCalledWith(AUTHORIZE))
    const [start] = backend.sent('GET', '/integrations/microsoft/start')
    expect(start!.headers.get('Authorization')).toMatch(/^Bearer /)
    expect(screen.getByText(t('settings.outlook.not_connected'))).toBeTruthy()
  })

  it('Y02 connected: the account and "Odspoji", which asks first, then deletes and shows not connected', async () => {
    integrations({ available: { microsoft: true }, integrations: [CONNECTED] })
    backend.route('DELETE', API_ORIGIN, '/integrations/microsoft', () => {
      integrations({ available: { microsoft: true }, integrations: [{ ...CONNECTED, status: 'revoked' }] })
      return new Response(null, { status: 204 })
    })
    renderPage()
    expect(
      await screen.findByText(t('settings.outlook.connected_as', { account: CONNECTED.account })),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('settings.outlook.disconnect') }))
    expect(backend.sent('DELETE', '/integrations/microsoft')).toHaveLength(0)
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      [...dialog.querySelectorAll('button')].find((b) => b.textContent === t('settings.outlook.disconnect'))!,
    )
    await screen.findByText(t('settings.outlook.not_connected'))
    expect(backend.sent('DELETE', '/integrations/microsoft')).toHaveLength(1)
    expect(await screen.findByText(t('settings.outlook.disconnected_toast'))).toBeTruthy()
  })

  it('Y03 reauth_required offers "Ponovno poveži"; unavailable offers nothing', async () => {
    integrations({
      available: { microsoft: true },
      integrations: [{ ...CONNECTED, status: 'reauth_required' }],
    })
    renderPage()
    expect(await screen.findByText(t('settings.outlook.reauth_required'))).toBeTruthy()
    expect(screen.getByRole('button', { name: t('settings.outlook.reconnect') })).toBeTruthy()
    cleanup()
    integrations({ available: { microsoft: false }, integrations: [] })
    renderPage()
    expect(await screen.findByText(t('settings.outlook.unavailable'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: t('settings.outlook.connect') })).toBeNull()
  })

  it('Y04 a failed load is an error with retry, never "not connected"', async () => {
    backend.route('GET', API_ORIGIN, '/integrations', () => apiError(500, 'internal_error', 'Greška.'))
    renderPage()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(t('settings.outlook.not_connected'))).toBeNull()
    integrations({ available: { microsoft: true }, integrations: [] })
    fireEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByText(t('settings.outlook.not_connected'))).toBeTruthy()
  })

  it('Y05 back from Microsoft: connected=1 and each connect_error are said once and the query is dropped', async () => {
    integrations({ available: { microsoft: true }, integrations: [CONNECTED] })
    renderPage('/settings?connected=1')
    expect(await screen.findByText(t('settings.outlook.connected_toast'))).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    cleanup()
    renderPage('/settings?connect_error=account_mismatch')
    expect(await screen.findByText(t('settings.outlook.errors.account_mismatch'))).toBeTruthy()
    cleanup()
    renderPage('/settings?connect_error=<script>')
    expect(await screen.findByText(t('settings.outlook.errors.unknown'))).toBeTruthy()
  })

  it("Y06 an authorize URL that is not Microsoft's sign-in is not followed", async () => {
    integrations({ available: { microsoft: true }, integrations: [] })
    backend.route('GET', API_ORIGIN, '/integrations/microsoft/start', () =>
      json({ url: 'https://evil.test/login' }),
    )
    const redirect = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('settings.outlook.connect') }))
    expect(await screen.findByText(t('settings.outlook.action_failed'))).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('Y07 under StrictMode (as in main.tsx) the result of a connect is said once', async () => {
    integrations({ available: { microsoft: true }, integrations: [CONNECTED] })
    renderPage('/settings?connected=1', true)
    await screen.findByText(t('settings.outlook.connected_toast'))
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    expect(screen.getAllByText(t('settings.outlook.connected_toast'))).toHaveLength(1)
  })
})
