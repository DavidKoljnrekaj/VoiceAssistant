import { Mail } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useToast } from '../../contexts/ToastContext'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import ErrorState from '../ui/ErrorState'
import Spinner from '../ui/Spinner'
import type { OutlookConnection as Connection } from './hooks/useOutlookConnection'

/** The Outlook section of Settings: the connection's state and the one action that fits it. */
export default function OutlookConnection({ outlook }: { outlook: Connection }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const { state, busy } = outlook

  const connect = () => {
    outlook.connect().catch(() => toast.error(t('settings.outlook.action_failed')))
  }
  const disconnect = () => {
    outlook.disconnect().then(
      () => {
        setConfirming(false)
        toast.success(t('settings.outlook.disconnected_toast'))
      },
      () => {
        setConfirming(false)
        toast.error(t('settings.outlook.action_failed'))
      },
    )
  }

  return (
    <section
      aria-labelledby="settings-outlook"
      className="rounded-xl border border-gray-200 p-4 dark:border-gray-700"
    >
      <h2 id="settings-outlook" className="mb-1 flex items-center gap-2 text-base font-semibold">
        <Mail className="h-4 w-4" aria-hidden="true" />
        {t('settings.outlook.title')}
      </h2>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t('settings.outlook.description')}</p>

      {state.kind === 'loading' && <Spinner label={t('common.loading')} />}
      {state.kind === 'error' && <ErrorState onRetry={outlook.reload} className="py-4" />}
      {state.kind === 'unavailable' && <p className="text-sm">{t('settings.outlook.unavailable')}</p>}
      {state.kind === 'ready' && state.connection === null && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">{t('settings.outlook.not_connected')}</p>
          <Button onClick={connect} loading={busy}>
            {t('settings.outlook.connect')}
          </Button>
        </div>
      )}
      {state.kind === 'ready' && state.connection?.status === 'reauth_required' && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">{t('settings.outlook.reauth_required')}</p>
          <Button onClick={connect} loading={busy}>
            {t('settings.outlook.reconnect')}
          </Button>
        </div>
      )}
      {state.kind === 'ready' && state.connection?.status === 'active' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              {t('settings.outlook.connected_as', { account: state.connection.account })}
            </p>
            <Button variant="secondary" onClick={() => setConfirming(true)} disabled={busy}>
              {t('settings.outlook.disconnect')}
            </Button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.outlook.revoke_note')}</p>
        </div>
      )}

      <ConfirmDialog
        show={confirming}
        title={t('settings.outlook.disconnect_title')}
        message={t('settings.outlook.revoke_note')}
        confirmLabel={t('settings.outlook.disconnect')}
        loading={busy}
        onConfirm={disconnect}
        onCancel={() => setConfirming(false)}
      />
    </section>
  )
}
