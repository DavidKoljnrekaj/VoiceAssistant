import { LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useAuth } from '../../contexts/AuthContext'
import Button from '../ui/Button'
import LanguageSwitcher from './LanguageSwitcher'

/** Header (name, language, sign-out) and the main area. The chat panel owns everything below. */
export default function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { profile, signOut } = useAuth()
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
        <Link to="/" className="text-base font-semibold">
          {t('app.name')}
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-gray-600 sm:inline dark:text-gray-400">
            {profile?.display_name ?? profile?.email ?? ''}
          </span>
          <LanguageSwitcher />
          <Button
            variant="ghost"
            onClick={() => void signOut()}
            aria-label={t('common.sign_out')}
            title={t('common.sign_out')}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  )
}
