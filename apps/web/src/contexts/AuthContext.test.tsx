// @vitest-environment jsdom
// AuthProvider through renderHook: the real supabase-js client against a fake GoTrue over fetch
// (sign-in, refresh, sign-out), with `profileService` scripted per case. Assertions are on what
// the routes see (`session`, `profile`, `loading`, `authError`) and on the requests made.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
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
})
