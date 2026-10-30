// The two locale files as data: the same key set in hr and en (a key added to one only would
// render as its path), and the strings the panel composes stay composable.
import { describe, expect, it } from 'vitest'

import en from './en/translation.json'
import hr from './hr/translation.json'

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
}

describe('locales', () => {
  it('I01: hr and en carry the same keys (the hr review marker aside)', () => {
    const hrKeys = flatten(hr).filter((k) => k !== '_review')
    expect(hrKeys.sort()).toEqual(flatten(en).sort())
  })

  it('WEB-8: the call banner does not repeat the "call in progress" label the panel puts in front of it', () => {
    for (const locale of [hr, en]) {
      expect(locale.call.banner.toLowerCase().startsWith(locale.call.live.toLowerCase())).toBe(false)
    }
  })
})
