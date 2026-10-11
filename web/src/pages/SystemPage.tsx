import type { CliVersion, DoctorReport, ModelInfo, ToolsetInfo } from '@shared/api'
import {
  Boxes,
  CircleCheck,
  CircleX,
  Cpu,
  ExternalLink,
  KeyRound,
  Play,
  RotateCw,
  Search,
  Square,
  Terminal,
  Wrench,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { api, errorText } from '../api'
import { Button } from '../components/ui/Button'
import { Switch } from '../components/ui/form'
import { Badge, Card, CardHeader, Code, Dot, PageHeader, Skeleton } from '../components/ui/misc'
import { relativeTime } from '../lib/util'
import { useRuntime } from '../runtime'

/** Fetch once on mount (or when deps change); errors become a string. */
function useLoad<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({
    data: null,
    error: null,
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: caller controls deps
  useEffect(() => {
    let live = true
    setState({ data: null, error: null })
    fn()
      .then((data) => live && setState({ data, error: null }))
      .catch((e) => live && setState({ data: null, error: errorText(e) }))
    return () => {
      live = false
    }
  }, deps)
  return state
}

export function SystemPage() {
  return (
    <>
      <PageHeader
        title="System"
        description="The docker agent CLI, the managed runtime, and what is available on this machine."
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
          <CliCard />
          {/* below lg the sidebar runtime pill is gone, so its controls lead the page */}
          <div className="min-w-0 max-lg:order-first">
            <RuntimeCard />
          </div>
          <div className="lg:col-span-2">
            <ProvidersCard />
          </div>
          <ModelsCard />
          <ToolsetsCard />
        </div>
      </div>
    </>
  )
}

function ErrorLine({ error }: { error: string }) {
  return <p className="px-4 py-3 text-sm text-danger">{error}</p>
}

function LoadingRows({ n = 3 }: { n?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: n }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <Skeleton key={i} className="h-5" />
      ))}
    </div>
  )
}

function CliCard() {
  const { data, error } = useLoad<CliVersion>(api.system.version)
  return (
    <Card>
      <CardHeader
        icon={<Terminal />}
        title="docker agent CLI"
        description="Used for validation, doctor, models, registry and the runtime."
      />
      {error && <ErrorLine error={error} />}
      {!data && !error && <LoadingRows n={2} />}
      {data?.installed && (
        <div className="flex items-center gap-2 px-4 py-4">
          <CircleCheck className="size-4 text-success" />
          <span className="text-base">Installed</span>
          <Badge tone="success" className="font-mono">
            {data.version ?? 'unknown version'}
          </Badge>
        </div>
      )}
      {data && !data.installed && (
        <div className="flex flex-col gap-3 px-4 py-4 text-base">
          <p className="flex items-center gap-2 text-danger">
            <CircleX className="size-4" /> Not installed{data.error ? `: ${data.error}` : ''}
          </p>
          <p className="text-muted">Install it one of these ways, then reload:</p>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted">
            <li>
              <span className="text-fg">Docker Desktop 4.63+</span> ships it. Update Docker Desktop
              and run <Code>docker agent version</Code>.
            </li>
            <li>
              Homebrew: <Code>brew install docker-agent</Code>
            </li>
            <li>
              Download the binary from{' '}
              <a
                href="https://github.com/docker/docker-agent/releases"
                target="_blank"
                rel="noreferrer"
                className="text-accent-text underline"
              >
                GitHub releases
              </a>{' '}
              to <Code>~/.docker/cli-plugins/docker-agent</Code> and <Code>chmod +x</Code> it.
            </li>
          </ol>
        </div>
      )}
    </Card>
  )
}

const tone = {
  stopped: 'neutral',
  starting: 'warning',
  running: 'success',
  error: 'danger',
} as const

