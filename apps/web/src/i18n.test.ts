// @vitest-environment jsdom
// The i18next instance against the document: the page language follows the switch so screen
// readers pronounce the UI in the language shown (WEB-14).
import { afterEach, describe, expect, it } from 'vitest'

import i18n, { isLanguage, LANGUAGES } from './i18n'

afterEach(() => i18n.changeLanguage('hr'))

describe('i18n', () => {
  it('I02: the two supported languages are recognised and nothing else', () => {
    expect(LANGUAGES).toEqual(['hr', 'en'])
    expect(isLanguage('hr')).toBe(true)
    expect(isLanguage('en')).toBe(true)
    expect(isLanguage('hr-HR')).toBe(false)
    expect(isLanguage(null)).toBe(false)
  })

  it('WEB-14: <html lang> follows the language switch', async () => {
    await i18n.changeLanguage('en')
    expect(document.documentElement.lang).toBe('en')
    await i18n.changeLanguage('hr')
    expect(document.documentElement.lang).toBe('hr')
  })
})
