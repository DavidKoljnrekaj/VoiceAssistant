/* eslint-disable react-refresh/only-export-components */
// Session from supabase-js, then the `users` profile (RLS self-read); `loading` until both have
// resolved. An auth user without a profile is signed out again with `no_profile`. A profile read
// that fails (network, PostgREST) is not "no profile": the previous profile stays and the read is
// retried with a backoff (WEB-5). The profile's `language` is applied to i18next on load; the
// switcher writes it back.
import type { Session, User as AuthUser } from '@supabase/supabase-js'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

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
  /**
   * Set outside a sign-in call: `no_profile` when the session had to be dropped, `network` while
   * a signed-in user's first profile read is failing and being retried.
   */
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

/** Delays before the 1st, 2nd and every later retry of a failed profile read. */
const PROFILE_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 60_000]

type ResolveOutcome = 'ok' | 'no_profile' | 'network'

export function AuthProvider({
  children,
  profileRetryDelaysMs = PROFILE_RETRY_DELAYS_MS,
}: {
  children: ReactNode
  profileRetryDelaysMs?: readonly number[]
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<SignInErrorCode | null>(null)
  // The retry of a failed profile read: one pending timer, and how many attempts have failed.
  const profileRef = useRef<Profile | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  const resolveRef = useRef<((authUser: AuthUser, next: Session | null) => Promise<ResolveOutcome>) | null>(
    null,
  )

  const cancelRetry = useCallback(() => {
    if (retryRef.current !== null) clearTimeout(retryRef.current)
    retryRef.current = null
    attemptsRef.current = 0
  }, [])

  /**
   * Resolves the profile for an auth user. A missing row drops the session (`no_profile`); a
   * failed read keeps the session and the previous profile, if any, and schedules a retry.
   */
  const resolve = useCallback(
    async (authUser: AuthUser | null, next: Session | null): Promise<ResolveOutcome> => {
      if (retryRef.current !== null) clearTimeout(retryRef.current)
      retryRef.current = null
      if (!authUser) {
        attemptsRef.current = 0
        profileRef.current = null
        setSession(null)
        setProfile(null)
        return 'no_profile'
      }
      let row: Profile | null
      try {
        row = await loadProfile(authUser.id)
      } catch {
        const delay =
          profileRetryDelaysMs[Math.min(attemptsRef.current, profileRetryDelaysMs.length - 1)] ?? 5_000
        attemptsRef.current += 1
        retryRef.current = setTimeout(() => {
          retryRef.current = null
          void resolveRef.current?.(authUser, next)
        }, delay)
        setSession(next)
        const previous = profileRef.current
        if (previous && previous.auth_user_id === authUser.id) return 'ok'
        profileRef.current = null
        setProfile(null)
        setAuthError('network')
        return 'network'
      }
      attemptsRef.current = 0
      if (!row) {
        profileRef.current = null
        setSession(null)
        setProfile(null)
        setAuthError('no_profile')
        await supabase.auth.signOut().catch(() => {})
        return 'no_profile'
      }
      profileRef.current = row
      setSession(next)
      setProfile(row)
      setAuthError(null)
      if (isLanguage(row.language) && i18n.language !== row.language) void i18n.changeLanguage(row.language)
      return 'ok'
    },
    [profileRetryDelaysMs],
  )
  useEffect(() => {
    resolveRef.current = resolve
  }, [resolve])

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
          cancelRetry()
          profileRef.current = null
          setSession(null)
          setProfile(null)
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          void resolve(next?.user ?? null, next)
        }
      }, 0)
    })
    return () => {
      mounted = false
      cancelRetry()
      sub.subscription.unsubscribe()
    }
  }, [resolve, cancelRetry])

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
      const outcome = await resolve(result.data.user, result.data.session)
      return outcome === 'ok' ? { ok: true } : { ok: false, code: outcome }
    },
    [resolve],
  )

  const signOut = useCallback(async () => {
    cancelRetry()
    try {
      await supabase.auth.signOut()
    } finally {
      profileRef.current = null
      setSession(null)
      setProfile(null)
      setAuthError(null)
    }
  }, [cancelRetry])

  const setLanguage = useCallback(
    async (language: Language) => {
      await i18n.changeLanguage(language)
      if (!profile) return
      await updateLanguage(profile.id, language)
      profileRef.current = { ...profile, language }
      setProfile(profileRef.current)
    },
    [profile],
  )

  const value = useMemo<AuthContextValue>(
    () => ({ session, profile, loading, authError, signIn, signOut, setLanguage }),
    [session, profile, loading, authError, signIn, signOut, setLanguage],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
