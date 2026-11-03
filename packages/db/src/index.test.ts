import { describe, expect, it } from 'vitest'

import * as db from './index.js'

describe('@va/db', () => {
  it('exports the three client factories, the env schema and the schema constants, and nothing that queries', () => {
    expect(Object.keys(db).sort()).toEqual([
      'VOICE_CALL_CAP_MS',
      'VOICE_CALL_IDLE_MS',
      'createAnonClient',
      'createServiceClient',
      'createUserClient',
      'dbEnvSchema',
      'getDbEnv',
      'parseDbEnv',
      'resetDbEnvCache',
    ])
  })
})
