// W40: the worker's Microsoft settings (Part 13a), all four or none, named without values.
import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { parseVoiceEnv } from '../src/env.js'

const required = {
  AGENT_NAME: 'va-voice',
  LIVEKIT_URL: 'wss://fake.livekit.test',
  LIVEKIT_API_KEY: 'k',
  LIVEKIT_API_SECRET: 's',
  SONIOX_API_KEY: 'k',
  ELEVENLABS_API_KEY: 'k',
  ANTHROPIC_API_KEY: 'k',
  SUPABASE_URL: 'http://fake-supabase.test',
  SUPABASE_ANON_KEY: 'k',
  SUPABASE_SERVICE_ROLE_KEY: 'k',
}
const group = {
  MS_TENANT_ID: '11111111-2222-4333-8444-555555555555',
  MS_CLIENT_ID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  MS_CLIENT_SECRET: 'the-secret',
  INTEGRATIONS_KEY: `k1:${randomBytes(32).toString('base64')}`,
}

describe('voice env', () => {
  it('W40 the Microsoft settings are all four or none; a partial set names the missing ones, never a value', () => {
    expect(parseVoiceEnv(required).MS_CLIENT_ID).toBeUndefined()
    expect(parseVoiceEnv({ ...required, ...group }).INTEGRATIONS_KEY).toBe(group.INTEGRATIONS_KEY)
    let message = ''
    try {
      parseVoiceEnv({ ...required, MS_CLIENT_SECRET: group.MS_CLIENT_SECRET })
    } catch (e) {
      message = (e as Error).message
    }
    for (const name of ['MS_TENANT_ID', 'MS_CLIENT_ID', 'INTEGRATIONS_KEY'])
      expect(message).toContain(`${name}: required when any MS_ variable is set`)
    expect(message).not.toContain(group.MS_CLIENT_SECRET)
    expect(() => parseVoiceEnv({ ...required, ...group, INTEGRATIONS_KEY: 'k1:short' })).toThrow(
      'INTEGRATIONS_KEY entry 1',
    )
  })
})
