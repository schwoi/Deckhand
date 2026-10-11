import { useSyncExternalStore } from 'react'

export type Route =
  | { page: 'agents' }
  | { page: 'editor'; name: string }
  | { page: 'chat'; name?: string; session?: string }
  | { page: 'sessions' }
  | { page: 'system' }

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?')
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
  const params = new URLSearchParams(query)
  const [head, arg] = parts
  if (head === 'agents' && arg) return { page: 'editor', name: arg }
  if (head === 'chat')
    return { page: 'chat', name: arg, session: params.get('session') ?? undefined }
  if (head === 'sessions') return { page: 'sessions' }
  if (head === 'system') return { page: 'system' }
  return { page: 'agents' }
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return parseRoute(hash)
}

export const href = {
  agents: () => '#/agents',
  editor: (name: string) => `#/agents/${encodeURIComponent(name)}`,
  chat: (name?: string, session?: string) =>
    `#/chat${name ? `/${encodeURIComponent(name)}` : ''}${session ? `?session=${encodeURIComponent(session)}` : ''}`,
  sessions: () => '#/sessions',
  system: () => '#/system',
}

export function navigate(to: string, replace = false) {
  if (replace) {
    history.replaceState(null, '', to)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = to
  }
}