function RuntimeCard() {
  const { status, offline, control, busy } = useRuntime()
  const logRef = useRef<HTMLPreElement>(null)
  const log = status?.logTail.join('\n') ?? ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: keep the log scrolled to the end
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])
  const state = status?.state ?? 'stopped'
  const active = state === 'running' || state === 'starting'
  return (
    <Card>
      <CardHeader
        icon={<Boxes />}
        title="Runtime"
        description="docker agent serve api, managed by Deckhand."
        actions={
          !active ? (
            <Button
              size="sm"
              variant="primary"
              icon={<Play />}
              loading={busy}
              disabled={offline}
              onClick={() => control('start')}
            >
              Start
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                icon={<RotateCw />}
                loading={busy}
                onClick={() => control('restart')}
              >
                Restart
              </Button>
              <Button size="sm" icon={<Square />} disabled={busy} onClick={() => control('stop')}>
                Stop
              </Button>
            </>
          )
        }
      />
      {offline ? (
        <ErrorLine error="The Deckhand server is unreachable." />
      ) : !status ? (
        <LoadingRows />
      ) : (
        <div className="flex flex-col gap-3 px-4 py-3">
          <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-base sm:grid-cols-[110px_1fr]">
            <dt className="text-faint">Status</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Badge tone={tone[state]}>
                <Dot tone={tone[state]} />
                {state}
              </Badge>
              {status.pid && <span className="font-mono text-xs text-faint">pid {status.pid}</span>}
              {status.startedAt && state === 'running' && (
                <span className="text-xs text-faint">since {relativeTime(status.startedAt)}</span>
              )}
            </dd>
            <dt className="text-faint">Listening on</dt>
            <dd className="min-w-0 truncate font-mono text-sm">{status.listen}</dd>
            <dt className="text-faint">Agents dir</dt>
            <dd className="min-w-0 truncate font-mono text-sm" title={status.agentsDir}>
              {status.agentsDir}
            </dd>
          </dl>
          {status.error && (
            <p className="rounded-md bg-danger-soft px-2.5 py-1.5 text-sm text-danger">
              {status.error}
            </p>
          )}
          <pre
            ref={logRef}
            className="h-44 overflow-auto overscroll-contain rounded-md border bg-sunken p-2.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap break-all text-muted max-sm:h-56 max-sm:break-normal max-sm:whitespace-pre"
          >
            {log || 'No log output yet.'}
          </pre>
        </div>
      )}
    </Card>
  )
}

