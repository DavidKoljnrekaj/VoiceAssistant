// The chat screen: session drawer, header (title, new conversation, call button), the call banner,
// the message list and the composer. The route (`/c/:sessionId`) selects the session; a session
// created mid-stream moves the route so a refresh reopens the same conversation.
import { Menu, Phone, SquarePen, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { useToast } from '../../contexts/ToastContext'
import { VOICE_CALLS_ENABLED } from '../../lib/featureFlags'
import Alert from '../ui/Alert'
import { useChat } from './ChatProvider'
import VoiceCallButton from './components/VoiceCallButton'
import Composer from './Composer'
import { useVoiceCall } from './hooks/useVoiceCall'
import MessageList from './MessageList'
import SessionList from './SessionList'

export default function ChatPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { sessionId: routeSessionId } = useParams<{ sessionId: string }>()
  const chat = useChat()
  const call = useVoiceCall()
  const toast = useToast()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // The route selects the session; a new conversation's id, learned from the `session` event,
  // moves the route (replace, so Back does not return to an empty /).
  useEffect(() => {
    if (routeSessionId && routeSessionId !== chat.currentSessionId) void chat.selectSession(routeSessionId)
    else if (!routeSessionId && chat.currentSessionId && !chat.isStreaming) chat.newConversation()
    // chat.* are stable callbacks; only the route and the current id matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSessionId])
  // Only while the stream that created the session is running: after a delete or "new
  // conversation" the route is already `/` and the store catches up, never the other way round.
  useEffect(() => {
    if (chat.isStreaming && chat.currentSessionId && !routeSessionId) {
      navigate(`/c/${chat.currentSessionId}`, { replace: true })
    }
  }, [chat.isStreaming, chat.currentSessionId, routeSessionId, navigate])

  useEffect(() => {
    if (call.error) toast.error(t(`call.${call.error}`))
  }, [call.error, toast, t])

  const currentTitle = chat.sessions.find((s) => s.id === chat.currentSessionId)?.title ?? null

  const openNew = () => {
    setDrawerOpen(false)
    chat.newConversation()
    navigate('/')
  }
  const select = (id: string) => {
    setDrawerOpen(false)
    navigate(`/c/${id}`)
  }
  const remove = (id: string) => {
    if (id === chat.currentSessionId) navigate('/', { replace: true })
    void chat.deleteSession(id)
  }

  const sessionList = (
    <SessionList
      sessions={chat.sessions}
      status={chat.sessionsStatus === 'idle' ? 'loading' : chat.sessionsStatus}
      currentId={chat.currentSessionId}
      onSelect={select}
      onNew={openNew}
      onRename={(id, title) => void chat.renameSession(id, title)}
      onDelete={remove}
      onRetry={() => void chat.fetchSessions()}
    />
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-gray-200 bg-gray-100 md:block dark:border-gray-700 dark:bg-gray-800/60">
        {sessionList}
      </aside>
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="w-72 max-w-[85vw] bg-gray-100 shadow-xl dark:bg-gray-800">{sessionList}</div>
          <button
            type="button"
            className="flex-1 bg-black/40"
            aria-label={t('chat.close_sessions')}
            onClick={() => setDrawerOpen(false)}
          />
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-label={drawerOpen ? t('chat.close_sessions') : t('chat.open_sessions')}
            className="rounded-md p-1.5 hover:bg-gray-200 md:hidden dark:hover:bg-gray-700"
          >
            {drawerOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="session-title">
            {chat.currentSessionId ? (currentTitle ?? t('chat.untitled')) : t('chat.new_conversation')}
          </h1>
          <button
            type="button"
            onClick={openNew}
            aria-label={t('chat.new_conversation')}
            title={t('chat.new_conversation')}
            className="rounded-md p-1.5 text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <SquarePen className="h-5 w-5" aria-hidden="true" />
          </button>
          {VOICE_CALLS_ENABLED && (
            <VoiceCallButton
              state={call.state}
              muted={call.muted}
              agentSpeaking={call.agentSpeaking}
              onStart={() => void call.start()}
              onEnd={call.end}
              onToggleMute={() => void call.toggleMute()}
            />
          )}
        </header>

        {call.state === 'live' && (
          <Alert variant="info" className="mx-3 mt-2">
            <span className="flex items-center gap-2">
              <Phone className="h-4 w-4" aria-hidden="true" />
              <strong>{t('call.live')}.</strong> {t('call.banner')}
            </span>
          </Alert>
        )}

        <MessageList
          messages={chat.messages}
          pendingText={chat.pendingText}
          status={chat.messagesStatus}
          isStreaming={chat.isStreaming}
          onRetry={() => {
            if (chat.currentSessionId) {
              const id = chat.currentSessionId
              chat.newConversation()
              void chat.selectSession(id)
            }
          }}
        />
        <Composer
          disabled={chat.isStreaming || chat.messagesStatus !== 'ready'}
          isStreaming={chat.isStreaming}
          focusKey={chat.currentSessionId}
          onSend={(text) => void chat.sendMessage(text)}
          onStop={chat.stop}
        />
      </section>
    </div>
  )
}
