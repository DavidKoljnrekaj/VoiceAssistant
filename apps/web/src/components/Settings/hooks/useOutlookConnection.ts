// The Outlook connection's state for Settings: loaded once, reloaded after a disconnect. Connect
// leaves the page (the browser goes to Microsoft), so it has no success state of its own here.
import { useCallback, useEffect, useState } from 'react'

import {
  type Connection,
  disconnectOutlook,
  loadIntegrations,
  startOutlookConnect,
} from '../services/integrationsService'

export type OutlookState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; connection: Connection | null }

export interface OutlookConnection {
  state: OutlookState
  busy: boolean
  reload: () => void
  /** Sends the browser to Microsoft; rejects when the API refused to start. */
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}

export function useOutlookConnection(redirect: (url: string) => void): OutlookConnection {
  const [state, setState] = useState<OutlookState>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)

  // Only the answer sets state, so the first load can run from an effect.
  const load = useCallback(() => {
    loadIntegrations().then(
      (s) => {
        if (!s.available.microsoft) return setState({ kind: 'unavailable' })
        const connection =
          s.integrations.find((i) => i.provider === 'microsoft' && i.status !== 'revoked') ?? null
        setState({ kind: 'ready', connection })
      },
      () => setState({ kind: 'error' }),
    )
  }, [])

  useEffect(load, [load])

  const reload = useCallback(() => {
    setState({ kind: 'loading' })
    load()
  }, [load])

  const connect = useCallback(async () => {
    setBusy(true)
    try {
      redirect(await startOutlookConnect())
    } finally {
      setBusy(false)
    }
  }, [redirect])

  const disconnect = useCallback(async () => {
    setBusy(true)
    try {
      await disconnectOutlook()
    } finally {
      setBusy(false)
    }
    reload()
  }, [reload])

  return { state, busy, reload, connect, disconnect }
}
