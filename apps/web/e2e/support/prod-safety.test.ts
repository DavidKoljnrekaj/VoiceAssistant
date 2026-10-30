// The prod-safety guard of the Playwright smoke (prod-safety.ts): the local stack always runs,
// a hosted project only when it equals E2E_ALLOWED_SUPABASE_URL, and anything else refuses.
import { describe, expect, it } from 'vitest'

import { assertSafeSupabaseUrl, isLocalStack } from './prod-safety.js'

const DEV = 'https://kdplqbldohrzsewhckgl.supabase.co'
const PROD = 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co'

describe('prod-safety guard', () => {
  it('G01: the local stack runs without an allowlist', () => {
    expect(isLocalStack('http://127.0.0.1:54431')).toBe(true)
    expect(isLocalStack('http://localhost:54431/')).toBe(true)
    expect(isLocalStack(DEV)).toBe(false)
    expect(isLocalStack('not a url')).toBe(false)
    expect(assertSafeSupabaseUrl({ supabaseUrl: 'http://127.0.0.1:54431', allowedUrl: undefined })).toBe(
      'http://127.0.0.1:54431',
    )
  })

  it('G02: a hosted project runs only when it equals the allowed URL', () => {
    expect(assertSafeSupabaseUrl({ supabaseUrl: DEV, allowedUrl: DEV })).toBe(DEV)
    expect(assertSafeSupabaseUrl({ supabaseUrl: `${DEV}/`, allowedUrl: DEV.toUpperCase() })).toBe(`${DEV}/`)
    expect(() => assertSafeSupabaseUrl({ supabaseUrl: PROD, allowedUrl: DEV })).toThrow(
      /Prod-safety check failed/,
    )
  })

  it('G03: a hosted project with no allowed URL set refuses', () => {
    expect(() => assertSafeSupabaseUrl({ supabaseUrl: PROD, allowedUrl: undefined })).toThrow(
      /E2E_ALLOWED_SUPABASE_URL is not set/,
    )
    expect(() => assertSafeSupabaseUrl({ supabaseUrl: PROD, allowedUrl: '  ' })).toThrow(/is not set/)
  })

  it('G04: a missing VITE_SUPABASE_URL refuses with its name, never a value', () => {
    expect(() => assertSafeSupabaseUrl({ supabaseUrl: undefined, allowedUrl: DEV })).toThrow(
      /VITE_SUPABASE_URL is not set/,
    )
    expect(() => assertSafeSupabaseUrl({ supabaseUrl: '', allowedUrl: DEV })).toThrow(
      /VITE_SUPABASE_URL is not set/,
    )
  })
})
