import { Loader2 } from 'lucide-react'

export default function Spinner({ className = 'h-5 w-5', label }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-flex items-center text-gray-500 dark:text-gray-400"
    >
      <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />
    </span>
  )
}
