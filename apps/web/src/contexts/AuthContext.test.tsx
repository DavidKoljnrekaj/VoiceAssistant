// @vitest-environment jsdom
// AuthProvider through renderHook: the real supabase-js client against a fake GoTrue over fetch
// (sign-in, refresh, sign-out), with `profileService` scripted per case. Assertions are on what
// the routes see (`session`, `profile`, `loading`, `authError`) and on the requests made.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '../i18n'
import { supabase } from '../lib/supabase'
import { loadProfile, type Profile, updateLanguage } from '../services/profileService'
import { type FakeBackend, type FakeGoTrue, fakeGoTrue, installFakeBackend } from '../test/fake-backend'
import { AuthProvider, useAuth } from './AuthContext'

vi.mock('../services/profileService', () => ({ loadProfile: vi.fn(), updateLanguage: vi.fn() }))

const AUTH_USER = { id: 'auth-1', email: 'ana@example.com' }
const PROFILE: Profile = {
  id: 'user-1',
  auth_user_id: 'auth-1',
  email: 'ana@example.com',
  display_name: 'Ana',
  role: 'member',
  language: 'hr',
}

let backend: FakeBackend
let gotrue: FakeGoTrue

beforeEach(async () => {
  backend = installFakeBackend()
  gotrue = fakeGoTrue(backend, AUTH_USER)
  vi.mocked(loadProfile).mockReset().mockResolvedValue(PROFILE)
  vi.mocked(updateLanguage).mockReset().mockResolvedValue(undefined)
  await i18n.changeLanguage('hr')
})
afterEach(async () => {
  cleanup()
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  localStorage.clear()
  backend.restore()
})
afterAll(() => supabase.auth.stopAutoRefresh())

const render = () => renderHook(() => useAuth(), { wrapper: AuthProvider })
// 300 ms: longer than waitFor's 50 ms poll, so the state before the retry is observable.
const QuickRetry = ({ children }: { children: ReactNode }) => (
  <AuthProvider profileRetryDelaysMs={[300]}>{children}</AuthProvider>
)
const renderQuickRetry = () => renderHook(() => useAuth(), { wrapper: QuickRetry })

