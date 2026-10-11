import type { RuntimeStatus } from '@shared/api'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, errorText } from './api'
import { toast } from './components/ui/toast'

interface RuntimeCtx {
  status: RuntimeStatus | null
  /** true when the Deckhand server itself cannot be reached */
  offline: boolean
  refresh: () => Promise<void>
  control: (action: 'start' | 'stop' | 'restart') => Promise<void>
  busy: boolean
}

const Ctx = createContext<RuntimeCtx | null>(null)

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [offline, setOffline] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.runtime.status())
      setOffline(false)
    } catch {
      setOffline(true)
    }
  }, [])

  const state = status?.state
  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, state === 'starting' ? 2000 : 10000)
    return () => window.clearInterval(id)
  }, [refresh, state])

  const control = useCallback(async (action: 'start' | 'stop' | 'restart') => {
    setBusy(true)
    // start/restart block until the runtime is up; show progress (and poll faster) meanwhile
    if (action !== 'stop') setStatus((s) => (s ? { ...s, state: 'starting', error: undefined } : s))
    try {
      const next = await api.runtime[action]()
      setStatus(next)
      if (next.state === 'error') toast.error(next.error ?? 'Runtime failed to start')
    } catch (e) {
      toast.error(`Could not ${action} runtime: ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }, [])

  return <Ctx.Provider value={{ status, offline, refresh, control, busy }}>{children}</Ctx.Provider>
}

export function useRuntime(): RuntimeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRuntime outside RuntimeProvider')
  return ctx
}
