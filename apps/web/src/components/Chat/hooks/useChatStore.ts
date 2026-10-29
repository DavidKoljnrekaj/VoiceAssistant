// The one chat state, called once by ChatProvider. Ported from Landmark's useAiChatStore and
// trimmed: no attachments, no edit/regenerate, no cancel beacon (aborting the fetch is the
// cancel). The rendered view is `RenderMessage[]` plus `pendingText`; rows and events both flow
// through lib/normalizeMessages.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../../../contexts/AuthContext'
import { ApiHttpError } from '../../../types/api'
import { errorLabel } from '../lib/labels'
import {
  applyEvent,
  type ChatView,
  computeLeaf,
  EMPTY_VIEW,
  finishStream,
  normalizeFromPersistedRows,
  pushErrorMessage,
  type RenderMessage,
  type StreamOutcome,
  type ViewIds,
} from '../lib/normalizeMessages'
import {
  deleteSession as deleteSessionService,
  listSessions,
  loadSession,
  renameSession as renameSessionService,
  type SessionSummary,
  streamMessage,
} from '../services/chatService'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ChatStore {
  sessions: SessionSummary[]
  sessionsStatus: LoadStatus
  currentSessionId: string | null
  messages: RenderMessage[]
  /** Deltas of the assistant block being streamed, shown provisionally until its `turn`. */
  pendingText: string | null
  messagesStatus: LoadStatus
  isStreaming: boolean
  fetchSessions: () => Promise<void>
  newConversation: () => void
  selectSession: (id: string) => Promise<void>
  sendMessage: (text: string) => Promise<void>
  /** Aborts the fetch; the server reads the closed connection as the cancel. */
  stop: () => void
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
}

const ids: ViewIds = { genId: () => crypto.randomUUID(), now: () => new Date().toISOString() }

function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  )
}

