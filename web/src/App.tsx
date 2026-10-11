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
  const section = route.page === 'editor' ? 'agents' : route.page
  return (
    <div className="flex h-dvh min-h-0 flex-col pt-[env(safe-area-inset-top)] lg:flex-row">
      <Sidebar section={section} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col max-lg:pr-[env(safe-area-inset-right)] max-lg:pl-[env(safe-area-inset-left)]">
        <Page route={route} />
      </main>
      <TabBar section={section} />
    </div>
  )
}

type Section = 'agents' | 'chat' | 'sessions' | 'system'
const NAV: { id: Section; to: string; label: string; icon: ReactNode }[] = [
  { id: 'agents', to: href.agents(), label: 'Agents', icon: <Bot /> },
  { id: 'chat', to: href.chat(), label: 'Chat', icon: <MessageSquare /> },
  { id: 'sessions', to: href.sessions(), label: 'Sessions', icon: <History /> },
  { id: 'system', to: href.system(), label: 'System', icon: <Server /> },
]

/** Bottom navigation below lg. Part of the flex column, so it never covers page content. */
function TabBar({ section }: { section: Section }) {
  const { status, offline } = useRuntime()
  const state = status?.state ?? 'stopped'
  return (
    <nav
      data-tabbar
      aria-label="Main"
      className="flex shrink-0 border-t bg-surface pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] lg:hidden"
    >
      {NAV.map((n) => {
        const active = section === n.id
        return (
          <a
            key={n.id}
            href={n.to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex min-h-14 flex-1 select-none flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors',
              active ? 'text-fg' : 'text-faint active:text-fg',
            )}
          >
            <span
              className={cn(
                'relative flex h-7 w-14 items-center justify-center rounded-full transition-colors [&_svg]:size-5',
                active ? 'bg-accent-soft text-accent-text' : 'group-active:bg-hover',
              )}
            >
              {n.icon}
              {n.id === 'system' && (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute top-0.5 right-3 size-2 rounded-full ring-2 ring-surface',
                      offline ? 'bg-danger' : stateDot[state],
                    )}
                  />
                  <span className="sr-only">
                    {offline ? 'Runtime unreachable' : `Runtime ${stateLabel[state].toLowerCase()}`}
                  </span>
                </>
              )}
            </span>
            {n.label}
          </a>
        )
      })}
    </nav>
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

function Sidebar({ section }: { section: Section }) {
  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r bg-sunken lg:flex">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
        <Logo />
        <div className="leading-tight">
          <div className="text-base font-semibold tracking-tight">Deckhand</div>
          <div className="text-2xs text-faint">for docker agent</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 p-2" aria-label="Main">
        {NAV.map((n) => (
          <NavItem key={n.id} to={n.to} active={section === n.id} icon={n.icon} label={n.label} />
        ))}
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
              ? 'Deckhand server is down'
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
