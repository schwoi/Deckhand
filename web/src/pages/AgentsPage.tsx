import type { AgentSummary, CommandResult, TemplateInfo } from '@shared/api'
import { TEMPLATES } from '@shared/templates'
import {
  Bot,
  Copy,
  Cpu,
  Download,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  Users,
  Wrench,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api, errorText } from '../api'
import { Button } from '../components/ui/Button'
import { Dialog, confirmDialog } from '../components/ui/Dialog'
import { Field, Input } from '../components/ui/form'
import { Badge, EmptyState, OutputBox, PageHeader, Skeleton } from '../components/ui/misc'
import { toast } from '../components/ui/toast'
import { NAME_RE, cn, relativeTime, uniqueKey } from '../lib/util'
import { href, navigate } from '../router'

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<'new' | 'import' | { duplicate: AgentSummary } | null>(null)

  const load = useCallback(async () => {
    try {
      setAgents(await api.agents.list())
    } catch (e) {
      toast.error(`Could not load agents: ${errorText(e)}`)
      setAgents((a) => a ?? [])
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!agents || !q) return agents
    return agents.filter((a) =>
      [a.name, a.description, a.rootModel, ...a.tags].some((s) => s.toLowerCase().includes(q)),
    )
  }, [agents, query])

  const remove = async (a: AgentSummary) => {
    const ok = await confirmDialog({
      title: `Delete ${a.name}?`,
      message: (
        <>
          This permanently deletes <span className="font-mono text-fg">{a.file}</span>.
        </>
      ),
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await api.agents.remove(a.name)
      toast.success(`Deleted ${a.name}`)
      load()
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  const names = agents?.map((a) => a.name) ?? []

  return (
    <>
      <PageHeader
        title="Agents"
        description={
          agents ? `${agents.length} agent file${agents.length === 1 ? '' : 's'}` : 'Loading…'
        }
        actions={
          <>
            <Button icon={<Download />} onClick={() => setDialog('import')}>
              Import from registry
            </Button>
            <Button variant="primary" icon={<Plus />} onClick={() => setDialog('new')}>
              New agent
            </Button>
          </>
        }
      >
        <div className="control flex h-8 w-64 items-center gap-2 px-2.5">
          <Search className="size-3.5 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents"
            aria-label="Search agents"
            className="w-full min-w-0 bg-transparent text-base outline-none placeholder:text-faint"
          />
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {!filtered ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        ) : agents?.length === 0 ? (
          <EmptyState
            icon={<Bot />}
            title="No agents yet"
            description="Create an agent from a template, or import one from an OCI registry."
            action={
              <>
                <Button icon={<Download />} onClick={() => setDialog('import')}>
                  Import
                </Button>
                <Button variant="primary" icon={<Plus />} onClick={() => setDialog('new')}>
                  New agent
                </Button>
              </>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="No matches"
            description={`Nothing matches “${query}”.`}
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {filtered.map((a) => (
              <AgentCard
                key={a.name}
                agent={a}
                onDuplicate={() => setDialog({ duplicate: a })}
                onDelete={() => remove(a)}
              />
            ))}
          </div>
        )}
      </div>

      <NewAgentDialog open={dialog === 'new'} onClose={() => setDialog(null)} existing={names} />
      <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} onImported={load} />
      <DuplicateDialog
        source={typeof dialog === 'object' && dialog ? dialog.duplicate : null}
        onClose={() => setDialog(null)}
        existing={names}
        onDone={load}
      />
    </>
  )
}

function AgentCard({
  agent: a,
  onDuplicate,
  onDelete,
}: { agent: AgentSummary; onDuplicate: () => void; onDelete: () => void }) {
  return (
    <div className="group relative flex flex-col rounded-lg border bg-surface transition-colors hover:border-line-strong">
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start gap-2">
          <a
            href={href.editor(a.name)}
            className="min-w-0 flex-1 truncate text-md font-semibold after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-accent"
          >
            {a.name}
          </a>
          {a.agentCount > 1 && (
            <Badge tone="accent">
              <Users /> team · {a.agentCount}
            </Badge>
          )}
          {!a.valid && (
            <Badge tone="danger" title={a.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}>
              <TriangleAlert /> {a.issues.length} issue{a.issues.length === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
        <p
          className={cn(
            'line-clamp-2 min-h-10 text-base',
            a.description ? 'text-muted' : 'text-faint italic',
          )}
        >
          {a.description || 'No description'}
        </p>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="flex min-w-0 items-center gap-1.5" title="Root model">
            <Cpu className="size-3.5 shrink-0 text-faint" />
            <span className="truncate font-mono text-xs">{a.rootModel || '—'}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5" title="Toolsets">
            <Wrench className="size-3.5 text-faint" />
            {a.toolsetCount}
          </span>
        </div>
        {a.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {a.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        )}
      </div>
      <div className="relative z-10 flex items-center gap-1 border-t px-2 py-1.5">
        <span className="flex-1 pl-2 text-xs text-faint">Updated {relativeTime(a.updatedAt)}</span>
        <Button
          size="xs"
          variant="ghost"
          icon={<MessageSquare />}
          disabled={!a.valid}
          title={a.valid ? 'Chat with this agent' : 'Fix validation issues first'}
          onClick={() => navigate(href.chat(a.name))}
        >
          Chat
        </Button>
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          icon={<Copy />}
          title="Duplicate"
          onClick={onDuplicate}
        />
        <Button
          size="xs"
          variant="danger-ghost"
          iconOnly
          icon={<Trash2 />}
          title="Delete"
          onClick={onDelete}
        />
      </div>
    </div>
  )
}

function nameError(name: string, existing: string[]): string | undefined {
  if (!name) return undefined
  if (!NAME_RE.test(name))
    return 'Use letters, digits, dot, dash or underscore; start with a letter or digit.'
  if (existing.includes(name)) return 'An agent with this name already exists.'
  return undefined
}

function NewAgentDialog({
  open,
  onClose,
  existing,
}: { open: boolean; onClose: () => void; existing: string[] }) {
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('assistant')
  const [templates, setTemplates] = useState<TemplateInfo[]>(TEMPLATES)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    api
      .templates()
      .then((t) => t.length && setTemplates(t))
      .catch(() => {})
  }, [open])

  const error = nameError(name, existing)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name || error) return
    setBusy(true)
    try {
      await api.agents.create({ name, template })
      onClose()
      navigate(href.editor(name))
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New agent"
      description="Creates a YAML file in the agents directory."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="new-agent"
            loading={busy}
            disabled={!name || !!error}
          >
            Create agent
          </Button>
        </>
      }
    >
      <form id="new-agent" onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Name"
          htmlFor="new-name"
          error={error}
          help="Also the file name and the agent id used by the runtime."
        >
          <Input
            id="new-name"
            mono
            autoFocus
            value={name}
            aria-invalid={!!error}
            placeholder="my-agent"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Template</legend>
          {templates.map((t) => (
            <label
              key={t.id}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors',
                template === t.id ? 'border-accent bg-accent-soft/50' : 'hover:bg-hover',
              )}
            >
              <input
                type="radio"
                name="template"
                value={t.id}
                checked={template === t.id}
                onChange={() => setTemplate(t.id)}
                className="mt-1 accent-[var(--accent)]"
              />
              <span className="min-w-0">
                <span className="block text-base font-medium">{t.title}</span>
                <span className="block text-sm text-muted">{t.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </form>
    </Dialog>
  )
}

function DuplicateDialog({
  source,
  onClose,
  existing,
  onDone,
}: { source: AgentSummary | null; onClose: () => void; existing: string[]; onDone: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when a new source is chosen
  useEffect(() => {
    if (source) setName(uniqueKey(existing, `${source.name}-copy`))
  }, [source])
  const error = nameError(name, existing)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!source || !name || error) return
    setBusy(true)
    try {
      await api.agents.duplicate(source.name, name)
      toast.success(`Duplicated ${source.name} as ${name}`)
      onClose()
      onDone()
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={!!source}
      onClose={onClose}
      title={`Duplicate ${source?.name ?? ''}`}
      width="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="dup-agent"
            loading={busy}
            disabled={!name || !!error}
          >
            Duplicate
          </Button>
        </>
      }
    >
      <form id="dup-agent" onSubmit={submit}>
        <Field label="New name" htmlFor="dup-name" error={error}>
          <Input
            id="dup-name"
            mono
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  )
}

function defaultPullName(ref: string): string {
  const last = ref.trim().split('/').pop() ?? ''
  return last.split('@')[0]?.split(':')[0] ?? ''
}

function ImportDialog({
  open,
  onClose,
  onImported,
}: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [ref, setRef] = useState('')
  const [name, setName] = useState('')
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CommandResult | null>(null)

  useEffect(() => {
    if (open) setResult(null)
  }, [open])

  const nameErr = name && !NAME_RE.test(name) ? 'Invalid name' : undefined
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ref.trim() || nameErr) return
    setBusy(true)
    setResult(null)
    try {
      const { result: res, agent } = await api.registry.pull({
        ref: ref.trim(),
        name: name || undefined,
        force,
      })
      if (!res.ok || !agent) {
        setResult(res)
        return
      }
      toast.success(`Imported ${agent.name}`)
      onClose()
      onImported()
      navigate(href.editor(agent.name))
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import from registry"
      description="Pull an agent published with docker agent share push."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="pull-agent"
            loading={busy}
            disabled={!ref.trim() || !!nameErr}
          >
            Pull
          </Button>
        </>
      }
    >
      <form id="pull-agent" onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Reference"
          htmlFor="pull-ref"
          help="e.g. docker.io/docker/github-agent:latest"
        >
          <Input
            id="pull-ref"
            mono
            autoFocus
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="namespace/agent:tag"
          />
        </Field>
        <Field
          label="Local name"
          htmlFor="pull-name"
          error={nameErr}
          help={`Optional. Defaults to “${defaultPullName(ref) || 'the last path segment'}”.`}
        >
          <Input id="pull-name" mono value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-base">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Overwrite an existing agent with the same name
        </label>
        {result && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-danger">
              Pull failed (exit code {result.exitCode})
            </p>
            <OutputBox text={[result.stderr, result.stdout].filter(Boolean).join('\n')} />
          </div>
        )}
      </form>
    </Dialog>
  )
}
