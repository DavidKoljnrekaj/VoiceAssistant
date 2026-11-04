import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConfirmStatus } from './lib/normalizeMessages'

interface ConfirmCardProps {
  /** What the tool said it would do, in the user's language. Shown verbatim. */
  summary: string
  status: ConfirmStatus
  expiresAt: string
  disabled: boolean
  onAnswer: (answer: 'confirm' | 'decline') => void
}

/**
 * A write waiting for the user (Part 12): the summary and two buttons. The buttons go once the
 * user answered or the confirmation expired; the card stays as the record of what was asked.
 */
export default function ConfirmCard({ summary, status, expiresAt, disabled, onAnswer }: ConfirmCardProps) {
  const { t } = useTranslation()
  // The clock is read in an effect, not during render, and the card flips to expired on time.
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    const check = () => setExpired(Date.parse(expiresAt) <= Date.now())
    check()
    const timer = setTimeout(check, Math.max(0, Date.parse(expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [expiresAt])
  const outcome =
    status === 'confirmed'
      ? t('chat.confirmed')
      : status === 'declined'
        ? t('chat.declined')
        : status === 'expired' || (status === 'pending' && expired)
          ? t('chat.confirm_expired')
          : null
  return (
    <div
      role="group"
      aria-label={t('chat.confirm_title')}
      data-kind="confirm"
      data-status={status === 'pending' && expired ? 'expired' : status}
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-900/20"
    >
      <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{t('chat.confirm_title')}</p>
      <p className="mt-1 whitespace-pre-wrap wrap-break-word">{summary}</p>
      {outcome !== null ? (
        <p className="mt-2 text-xs text-gray-600 italic dark:text-gray-400">{outcome}</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAnswer('confirm')}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-600"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {t('common.confirm')}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAnswer('decline')}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  )
}
