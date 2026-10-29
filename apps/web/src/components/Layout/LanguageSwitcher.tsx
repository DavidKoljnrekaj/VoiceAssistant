import { useTranslation } from 'react-i18next'

import { useAuth } from '../../contexts/AuthContext'
import { isLanguage, LANGUAGES } from '../../i18n'

/** hr / en. Signed in, the choice is written to `users.language`; before that it only changes the UI. */
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const { setLanguage } = useAuth()
  const current = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'hr'
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">{t('common.language')}</span>
      <select
        aria-label={t('common.language')}
        value={current}
        onChange={(e) => {
          if (isLanguage(e.target.value)) void setLanguage(e.target.value).catch(() => {})
        }}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
      >
        {LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {t(`lang.${lang}`)}
          </option>
        ))}
      </select>
    </label>
  )
}
