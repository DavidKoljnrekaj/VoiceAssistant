import { AlertCircle, CheckCircle, Info, X } from 'lucide-react'
import { createPortal } from 'react-dom'

import type { ToastItem } from '../../contexts/ToastContext'

const STYLES = {
  info: 'bg-blue-600 text-white',
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
} as const

const ICONS = { info: Info, success: CheckCircle, error: AlertCircle } as const

export default function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return createPortal(
    <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.variant]
        return (
          <div
            key={toast.id}
            role="alert"
            onClick={() => onDismiss(toast.id)}
            className={`flex w-80 max-w-[calc(100vw-2rem)] cursor-pointer items-start gap-3 rounded-lg px-4 py-3 shadow-lg ${STYLES[toast.variant]}`}
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-sm leading-snug">{toast.message}</p>
            <X className="mt-0.5 h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
