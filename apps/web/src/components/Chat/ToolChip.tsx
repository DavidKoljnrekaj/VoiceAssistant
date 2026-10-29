import { Check, Loader2, XCircle } from 'lucide-react'

import { toolLabel } from './lib/labels'
import type { ToolStatus } from './lib/normalizeMessages'

/** One tool call: pending (spinner) → done (check) or error (cross), labelled in Croatian. */
export default function ToolChip({ tool, status }: { tool: string; status: ToolStatus }) {
  const label = toolLabel(tool)
  return (
    <div
      className="flex items-center gap-2 px-1 py-1 text-xs text-gray-600 dark:text-gray-400"
      data-tool={tool}
      data-status={status}
    >
      {status === 'pending' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />}
      {status === 'done' && (
        <Check className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
      )}
      {status === 'error' && (
        <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
      )}
      <span>{status === 'pending' ? `${label}…` : label}</span>
    </div>
  )
}
