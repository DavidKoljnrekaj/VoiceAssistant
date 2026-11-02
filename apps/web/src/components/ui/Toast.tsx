import { AlertCircle, CheckCircle, Info, X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import type { ToastItem } from '../../contexts/ToastContext'

const STYLES = {
  info: 'bg-blue-600 text-white',
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
} as const

const ICONS = { info: Info, success: CheckCircle, error: AlertCircle } as const

/** Each toast is an alert with a real dismiss button; Escape dismisses the newest one (WEB-14). */
export default function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}) {
  const { t } = useTranslation()
  const newest = toasts.at(-1)?.id ?? null

  useEffect(() => {
    if (newest === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss(newest)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [newest, onDismiss])

  if (toasts.length === 0) return null
  return createPortal(
    <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.variant]
        return (
          <div
            key={toast.id}
            role="alert"
            className={`flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg px-4 py-3 shadow-lg ${STYLES[toast.variant]}`}
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-sm leading-snug">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label={t('common.dismiss')}
              title={t('common.dismiss')}
              className="-m-1 shrink-0 rounded p-1 opacity-80 hover:opacity-100 focus:ring-2 focus:ring-white focus:outline-hidden"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