function ProvidersCard() {
  const { data, error } = useLoad<DoctorReport>(api.system.doctor)
  return (
    <Card>
      <CardHeader
        icon={<KeyRound />}
        title="Providers"
        description="Credentials found in your environment (docker agent doctor)."
      />
      {error && <ErrorLine error={error} />}
      {!data && !error && <LoadingRows n={4} />}
      {data && (
        <div className="flex flex-col">
          <ul className="divide-y sm:hidden">
            {(data.providers ?? []).map((p) => (
              <li key={p.provider} className="flex flex-col gap-1 px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-mono text-sm">{p.provider}</span>
                  {p.found ? (
                    <Badge tone="success" title={p.source}>
                      found{p.source ? ` · ${p.source}` : ''}
                    </Badge>
                  ) : (
                    <Badge>missing</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {p.env_vars?.length ? (
                    p.env_vars.map((v) => (
                      <span key={v} className="font-mono text-xs break-all text-muted">
                        {v}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-faint">none required</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-base sm:table">
            <thead>
              <tr className="border-b text-left text-xs text-faint">
                <th className="px-4 py-1.5 font-medium">Provider</th>
                <th className="px-3 py-1.5 font-medium">Environment variables</th>
                <th className="px-4 py-1.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data.providers ?? []).map((p) => (
                <tr key={p.provider} className="border-b last:border-0">
                  <td className="px-4 py-1.5 font-mono text-sm">{p.provider}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex flex-wrap gap-1">
                      {p.env_vars?.length ? (
                        p.env_vars.map((v) => (
                          <span key={v} className="font-mono text-xs text-muted">
                            {v}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-faint">none required</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    {p.found ? (
                      <Badge tone="success" title={p.source}>
                        found{p.source ? ` · ${p.source}` : ''}
                      </Badge>
                    ) : (
                      <Badge>missing</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-1 gap-3 border-t px-4 py-3 text-base sm:grid-cols-2">
            <Fact label="Docker Model Runner">
              {data.dmr ? (
                <>
                  <Badge tone={/run|ok|avail/i.test(data.dmr.status) ? 'success' : 'neutral'}>
                    {data.dmr.status}
                  </Badge>
                  {data.dmr.models && data.dmr.models.length > 0 && (
                    <span className="truncate font-mono text-xs text-faint">
                      {data.dmr.models.join(', ')}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-faint">unknown</span>
              )}
            </Fact>
            <Fact label="Auto model">
              {data.auto_model ? (
                <>
                  <span className="font-mono text-sm">
                    {data.auto_model.provider}/{data.auto_model.model}
                  </span>
                  <Badge tone={data.auto_model.usable ? 'success' : 'warning'}>
                    {data.auto_model.usable ? 'usable' : 'not usable'}
                  </Badge>
                </>
              ) : (
                <span className="text-faint">none</span>
              )}
            </Fact>
            {data.user_config && (
              <Fact label="User config">
                <span className="truncate font-mono text-xs">{data.user_config.path}</span>
                <span className="text-xs text-faint">{data.user_config.status}</span>
              </Fact>
            )}
          </div>
          {(data.issues ?? []).length > 0 && (
            <ul className="flex flex-col gap-1.5 border-t px-4 py-3">
              {(data.issues ?? []).map((i) => (
                <li key={i} className="rounded-md bg-warning-soft px-3 py-1.5 text-sm">
                  {i}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-faint">{label}</span>
      <span className="flex min-w-0 items-center gap-2">{children}</span>
    </div>
  )
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="control flex h-7 w-full items-center gap-1.5 px-2 max-lg:h-10 max-lg:px-2.5 sm:w-44">
      <Search className="size-3.5 shrink-0 text-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        type="search"
        enterKeyHint="search"
        className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-faint"
      />
    </div>
  )
}

function ModelsCard() {
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const { data, error } = useLoad<ModelInfo[]>(() => api.system.models(all), [all])
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    const map = new Map<string, ModelInfo[]>()
    for (const m of data ?? []) {
      if (s && !`${m.provider}/${m.model}`.toLowerCase().includes(s)) continue
      map.set(m.provider, [...(map.get(m.provider) ?? []), m])
    }
    return [...map]
  }, [data, q])
  return (
    <Card className="flex max-h-[520px] flex-col">
      <CardHeader
        icon={<Cpu />}
        title="Models"
        description={all ? 'All providers.' : 'Providers you have credentials for.'}
        actions={<SearchBox value={q} onChange={setQ} placeholder="Filter models" />}
      />
      <div className="border-b px-4 py-2">
        <Switch checked={all} onChange={setAll} label="Show all providers" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <ErrorLine error={error} />}
        {!data && !error && <LoadingRows n={6} />}
        {data && groups.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            No models{q ? ` match “${q}”` : ''}.
          </p>
        )}
        {groups.map(([provider, models]) => (
          <section key={provider} className="border-b last:border-0">
            <h4 className="sticky top-0 bg-surface px-4 pt-2.5 pb-1 text-2xs font-semibold tracking-wide text-faint uppercase">
              {provider} <span className="font-normal">· {models.length}</span>
            </h4>
            <ul className="px-4 pb-2.5">
              {models.map((m) => (
                <li key={m.model} className="flex items-center gap-2 py-0.5">
                  <button
                    type="button"
                    className="truncate text-left font-mono text-xs hover:text-accent-text max-lg:py-1.5"
                    title="Copy provider/model"
                    onClick={() => navigator.clipboard.writeText(`${m.provider}/${m.model}`)}
                  >
                    {m.model}
                  </button>
                  {m.default && <Badge tone="accent">default</Badge>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  )
}

function ToolsetsCard() {
  const { data, error } = useLoad<ToolsetInfo[]>(api.system.toolsets)
  const [q, setQ] = useState('')
  const list = (data ?? []).filter(
    (t) => !q || `${t.type} ${t.summary}`.toLowerCase().includes(q.toLowerCase()),
  )
  return (
    <Card className="flex max-h-[520px] flex-col">
      <CardHeader
        icon={<Wrench />}
        title="Toolsets"
        description="Built-in toolset types for an agent's toolsets list."
        actions={<SearchBox value={q} onChange={setQ} placeholder="Filter toolsets" />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <ErrorLine error={error} />}
        {!data && !error && <LoadingRows n={6} />}
        <ul className="divide-y">
          {list.map((t) => (
            <li key={t.type} className="flex items-start gap-3 px-4 py-2 max-sm:py-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:gap-3">
                <span className="font-mono text-sm font-medium sm:w-32 sm:shrink-0">{t.type}</span>
                <span className="min-w-0 flex-1 text-sm text-muted">{t.summary}</span>
              </div>
              {t.docs && (
                <a
                  href={t.docs}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-faint hover:text-accent-text max-lg:-m-2 max-lg:p-2"
                  title="Documentation"
                  aria-label={`${t.type} documentation`}
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}
