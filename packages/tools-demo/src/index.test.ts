import { describe, expect, it } from 'vitest'

import { PACKAGE_NAME } from './index.js'

describe('@va/tools-demo', () => {
  it('smoke: exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@va/tools-demo')
  })
})
