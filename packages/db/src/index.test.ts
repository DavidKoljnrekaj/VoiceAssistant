import { describe, expect, it } from 'vitest'

import * as db from './index.js'

describe('@va/db', () => {
  it('exports the two client factories, the env schema and the schema constants, and nothing that queries', () => {
    expect(Object.keys(db).sort()).toEqual([
      'VOICE_CALL_IDLE_MS',
      'createServiceClient',
      'createUserClient',
      'dbEnvSchema',
      'getDbEnv',
      'parseDbEnv',
      'resetDbEnvCache',
    ])
  })
})
