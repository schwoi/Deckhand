import type { EnvironmentInfo } from '@shared/api'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, errorText, setApiEnvironment } from './api'
import { toast } from './components/ui/toast'

/** The instance serving this page; everything else is a remote Deckhand reached via /api/env/:id. */
export const LOCAL: EnvironmentInfo = {
  id: 'local',
  name: 'This machine',
  url: '',
  hasToken: false,
  insecure: false,
  allowInsecure: false,
}

const STORAGE_KEY = 'deckhand.env'

interface EnvCtx {
  environments: EnvironmentInfo[]
  current: EnvironmentInfo
  select: (id: string) => void
  refresh: () => Promise<void>
}

const Ctx = createContext<EnvCtx | null>(null)

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [environments, setEnvironments] = useState<EnvironmentInfo[]>([])
  const [currentId, setCurrentId] = useState(() => {
    // Set synchronously: children's effects (which fetch) run before this provider's.
    const id = localStorage.getItem(STORAGE_KEY) ?? LOCAL.id
    setApiEnvironment(id)
    return id
  })

  const refresh = useCallback(async () => {
    try {
      setEnvironments(await api.environments.list())
    } catch (e) {
      toast.error(`Could not load environments: ${errorText(e)}`)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const select = useCallback((id: string) => {
    setApiEnvironment(id)
    localStorage.setItem(STORAGE_KEY, id)
    setCurrentId(id)
  }, [])

  const current = environments.find((e) => e.id === currentId) ?? LOCAL
  // A stored id whose environment was deleted (possibly from another tab) falls back to local.
  const resolvedId = current.id
  useEffect(() => {
    if (resolvedId !== currentId && environments.length > 0) select(resolvedId)
  }, [resolvedId, currentId, environments.length, select])

  return <Ctx.Provider value={{ environments, current, select, refresh }}>{children}</Ctx.Provider>
}

export function useEnvironments(): EnvCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEnvironments outside EnvironmentProvider')
  return ctx
}
