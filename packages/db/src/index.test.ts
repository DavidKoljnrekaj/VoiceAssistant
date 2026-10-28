import { describe, expect, it } from 'vitest'

import * as db from './index.js'

describe('@va/db', () => {
  it('exports the two client factories and the env schema, and nothing that queries', () => {
    expect(Object.keys(db).sort()).toEqual([
      'createServiceClient',
      'createUserClient',
      'dbEnvSchema',
      'getDbEnv',
      'parseDbEnv',
      'resetDbEnvCache',
    ])
  })
})
