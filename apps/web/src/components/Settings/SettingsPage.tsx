import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { useToast } from '../../contexts/ToastContext'
import { useOutlookConnection } from './hooks/useOutlookConnection'
import OutlookConnection from './OutlookConnection'
import { CONNECT_ERRORS, type ConnectError } from './services/integrationsService'

const leavePage = (url: string) => window.location.assign(url)

/**
 * Settings: for now the Outlook connection. The API's callback sends the browser back here with
 * `?connected=1` or `?connect_error=<code>`; the page says which once and drops the query.
 */
export default function SettingsPage({ redirect = leavePage }: { redirect?: (url: string) => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const outlook = useOutlookConnection(redirect)

  const connected = params.get('connected')
  const error = params.get('connect_error')
  useEffect(() => {
    if (connected === null && error === null) return
    if (connected === '1') toast.success(t('settings.outlook.connected_toast'))
    else if (error !== null) {
      const known = (CONNECT_ERRORS as readonly string[]).includes(error)
        ? (error as ConnectError)
        : 'unknown'
      toast.error(t(`settings.outlook.errors.${known}`))
    }
    setParams({}, { replace: true })
  }, [connected, error, setParams, t, toast])

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Link
          to="/"
          aria-label={t('settings.back')}
          title={t('settings.back')}
          className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
      </div>
      <OutlookConnection outlook={outlook} />
    </div>
  )
}
