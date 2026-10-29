import { Send, Square } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAutoGrowTextarea } from './hooks/useAutoGrowTextarea'

const MAX_HEIGHT_PX = 160

interface ComposerProps {
  disabled: boolean
  isStreaming: boolean
  /** Refocuses the textarea when it changes (a different conversation). */
  focusKey: string | null
  onSend: (text: string) => void
  onStop: () => void
}

/** Auto-growing textarea; Enter sends, Shift+Enter is a newline; a stop button while streaming. */
export default function Composer({ disabled, isStreaming, focusKey, onSend, onStop }: ComposerProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrowTextarea(ref, value, MAX_HEIGHT_PX)

  useEffect(() => {
    ref.current?.focus()
  }, [focusKey])

  const canSend = !disabled && value.trim().length > 0

  const send = () => {
    if (!canSend) return
    onSend(value.trim())
    setValue('')
    requestAnimationFrame(() => ref.current?.focus())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={1}
        placeholder={t('chat.placeholder')}
        aria-label={t('chat.placeholder')}
        className="flex-1 resize-none overflow-y-auto rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700"
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          aria-label={t('chat.stop')}
          title={t('chat.stop')}
          className="shrink-0 rounded-md bg-gray-700 p-2 text-white transition-colors hover:bg-gray-800"
        >
          <Square className="h-4 w-4 fill-current" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label={t('chat.send')}
          title={t('chat.send')}
          className="shrink-0 rounded-md bg-blue-600 p-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-600"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
