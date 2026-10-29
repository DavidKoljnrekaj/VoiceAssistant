/* eslint-disable react-refresh/only-export-components */
// Transient notices (microphone denied, call failed). Chat failures do not come here: they are
// inline error rows in the message list (one mechanism, docs/WEB.md).
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

import ToastContainer from '../components/ui/Toast'

export type ToastVariant = 'info' | 'success' | 'error'

export interface ToastItem {
  id: string
  message: string
  variant: ToastVariant
}

interface ToastApi {
  info: (message: string) => void
  success: (message: string) => void
  error: (message: string) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (api === null) throw new Error('useToast must be used within <ToastProvider>')
  return api
}

const DISMISS_MS = 4500

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const add = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = crypto.randomUUID()
      setToasts((prev) => [...prev, { id, message, variant }])
      setTimeout(() => dismiss(id), DISMISS_MS)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      info: (m) => add(m, 'info'),
      success: (m) => add(m, 'success'),
      error: (m) => add(m, 'error'),
      dismiss,
    }),
    [add, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}
