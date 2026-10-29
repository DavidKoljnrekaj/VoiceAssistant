import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import Button from './Button'

/**
 * Shown in place of a list or a conversation that could not be loaded. A failed load must never
 * render as an empty list: "nothing here" and "we could not reach the server" are different states.
 */
export default function ErrorState({
  title,
  description,
  onRetry,
  className = '',
}: {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div role="alert" className={`flex flex-col items-center gap-2 px-4 py-8 text-center ${className}`}>
      <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
      <p className="font-medium">{title ?? t('common.load_error_title')}</p>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {description ?? t('common.load_error_description')}
      </p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-2">
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
