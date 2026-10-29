/* eslint-disable react-refresh/only-export-components */
// Session from supabase-js, then the `users` profile (RLS self-read); `loading` until both have
// resolved. An auth user without a profile is signed out again with `no_profile`. The profile's
// `language` is applied to i18next on load; the switcher writes it back.
import type { Session, User as AuthUser } from '@supabase/supabase-js'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import i18n, { isLanguage, type Language } from '../i18n'
import { supabase } from '../lib/supabase'
import { loadProfile, type Profile, updateLanguage } from '../services/profileService'

export type SignInErrorCode =
  'invalid_credentials' | 'too_many_requests' | 'network' | 'no_profile' | 'unknown'

export type SignInResult = { ok: true } | { ok: false; code: SignInErrorCode }

export interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** Set when a session had to be dropped (no profile) outside a sign-in call. */
  authError: SignInErrorCode | null
  signIn: (email: string, password: string) => Promise<SignInResult>
  signOut: () => Promise<void>
  setLanguage: (language: Language) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) throw new Error('useAuth must be used within <AuthProvider>')
  return value
}

function mapAuthError(error: unknown): SignInErrorCode {
  if (!error || typeof error !== 'object') return 'unknown'
  const e = error as { message?: string; status?: number; code?: string; name?: string }
  const message = (e.message ?? '').toLowerCase()
  const code = (e.code ?? '').toLowerCase()
  if (e.name === 'TypeError' && message.includes('fetch')) return 'network'
  if (e.name === 'AuthRetryableFetchError') return 'network'
  if (e.status === 429 || code.includes('rate_limit') || message.includes('rate limit'))
    return 'too_many_requests'
  if (message.includes('invalid login credentials') || code === 'invalid_credentials')
    return 'invalid_credentials'
  return 'unknown'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<SignInErrorCode | null>(null)

  /** Resolves the profile for an auth user; a missing row drops the session. */
  const resolve = useCallback(async (authUser: AuthUser | null, next: Session | null): Promise<boolean> => {
    if (!authUser) {
      setSession(null)
      setProfile(null)
      return false
    }
    let row: Profile | null
    try {
      row = await loadProfile(authUser.id)
    } catch {
      // A failed read is not "no profile": keep the session, show nothing until a retry.
      setSession(next)
      setProfile(null)
      return false
    }
    if (!row) {
      setSession(null)
      setProfile(null)
      setAuthError('no_profile')
      await supabase.auth.signOut().catch(() => {})
      return false
    }
    setSession(next)
    setProfile(row)
    setAuthError(null)
    if (isLanguage(row.language) && i18n.language !== row.language) void i18n.changeLanguage(row.language)
    return true
  }, [])

  useEffect(() => {
    let mounted = true
    void (async () => {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      await resolve(data.session?.user ?? null, data.session)
      if (mounted) setLoading(false)
    })()
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!mounted) return
      // supabase-js holds a lock while this callback runs; defer its own calls out of it.
      setTimeout(() => {
        if (!mounted) return
        if (event === 'SIGNED_OUT') {
          setSession(null)
          setProfile(null)
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          void resolve(next?.user ?? null, next)
        }
      }, 0)
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [resolve])

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      setAuthError(null)
      let result
      try {
        result = await supabase.auth.signInWithPassword({ email, password })
      } catch (err) {
        return { ok: false, code: mapAuthError(err) }
      }
      if (result.error) return { ok: false, code: mapAuthError(result.error) }
      const ok = await resolve(result.data.user, result.data.session)
      return ok ? { ok: true } : { ok: false, code: 'no_profile' }
    },
    [resolve],
  )

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } finally {
      setSession(null)
      setProfile(null)
      setAuthError(null)
    }
  }, [])

  const setLanguage = useCallback(
    async (language: Language) => {
      await i18n.changeLanguage(language)
      if (!profile) return
      await updateLanguage(profile.id, language)
      setProfile({ ...profile, language })
    },
    [profile],
  )

  const value = useMemo<AuthContextValue>(
    () => ({ session, profile, loading, authError, signIn, signOut, setLanguage }),
    [session, profile, loading, authError, signIn, signOut, setLanguage],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
