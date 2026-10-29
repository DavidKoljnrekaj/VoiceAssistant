import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import Button from './Button'

interface ConfirmDialogProps {
  show: boolean
  title: string
  message?: ReactNode
  confirmLabel?: string
  variant?: 'danger' | 'primary'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** The shared confirmation (never `window.confirm`, ESLint). Focus starts on Cancel; Escape cancels. */
export default function ConfirmDialog({
  show,
  title,
  message,
  confirmLabel,
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!show) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [show, onCancel])

  if (!show) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role={variant === 'danger' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-gray-800"
      >
        <h2 id={titleId} className="mb-2 text-lg font-semibold">
          {title}
        </h2>
        {message && <div className="mb-5 text-sm text-gray-600 dark:text-gray-300">{message}</div>}
        <div className="flex justify-end gap-2">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