export function useChatStore(): ChatStore {
  const { profile } = useAuth()
  const userId = profile?.id ?? null

  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionsStatus, setSessionsStatus] = useState<LoadStatus>('idle')
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [view, setView] = useState<ChatView>(EMPTY_VIEW)
  const [messagesStatus, setMessagesStatus] = useState<LoadStatus>('ready')
  const [isStreaming, setIsStreaming] = useState(false)

  // Refs mirror the state for closure-safe reads inside the async send path.
  const currentSessionIdRef = useRef<string | null>(null)
  const leafIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const isStreamingRef = useRef(false)
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])
  useEffect(() => {
    isStreamingRef.current = isStreaming
  }, [isStreaming])

  const abortStream = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
  }, [])

  // Everything is the signed-in user's; a sign-out or a different user empties it. The state is
  // reset during render (React's pattern for "reset on a changed input"); the refs in an effect.
  const [ownerId, setOwnerId] = useState<string | null>(userId)
  if (ownerId !== userId) {
    setOwnerId(userId)
    setSessions([])
    setSessionsStatus('idle')
    setCurrentSessionId(null)
    setView(EMPTY_VIEW)
    setMessagesStatus('ready')
    setIsStreaming(false)
  }
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    leafIdRef.current = null
    currentSessionIdRef.current = null
  }, [userId])

  useEffect(() => () => abortRef.current?.abort(), [])

  const pushError = useCallback((code: string, fallback: string) => {
    setView((prev) => pushErrorMessage(prev, code, errorLabel(code, fallback), ids))
  }, [])

  // `idle` doubles as the first load's "loading" state; a retry after an error stays on the error
  // state until the read settles, so nothing is set before the await.
  const fetchSessions = useCallback(async () => {
    if (!userId) return
    try {
      const rows = await listSessions()
      setSessions(rows)
      setSessionsStatus('ready')
    } catch {
      setSessionsStatus('error')
    }
  }, [userId])

  // The first list load, as a subscription: a sign-out before it settles drops the answer.
  useEffect(() => {
    if (!userId) return
    let active = true
    listSessions().then(
      (rows) => {
        if (!active) return
        setSessions(rows)
        setSessionsStatus('ready')
      },
      () => {
        if (active) setSessionsStatus('error')
      },
    )
    return () => {
      active = false
    }
  }, [userId])

  /** Replaces the view with the canonical rows of `sessionId`; a failed read is an error state. */
  const loadRows = useCallback(async (sessionId: string, mode: 'select' | 'reload') => {
    if (mode === 'select') setMessagesStatus('loading')
    try {
      const rows = await loadSession(sessionId)
      if (currentSessionIdRef.current !== sessionId) return
      leafIdRef.current = computeLeaf(rows)
      setView({ messages: normalizeFromPersistedRows(rows), pendingText: null })
      setMessagesStatus('ready')
    } catch {
      if (currentSessionIdRef.current !== sessionId) return
      if (mode === 'select') setMessagesStatus('error')
      // A failed reload after a stream keeps the live view: nothing is lost, the rows exist.
    }
  }, [])

  const newConversation = useCallback(() => {
    abortStream()
    currentSessionIdRef.current = null
    leafIdRef.current = null
    setCurrentSessionId(null)
    setView(EMPTY_VIEW)
    setMessagesStatus('ready')
  }, [abortStream])

  const selectSession = useCallback(
    async (id: string) => {
      if (id === currentSessionIdRef.current) return
      abortStream()
      currentSessionIdRef.current = id
      leafIdRef.current = null
      setCurrentSessionId(id)
      setView(EMPTY_VIEW)
      await loadRows(id, 'select')
    },
    [abortStream, loadRows],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!userId || !trimmed || isStreamingRef.current) return

      const sessionId = currentSessionIdRef.current
      const parentMessageId = leafIdRef.current
      const isNew = sessionId === null

      // Optimistic user row. Never double-written: the server persists the user row; on a dropped
      // connection before that, the row vanishes on the next reload (Landmark's documented caveat).
      setView((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { kind: 'user', id: ids.genId(), rowId: null, text: trimmed, createdAt: ids.now() },
        ],
      }))

      const controller = new AbortController()
      abortRef.current = controller
      setIsStreaming(true)
      isStreamingRef.current = true
      let outcome: StreamOutcome = 'completed'
      let streamedSessionId = sessionId

      try {
        await streamMessage({
          sessionId,
          message: trimmed,
          parentMessageId,
          route: window.location.pathname,
          signal: controller.signal,
          onEvent: (event) => {
            if (controller.signal.aborted) return
            if (event.type === 'session') {
              streamedSessionId = event.session_id
              if (isNew) {
                currentSessionIdRef.current = event.session_id
                setCurrentSessionId(event.session_id)
                const now = ids.now()
                setSessions((prev) => [
                  { id: event.session_id, title: null, channel: 'chat', created_at: now, updated_at: now },
                  ...prev,
                ])
              }
              return
            }
            if (event.type === 'error' && event.code !== 'persistence_error') outcome = 'failed'
            setView((prev) => applyEvent(prev, event, ids))
          },
        })
      } catch (err) {
        if (isAbort(err)) {
          outcome = 'stopped'
        } else {
          outcome = 'failed'
          if (err instanceof ApiHttpError) pushError(err.code, err.message)
          else if (err instanceof TypeError) pushError('network_error', '')
          else pushError('unknown_error', '')
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setIsStreaming(false)
          isStreamingRef.current = false
        }
      }

      // Only this stream's own tail touches the view: a newer select or new conversation has
      // already replaced it and aborted us.
      if (controller.signal.aborted && outcome !== 'stopped') return
      if (currentSessionIdRef.current !== streamedSessionId) return
      setView((prev) => finishStream(prev, outcome, ids))
      if (streamedSessionId && outcome !== 'stopped') await loadRows(streamedSessionId, 'reload')
      else if (streamedSessionId) {
        // Rows written before the stop stay; the leaf moves to them without replacing the view.
        try {
          leafIdRef.current = computeLeaf(await loadSession(streamedSessionId))
        } catch {
          /* the next send retries from the old leaf; the API rejects a parent outside the session */
        }
      }
      void fetchSessions()
    },
    [userId, loadRows, fetchSessions, pushError],
  )

  const stop = useCallback(() => {
    const controller = abortRef.current
    if (!controller) return
    // sendMessage's catch sees AbortError and finishes the view as 'stopped'.
    controller.abort()
  }, [])

  const renameSession = useCallback(
    async (id: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      try {
        await renameSessionService(id, trimmed)
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: trimmed } : s)))
      } catch (err) {
        pushError('rename_failed', err instanceof Error ? err.message : '')
      }
    },
    [pushError],
  )

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await deleteSessionService(id)
        setSessions((prev) => prev.filter((s) => s.id !== id))
        if (currentSessionIdRef.current === id) newConversation()
      } catch (err) {
        pushError('delete_failed', err instanceof Error ? err.message : '')
      }
    },
    [newConversation, pushError],
  )

  return useMemo<ChatStore>(
    () => ({
      sessions,
      sessionsStatus,
      currentSessionId,
      messages: view.messages,
      pendingText: view.pendingText,
      messagesStatus,
      isStreaming,
      fetchSessions,
      newConversation,
      selectSession,
      sendMessage,
      stop,
      renameSession,
      deleteSession,
    }),
    [
      sessions,
      sessionsStatus,
      currentSessionId,
      view,
      messagesStatus,
      isStreaming,
      fetchSessions,
      newConversation,
      selectSession,
      sendMessage,
      stop,
      renameSession,
      deleteSession,
    ],
  )
}