describe('AuthContext', () => {
  it('A01: with no stored session, loading ends signed out', async () => {
    const { result } = render()
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).toBeNull()
    expect(result.current.profile).toBeNull()
    expect(loadProfile).not.toHaveBeenCalled()
  })

  it('A02: sign-in resolves the profile and applies its language', async () => {
    vi.mocked(loadProfile).mockResolvedValue({ ...PROFILE, language: 'en' })
    const { result } = render()
    await waitFor(() => expect(result.current.loading).toBe(false))
    let outcome!: Awaited<ReturnType<typeof result.current.signIn>>
    await act(async () => {
      outcome = await result.current.signIn('ana@example.com', 'pw')
    })
    expect(outcome).toEqual({ ok: true })
    expect(backend.sent('POST', '/auth/v1/token')[0]?.url.searchParams.get('grant_type')).toBe('password')
    expect(loadProfile).toHaveBeenCalledWith('auth-1')
    await waitFor(() => expect(result.current.profile?.id).toBe('user-1'))
    expect(result.current.session?.access_token).toBe(gotrue.tokens[0])
    expect(i18n.language).toBe('en')
  })

  it('A03: an auth user without a profile is signed out again with no_profile', async () => {
    vi.mocked(loadProfile).mockResolvedValue(null)
    const { result } = render()
    await waitFor(() => expect(result.current.loading).toBe(false))
    let outcome!: Awaited<ReturnType<typeof result.current.signIn>>
    await act(async () => {
      outcome = await result.current.signIn('ana@example.com', 'pw')
    })
    expect(outcome).toEqual({ ok: false, code: 'no_profile' })
    await waitFor(() => expect(backend.sent('POST', '/auth/v1/logout').length).toBeGreaterThan(0))
    expect(result.current.session).toBeNull()
    expect(result.current.profile).toBeNull()
    expect(result.current.authError).toBe('no_profile')
  })

  it('A04: a stored session is resolved on load, and sign-out clears both', async () => {
    await supabase.auth.signInWithPassword({ email: 'ana@example.com', password: 'pw' })
    const { result } = render()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.profile?.id).toBe('user-1')
    expect(result.current.session).not.toBeNull()
    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.session).toBeNull()
    expect(result.current.profile).toBeNull()
    expect(backend.sent('POST', '/auth/v1/logout')).toHaveLength(1)
  })

  it('A05: a token refresh re-reads the profile', async () => {
    await supabase.auth.signInWithPassword({ email: 'ana@example.com', password: 'pw' })
    const { result } = render()
    await waitFor(() => expect(result.current.profile?.id).toBe('user-1'))
    const before = vi.mocked(loadProfile).mock.calls.length
    await act(async () => {
      await supabase.auth.refreshSession()
    })
    await waitFor(() => expect(vi.mocked(loadProfile).mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(result.current.session?.access_token).toBe(gotrue.tokens.at(-1)))
    expect(result.current.profile?.id).toBe('user-1')
  })

  it('A06: setLanguage switches the UI and writes users.language', async () => {
    await supabase.auth.signInWithPassword({ email: 'ana@example.com', password: 'pw' })
    const { result } = render()
    await waitFor(() => expect(result.current.profile?.id).toBe('user-1'))
    await act(async () => {
      await result.current.setLanguage('en')
    })
    expect(updateLanguage).toHaveBeenCalledWith('user-1', 'en')
    expect(i18n.language).toBe('en')
    expect(result.current.profile?.language).toBe('en')
  })

  it('WEB-5: a transient profile read failure at token refresh keeps the profile and retries', async () => {
    await supabase.auth.signInWithPassword({ email: 'ana@example.com', password: 'pw' })
    const { result } = renderQuickRetry()
    await waitFor(() => expect(result.current.profile?.id).toBe('user-1'))
    const before = vi.mocked(loadProfile).mock.calls.length
    vi.mocked(loadProfile).mockRejectedValueOnce(new Error('Failed to fetch'))
    await act(async () => {
      await supabase.auth.refreshSession()
    })
    await waitFor(() => expect(vi.mocked(loadProfile).mock.calls.length).toBe(before + 1))
    // Still signed in: the GoTrue session is valid and the profile did not change.
    expect(result.current.session?.access_token).toBe(gotrue.tokens.at(-1))
    expect(result.current.profile?.id).toBe('user-1')
    expect(result.current.authError).toBeNull()
    // The read is retried and succeeds.
    await waitFor(() => expect(vi.mocked(loadProfile).mock.calls.length).toBe(before + 2))
    expect(result.current.profile?.id).toBe('user-1')
  })

  it('WEB-5: a transient failure on the first load keeps the session, says network, and recovers on retry', async () => {
    await supabase.auth.signInWithPassword({ email: 'ana@example.com', password: 'pw' })
    vi.mocked(loadProfile).mockRejectedValueOnce(new Error('Failed to fetch'))
    const { result } = renderQuickRetry()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).not.toBeNull()
    expect(result.current.profile).toBeNull()
    expect(result.current.authError).toBe('network')
    await waitFor(() => expect(result.current.profile?.id).toBe('user-1'))
    expect(result.current.authError).toBeNull()
    expect(backend.sent('POST', '/auth/v1/logout')).toEqual([])
  })

  it('WEB-5: a sign-in whose profile read fails reports network, not no_profile, and is not signed out', async () => {
    vi.mocked(loadProfile).mockRejectedValueOnce(new Error('Failed to fetch'))
    const { result } = renderQuickRetry()
    await waitFor(() => expect(result.current.loading).toBe(false))
    let outcome!: Awaited<ReturnType<typeof result.current.signIn>>
    await act(async () => {
      outcome = await result.current.signIn('ana@example.com', 'pw')
    })
    expect(outcome).toEqual({ ok: false, code: 'network' })
    expect(backend.sent('POST', '/auth/v1/logout')).toEqual([])
    await waitFor(() => expect(result.current.profile?.id).toBe('user-1'))
  })

  it('WEB-5: only a missing profile at refresh signs the user out', async () => {
    await supabase.auth.signInWithPassword({ email: 'ana@example.com', password: 'pw' })
    const { result } = renderQuickRetry()
    await waitFor(() => expect(result.current.profile?.id).toBe('user-1'))
    vi.mocked(loadProfile).mockResolvedValue(null)
    await act(async () => {
      await supabase.auth.refreshSession()
    })
    await waitFor(() => expect(result.current.session).toBeNull())
    expect(result.current.profile).toBeNull()
    expect(result.current.authError).toBe('no_profile')
    await waitFor(() => expect(backend.sent('POST', '/auth/v1/logout').length).toBeGreaterThan(0))
  })
})
