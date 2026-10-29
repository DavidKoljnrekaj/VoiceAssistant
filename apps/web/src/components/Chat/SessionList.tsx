import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ConfirmDialog from '../ui/ConfirmDialog'
import ErrorState from '../ui/ErrorState'
import Input from '../ui/Input'
import Spinner from '../ui/Spinner'
import type { LoadStatus } from './hooks/useChatStore'
import type { SessionSummary } from './services/chatService'

interface SessionListProps {
  sessions: SessionSummary[]
  status: LoadStatus
  currentId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onRetry: () => void
}

/** Past conversations, newest activity first, with inline rename and a confirmed delete. */
export default function SessionList({
  sessions,
  status,
  currentId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onRetry,
}: SessionListProps) {
  const { t } = useTranslation()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const startRename = (session: SessionSummary) => {
    setEditingId(session.id)
    setDraft(session.title ?? '')
  }
  const commitRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim())
    setEditingId(null)
  }
  const onDraftKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setEditingId(null)
  }

  return (
    <nav aria-label={t('chat.conversations')} className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-semibold">{t('chat.conversations')}</span>
        <button
          type="button"
          onClick={onNew}
          aria-label={t('chat.new_conversation')}
          title={t('chat.new_conversation')}
          className="rounded-md p-1 text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {status === 'loading' && (
          <div className="flex justify-center py-6">
            <Spinner label={t('common.loading')} />
          </div>
        )}
        {status === 'error' && <ErrorState onRetry={onRetry} />}
        {status === 'ready' && sessions.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('chat.no_conversations')}
          </p>
        )}
        {status === 'ready' && (
          <ul className="space-y-0.5 px-2">
            {sessions.map((session) => {
              const active = session.id === currentId
              const title = session.title ?? t('chat.untitled')
              if (editingId === session.id) {
                return (
                  <li key={session.id} className="flex items-center gap-1 px-1 py-0.5">
                    <Input
                      autoFocus
                      value={draft}
                      maxLength={200}
                      aria-label={t('chat.rename_title')}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onDraftKey}
                      className="py-1"
                    />
                    <button
                      type="button"
                      onClick={commitRename}
                      aria-label={t('common.save')}
                      className="p-1 text-green-600"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      aria-label={t('common.cancel')}
                      className="p-1 text-gray-500"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                )
              }
              return (
                <li key={session.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSelect(session.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${
                      active
                        ? 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100'
                        : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {title}
                  </button>
                  <button
                    type="button"
                    onClick={() => startRename(session)}
                    aria-label={`${t('common.rename')}: ${title}`}
                    title={t('common.rename')}
                    className="rounded-md p-1 text-gray-500 opacity-100 hover:bg-gray-200 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 dark:hover:bg-gray-700"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingId(session.id)}
                    aria-label={`${t('common.delete')}: ${title}`}
                    title={t('common.delete')}
                    className="rounded-md p-1 text-gray-500 opacity-100 hover:bg-gray-200 hover:text-red-600 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 dark:hover:bg-gray-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog
        show={deletingId !== null}
        title={t('chat.delete_title')}
        message={t('chat.delete_message')}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deletingId) onDelete(deletingId)
          setDeletingId(null)
        }}
        onCancel={() => setDeletingId(null)}
      />
    </nav>
  )
}
