import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../../contexts/AuthContext'
import Spinner from '../ui/Spinner'

/** Waits for auth to resolve, then renders the child route or sends the visitor to /login. */
export default function ProtectedRoute() {
  const { loading, session, profile } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }
  if (!session || !profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
