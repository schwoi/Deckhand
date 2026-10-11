import { Bot, History, MessageSquare, Play, Server, Square } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './components/ui/Button'
import { ConfirmHost } from './components/ui/Dialog'
import { Toaster } from './components/ui/toast'
import { EditorPage } from './editor/EditorPage'
import { cn } from './lib/util'
import { AgentsPage } from './pages/AgentsPage'
import { ChatPage } from './pages/ChatPage'
import { SessionsPage } from './pages/SessionsPage'
import { SystemPage } from './pages/SystemPage'
import { type Route, href, useRoute } from './router'
import { RuntimeProvider, useRuntime } from './runtime'

export function App() {
  return (
    <RuntimeProvider>
      <Shell />
      <Toaster />
      <ConfirmHost />
    </RuntimeProvider>
  )
}

function Shell() {
  const route = useRoute()
  return (
    <div className="flex h-full min-h-0">
      <Sidebar route={route} />
      <main className="flex min-w-0 flex-1 flex-col">
        <Page route={route} />
      </main>
    </div>
  )
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'agents':
      return <AgentsPage />
    case 'editor':
      return <EditorPage key={route.name} name={route.name} />
    case 'chat':
      return (
        <ChatPage
          key={`${route.name ?? ''}:${route.session ?? ''}`}
          name={route.name}
          session={route.session}
        />
      )
    case 'sessions':
      return <SessionsPage />
    case 'system':
      return <SystemPage />
  }
}

function Sidebar({ route }: { route: Route }) {
  const section = route.page === 'editor' ? 'agents' : route.page
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r bg-sunken">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
        <Logo />
        <div className="leading-tight">
          <div className="text-base font-semibold tracking-tight">Agent Studio</div>
          <div className="text-2xs text-faint">for docker agent</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 p-2" aria-label="Main">
        <NavItem to={href.agents()} active={section === 'agents'} icon={<Bot />} label="Agents" />
        <NavItem
          to={href.chat()}
          active={section === 'chat'}
          icon={<MessageSquare />}
          label="Chat"
        />
        <NavItem
          to={href.sessions()}
          active={section === 'sessions'}
          icon={<History />}
          label="Sessions"
        />
        <NavItem
          to={href.system()}
          active={section === 'system'}
          icon={<Server />}
          label="System"
        />
      </nav>
      <div className="mt-auto p-2">
        <RuntimePill />
      </div>
    </aside>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <path d="M9 12h14M9 16h10M9 20h6" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function NavItem({
  to,
  active,
  icon,
  label,
}: { to: string; active: boolean; icon: ReactNode; label: string }) {
  return (
    <a
      href={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-base font-medium transition-colors [&_svg]:size-4',
        active
          ? 'bg-surface text-fg shadow-xs ring-1 ring-line'
          : 'text-muted hover:bg-hover hover:text-fg',
      )}
    >
      <span className={active ? 'text-accent-text' : 'text-faint'}>{icon}</span>
      {label}
    </a>
  )
}

const stateLabel = { stopped: 'Stopped', starting: 'Starting…', running: 'Running', error: 'Error' }
const stateDot = {
  stopped: 'bg-faint',
  starting: 'bg-warning animate-pulse',
  running: 'bg-success',
  error: 'bg-danger',
}

function RuntimePill() {
  const { status, offline, control, busy } = useRuntime()
  const state = status?.state ?? 'stopped'
  const running = state === 'running' || state === 'starting'
  return (
    <div className="rounded-lg border bg-surface p-2.5">
      <div className="flex items-center gap-2">
        <span
          className={cn('size-2 shrink-0 rounded-full', offline ? 'bg-danger' : stateDot[state])}
        />
        <div className="min-w-0 flex-1">
          <a href={href.system()} className="block text-sm font-medium hover:underline">
            Runtime {offline ? 'unreachable' : stateLabel[state].toLowerCase()}
          </a>
          <div
            className="truncate font-mono text-2xs text-faint"
            title={status?.error ?? status?.listen}
          >
            {offline
              ? 'Studio server is down'
              : state === 'error'
                ? (status?.error ?? 'failed')
                : (status?.listen ?? '—')}
          </div>
        </div>
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          disabled={offline}
          loading={busy}
          icon={running ? <Square /> : <Play />}
          title={running ? 'Stop runtime' : 'Start runtime'}
          onClick={() => control(running ? 'stop' : 'start')}
        />
      </div>
    </div>
  )
}
