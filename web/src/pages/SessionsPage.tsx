import type { RuntimeSessionSummary } from '@shared/api'
import { History, MessageSquare, RefreshCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type RuntimeSession, api, errorText } from '../api'
import { MessageList } from '../chat/MessageList'
import { historyToItems } from '../chat/model'
import { RuntimeGate } from '../components/RuntimeGate'
import { Button } from '../components/ui/Button'
import { confirmDialog } from '../components/ui/Dialog'
import { EmptyState, PageHeader, Skeleton, Spinner } from '../components/ui/misc'
import { toast } from '../components/ui/toast'
import { cn, formatCost, formatTokens, relativeTime } from '../lib/util'
import { href, navigate } from '../router'

export function SessionsPage() {
  return (
    <>
      <PageHeader title="Sessions" description="Conversations stored by the runtime." />
      <RuntimeGate purpose="Browsing sessions">
        <SessionsView />
      </RuntimeGate>
    </>
  )
}

function SessionsView() {
  const [sessions, setSessions] = useState<RuntimeSessionSummary[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await api.rt.sessions()
      setSessions([...list].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    } catch (e) {
      toast.error(`Could not load sessions: ${errorText(e)}`)
      setSessions((s) => s ?? [])
    } finally {
      setRefreshing(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const remove = async (s: RuntimeSessionSummary) => {
    const ok = await confirmDialog({
      title: 'Delete session?',
      message: `“${s.title || 'Untitled'}” and its ${s.num_messages} messages will be deleted.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await api.rt.deleteSession(s.id)
      if (selected === s.id) setSelected(null)
      setSessions((list) => list?.filter((x) => x.id !== s.id) ?? null)
      toast.success('Session deleted')
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  const current = sessions?.find((s) => s.id === selected)

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto">
        {!sessions ? (
          <div className="flex flex-col gap-2 p-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            className="mt-10"
            icon={<History />}
            title="No sessions yet"
            description="Sessions appear here after you chat with an agent."
            action={<Button onClick={() => navigate(href.chat())}>Start a chat</Button>}
          />
        ) : (
          <table className="w-full border-collapse text-base">
            <thead className="sticky top-0 z-10 bg-canvas">
              <tr className="border-b text-left text-xs text-faint">
                <th className="px-6 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 text-right font-medium">Messages</th>
                <th className="px-3 py-2 text-right font-medium">Tokens in / out</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="w-12 px-3 py-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    iconOnly
                    icon={<RefreshCw className={cn(refreshing && 'animate-spin')} />}
                    title="Refresh"
                    onClick={load}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the title button is the keyboard target
                <tr
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={cn(
                    'cursor-pointer border-b transition-colors',
                    s.id === selected ? 'bg-accent-soft/50' : 'hover:bg-hover',
                  )}
                >
                  <td className="max-w-0 px-6 py-2">
                    <button
                      type="button"
                      className="block w-full truncate text-left font-medium focus-visible:outline-offset-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelected(s.id)
                      }}
                    >
                      {s.title || <span className="text-faint italic">Untitled</span>}
                    </button>
                  </td>
                  <td
                    className="px-3 py-2 whitespace-nowrap text-muted"
                    title={new Date(s.created_at).toLocaleString()}
                  >
                    {relativeTime(s.created_at)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted tabular-nums">{s.num_messages}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap text-muted tabular-nums">
                    {formatTokens(s.input_tokens)} / {formatTokens(s.output_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted tabular-nums">
                    {s.cost ? formatCost(s.cost) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      size="xs"
                      variant="danger-ghost"
                      iconOnly
                      icon={<Trash2 />}
                      title="Delete session"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(s)
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {current && (
        <SessionPanel
          key={current.id}
          summary={current}
          onClose={() => setSelected(null)}
          onDelete={() => remove(current)}
        />
      )}
    </div>
  )
}

function SessionPanel({
  summary,
  onClose,
  onDelete,
}: { summary: RuntimeSessionSummary; onClose: () => void; onDelete: () => void }) {
  const [session, setSession] = useState<RuntimeSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.rt
      .session(summary.id)
      .then(setSession)
      .catch((e) => setError(errorText(e)))
  }, [summary.id])
  const items = useMemo(() => (session ? historyToItems(session) : []), [session])
  const rootAgent = items.find((i) => i.kind === 'assistant')
  return (
    <aside className="flex w-[min(560px,48%)] shrink-0 animate-fade-in flex-col border-l bg-surface">
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-md font-semibold">{summary.title || 'Untitled session'}</h2>
          <p className="truncate font-mono text-2xs text-faint">{summary.id}</p>
        </div>
        <Button size="sm" variant="ghost" iconOnly icon={<X />} title="Close" onClick={onClose} />
      </div>
      <div className="flex items-center gap-1.5 border-b px-4 py-2">
        <Button
          size="sm"
          variant="primary"
          icon={<MessageSquare />}
          onClick={() => navigate(href.chat(undefined, summary.id))}
        >
          Continue in chat
        </Button>
        <Button size="sm" variant="danger-ghost" icon={<Trash2 />} onClick={onDelete}>
          Delete
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        {!session && !error && <Spinner label="Loading messages…" />}
        {session && items.length === 0 && (
          <p className="text-sm text-muted">This session has no messages.</p>
        )}
        {session && (
          <MessageList
            items={items}
            rootAgent={rootAgent && 'agent' in rootAgent ? rootAgent.agent : undefined}
          />
        )}
      </div>
    </aside>
  )
}
