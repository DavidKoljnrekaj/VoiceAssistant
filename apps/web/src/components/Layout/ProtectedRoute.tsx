import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../../contexts/AuthContext'
import Spinner from '../ui/Spinner'

/** Waits for auth to resolve, then renders the child route or sends the visitor to /login. */
export default function ProtectedRoute() {
  const { t } = useTranslation()
  const { loading, session, profile } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" label={t('common.loading')} />
      </div>
    )
  }
  if (!session || !profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
