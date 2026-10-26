import { describe, expect, it } from 'vitest'

import { PACKAGE_NAME } from './index.js'

describe('@va/api', () => {
  it('smoke: exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@va/api')
  })
})
