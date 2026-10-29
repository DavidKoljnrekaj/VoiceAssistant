import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import ErrorState from '../ui/ErrorState'
import MarkdownView from '../ui/MarkdownView'
import Spinner from '../ui/Spinner'
import type { LoadStatus } from './hooks/useChatStore'
import type { RenderMessage } from './lib/normalizeMessages'
import Message from './Message'

interface MessageListProps {
  messages: RenderMessage[]
  /** The assistant block being streamed, rendered live below the last row. */
  pendingText: string | null
  status: LoadStatus
  isStreaming: boolean
  onRetry: () => void
}

export default function MessageList({
  messages,
  pendingText,
  status,
  isStreaming,
  onRetry,
}: MessageListProps) {
  const { t } = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, pendingText])

  if (status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-6 w-6" label={t('common.loading')} />
      </div>
    )
  }
  if (status === 'error') return <ErrorState onRetry={onRetry} className="flex-1" />

  if (messages.length === 0 && pendingText === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <p className="text-lg font-medium">{t('chat.empty_title')}</p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('chat.empty_description')}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" data-testid="message-list">
      {messages.map((message) => (
        <Message key={message.id} message={message} />
      ))}
      {pendingText !== null && (
        <div className="flex justify-start" data-kind="pending">
          <div className="max-w-[90%] overflow-hidden rounded-lg bg-white px-3 py-2 wrap-break-word dark:bg-gray-800">
            <MarkdownView content={pendingText} />
          </div>
        </div>
      )}
      {isStreaming && pendingText === null && (
        <div className="px-1" aria-live="polite">
          <Spinner className="h-4 w-4" />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
