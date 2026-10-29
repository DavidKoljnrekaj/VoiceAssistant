import { AlertCircle, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import MarkdownView from '../ui/MarkdownView'
import { errorLabel } from './lib/labels'
import type { RenderMessage } from './lib/normalizeMessages'
import ToolChip from './ToolChip'

/** One rendered row of the conversation, by kind. */
export default function Message({ message }: { message: RenderMessage }) {
  const { t } = useTranslation()
  switch (message.kind) {
    case 'user':
      return (
        <div className="flex justify-end" data-kind="user">
          <div className="max-w-[80%] rounded-lg bg-blue-600 px-3 py-2 text-sm whitespace-pre-wrap text-white wrap-break-word">
            {message.text}
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div
          className="flex justify-start"
          data-kind="assistant"
          data-provisional={message.provisional || undefined}
        >
          <div
            className={`max-w-[90%] overflow-hidden rounded-lg bg-white px-3 py-2 wrap-break-word dark:bg-gray-800 ${
              message.provisional ? 'opacity-60' : ''
            }`}
          >
            <MarkdownView content={message.text} />
            {message.provisional && (
              <p className="mt-1 text-xs text-gray-500 italic dark:text-gray-400">{t('chat.provisional')}</p>
            )}
          </div>
        </div>
      )
    case 'tool':
      return <ToolChip tool={message.tool} status={message.status} />
    case 'error':
      return (
        <div
          role="alert"
          data-kind="error"
          data-code={message.code}
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="wrap-break-word">{errorLabel(message.code, message.message)}</span>
        </div>
      )
    case 'interrupted':
      return (
        <div
          className="flex items-center gap-2 px-1 py-1 text-xs text-gray-500 italic dark:text-gray-400"
          data-kind="interrupted"
        >
          <Square className="h-3 w-3 shrink-0 fill-current" aria-hidden="true" />
          <span>{t('chat.interrupted')}</span>
        </div>
      )
  }
}
