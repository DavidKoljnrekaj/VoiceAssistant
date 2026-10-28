import { afterEach, describe, expect, it } from 'vitest'

import { getDbEnv, parseDbEnv, resetDbEnvCache } from './env.js'

const valid = {
  SUPABASE_URL: 'http://127.0.0.1:54431',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
}

describe('dbEnv', () => {
  afterEach(() => {
    resetDbEnvCache()
    for (const key of Object.keys(valid)) delete process.env[key]
  })

  it('parses the three Supabase variables', () => {
    expect(parseDbEnv(valid)).toEqual(valid)
  })

  it('names a missing variable without echoing any value', () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _dropped, ...partial } = valid
    expect(() => parseDbEnv(partial)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
    expect(() => parseDbEnv(partial)).not.toThrow(/anon-key/)
  })

  it('refuses a URL that is not one', () => {
    expect(() => parseDbEnv({ ...valid, SUPABASE_URL: 'not a url' })).toThrow(/SUPABASE_URL/)
  })

  it('reads process.env once and caches the result', () => {
    Object.assign(process.env, valid)
    expect(getDbEnv()).toEqual(valid)
    process.env.SUPABASE_URL = 'http://changed.invalid'
    expect(getDbEnv().SUPABASE_URL).toBe(valid.SUPABASE_URL)
  })

  it('throws on first use when the environment is invalid', () => {
    expect(() => getDbEnv()).toThrow(/Invalid Supabase environment/)
  })
})
