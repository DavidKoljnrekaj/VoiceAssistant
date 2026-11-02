// i18next: Croatian first, English fallback. Before sign-in the detector reads the stored
// preference, then the browser; after sign-in AuthContext applies `users.language`
// (.claude/rules/i18n.md). `load: 'languageOnly'` keeps a Croatian browser's `hr-HR` on `hr`.
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import en from './locales/en/translation.json'
import hr from './locales/hr/translation.json'

export const LANGUAGES = ['hr', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { hr: { translation: hr }, en: { translation: en } },
    fallbackLng: 'hr',
    supportedLngs: [...LANGUAGES],
    load: 'languageOnly',
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
    interpolation: { escapeValue: false },
  })

// The page language follows the switch, so assistive technology reads the UI in the language it
// shows (WEB-14). index.html starts with lang="hr", the fallback.
function applyDocumentLanguage(language: string): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = isLanguage(language) ? language : 'hr'
}
i18n.on('languageChanged', applyDocumentLanguage)
if (i18n.resolvedLanguage) applyDocumentLanguage(i18n.resolvedLanguage)

export default i18n
