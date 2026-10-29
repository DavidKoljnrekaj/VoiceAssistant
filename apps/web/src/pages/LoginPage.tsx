import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router-dom'

import LoginForm from '../components/Auth/LoginForm'
import LanguageSwitcher from '../components/Layout/LanguageSwitcher'
import Spinner from '../components/ui/Spinner'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { t } = useTranslation()
  const { loading, session, profile } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }
  if (session && profile) return <Navigate to={from} replace />

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{t('app.name')}</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('auth.subtitle')}</p>
          </div>
          <LanguageSwitcher />
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
