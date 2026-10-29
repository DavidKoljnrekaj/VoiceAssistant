import { AlertCircle, Info } from 'lucide-react'
import type { ReactNode } from 'react'

type Variant = 'error' | 'info'

const VARIANTS: Record<Variant, string> = {
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300',
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200',
}

export default function Alert({
  variant = 'info',
  children,
  className = '',
}: {
  variant?: Variant
  children: ReactNode
  className?: string
}) {
  const Icon = variant === 'error' ? AlertCircle : Info
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${VARIANTS[variant]} ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
