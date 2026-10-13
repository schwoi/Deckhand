import type { AgentDetail, ValidationIssue } from '@shared/api'
import type { AgentFile } from '@shared/config'
import {
  ChevronDown,
  ChevronLeft,
  CircleCheck,
  FileWarning,
  MessageSquare,
  Save,
  Stethoscope,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { YAMLParseError, parse, stringify } from 'yaml'
import { api, errorText } from '../api'
import { Button } from '../components/ui/Button'
import { confirmDialog } from '../components/ui/Dialog'
import { Menu } from '../components/ui/Menu'
import { EmptyState, Skeleton, Spinner } from '../components/ui/misc'
import { toast } from '../components/ui/toast'
import { cn, isPlainObject } from '../lib/util'
import { href, navigate } from '../router'
import { useRuntime } from '../runtime'
import { AgentsSection, orderedAgentNames } from './AgentsSection'
import { McpsSection } from './McpsSection'
import { MetadataSection } from './MetadataSection'
import { ModelsSection } from './ModelsSection'
import { PermissionsSection } from './PermissionsSection'
import { TopologySection } from './TopologySection'
import { type ParseError, YamlEditor } from './YamlEditor'
import { SECTIONS, type SectionId, sectionForPath } from './catalog'
import { DoctorDialog, PushDialog } from './dialogs'
import { revealField } from './reveal'

const toYaml = (c: AgentFile) => stringify(c, { lineWidth: 0 })

function parseConfig(text: string): { config: AgentFile } | { error: ParseError } {
  try {
    const doc: unknown = parse(text)
    if (!isPlainObject(doc))
      return { error: { message: 'The document must be a YAML mapping with an agents key.' } }
    return { config: doc as AgentFile }
  } catch (e) {
    if (e instanceof YAMLParseError)
      return {
        error: { message: e.message.split('\n')[0] ?? e.message, line: e.linePos?.[0].line },
      }
    return { error: { message: errorText(e) } }
  }
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function EditorPage({ name }: { name: string }) {
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [yamlText, setYamlText] = useState('')
  const [savedYaml, setSavedYaml] = useState('')
  const [config, setConfig] = useState<AgentFile | null>(null)
  const [parseError, setParseError] = useState<ParseError | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [validating, setValidating] = useState(false)
  const [section, setSection] = useState<SectionId>('agents')
  const [agent, setAgent] = useState('root')
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [dialog, setDialog] = useState<'doctor' | 'push' | null>(null)
  const [saving, setSaving] = useState(false)
  const validated = useRef('')
  const runtime = useRuntime()
  const sectionNav = useRef<HTMLElement>(null)

  // keep the active section visible in the horizontally scrolling strip (below lg)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the section changes
  useEffect(() => {
    sectionNav.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [section])

  const dirty = !!detail && yamlText !== savedYaml

  useEffect(() => {
    api.agents
      .get(name)
      .then((d) => {
        setDetail(d)
        setYamlText(d.yaml)
        setSavedYaml(d.yaml)
        setIssues(d.issues)
        validated.current = d.yaml
        const parsed = parseConfig(d.yaml)
        if ('config' in parsed) {
          setConfig(parsed.config)
          setAgent(orderedAgentNames(parsed.config)[0] ?? 'root')
        } else {
          setParseError(parsed.error)
          setSection('yaml')
        }
      })
      .catch((e) => setLoadError(errorText(e)))
  }, [name])

  // Live validation, debounced.
  useEffect(() => {
    if (!detail || yamlText === validated.current) return
    const ctl = new AbortController()
    const timer = window.setTimeout(async () => {
      setValidating(true)
      try {
        const res = await api.validate(yamlText, ctl.signal)
        validated.current = yamlText
        setIssues(res.issues)
      } catch (e) {
        if (!(e instanceof DOMException)) console.warn('validate failed', e)
      } finally {
        setValidating(false)
      }
    }, 400)
    return () => {
      window.clearTimeout(timer)
      ctl.abort()
    }
  }, [yamlText, detail])

  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${name} · Deckhand`
    return () => {
      document.title = 'Deckhand'
    }
  }, [dirty, name])

  // Guard unsaved changes: browser unload, and in-app hash navigation (reverted, then confirmed).
  const leaving = useRef(false)
  useEffect(() => {
    if (!dirty) return
    const here = window.location.hash
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    const onHash = () => {
      const target = window.location.hash
      if (leaving.current || target === here) return
      history.replaceState(null, '', here)
      confirmDialog({
        title: 'Discard unsaved changes?',
        message: `Your edits to ${name} have not been saved.`,
        confirmLabel: 'Discard',
        danger: true,
      }).then((ok) => {
        if (!ok) return
        leaving.current = true
        window.location.hash = target
      })
    }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('hashchange', onHash)
    }
  }, [dirty, name])

  const updateConfig = useCallback((next: AgentFile) => {
    setConfig(next)
    setYamlText(toYaml(next))
    setParseError(null)
  }, [])

  const updateYaml = (text: string) => {
    setYamlText(text)
    const parsed = parseConfig(text)
    if ('config' in parsed) {
      setConfig(parsed.config)
      setParseError(null)
    } else setParseError(parsed.error)
  }

  const save = async (): Promise<boolean> => {
    if (saving) return false
    if (!dirty) return true
    if (parseError) {
      toast.error('Fix the YAML parse error before saving')
      setSection('yaml')
      return false
    }
    setSaving(true)
    try {
      const text = yamlText
      const d = await api.agents.save(name, text)
      setSavedYaml(text)
      validated.current = text
      setIssues(d.issues)
      // the server restarts a running runtime so it picks up the change
      runtime.refresh()
      toast.success(
        d.valid
          ? `Saved ${name}`
          : `Saved ${name} with ${d.issues.length} validation issue${d.issues.length === 1 ? '' : 's'}`,
      )
      return true
    } catch (e) {
      toast.error(`Save failed: ${errorText(e)}`)
      return false
    } finally {
      setSaving(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openChat = async () => {
    if (dirty) {
      const ok = await confirmDialog({
        title: 'Save before chatting?',
        message: 'The runtime runs the saved file, so unsaved changes would not be used.',
        confirmLabel: 'Save and open chat',
      })
      if (!ok || !(await save())) return
    }
    leaving.current = true
    navigate(href.chat(name))
  }

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete ${name}?`,
      message: 'The agent file is deleted from disk. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await api.agents.remove(name)
      toast.success(`Deleted ${name}`)
      leaving.current = true
      navigate(href.agents())
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  const jumpTo = (issue: ValidationIssue) => {
    const sec = sectionForPath(issue.path)
    setSection(sec)
    if (sec === 'agents' && config) {
      // agent names may contain dots, so match against the known names (longest first)
      const target = Object.keys(config.agents ?? {})
        .sort((a, b) => b.length - a.length)
        .find((n) => issue.path === `agents.${n}` || issue.path.startsWith(`agents.${n}.`))
      if (target) setAgent(target)
    }
    revealField(issue.path)
  }

  if (loadError)
    return (
      <EmptyState
        className="m-auto"
        icon={<FileWarning />}
        title={`Could not open ${name}`}
        description={loadError}
        action={<Button onClick={() => navigate(href.agents())}>Back to agents</Button>}
      />
    )
  if (!detail)
    return (
      <div className="flex flex-col gap-3 p-4 sm:p-6">
        <Skeleton className="h-8 w-full max-w-64" />
        <Skeleton className="h-64 w-full max-w-3xl" />
      </div>
    )

  const counts: Partial<Record<SectionId, number>> = config
    ? {
        agents: Object.keys(config.agents ?? {}).length,
        models: Object.keys(config.models ?? {}).length,
        mcps: Object.keys(config.mcps ?? {}).length,
      }
    : {}
  const issueSections = new Set(issues.map((i) => sectionForPath(i.path)))

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-surface pr-2 pl-1 sm:gap-3 sm:px-4">
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon={<ChevronLeft />}
          title="All agents"
          className="max-lg:[&_svg]:size-5!"
          onClick={() => navigate(href.agents())}
        />
        <div className="min-w-0 max-lg:flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-mono text-md font-semibold">{name}</h1>
            {dirty && <span className="size-1.5 rounded-full bg-accent" title="Unsaved changes" />}
          </div>
          <p className="truncate text-xs text-faint" title={detail.file}>
            {detail.file}
          </p>
        </div>
        <button
          type="button"
          onClick={() => issues.length && setIssuesOpen((o) => !o)}
          className={cn(
            'flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium max-lg:h-8 max-lg:px-2.5 sm:ml-2',
            issues.length ? 'bg-danger-soft text-danger hover:brightness-95' : 'text-success',
          )}
          aria-expanded={issuesOpen}
          aria-label={
            issues.length
              ? `${issues.length} validation issue${issues.length === 1 ? '' : 's'}`
              : 'Valid'
          }
        >
          {validating ? (
            <Spinner className="[&_svg]:size-3" />
          ) : issues.length ? (
            <TriangleAlert className="size-3.5" />
          ) : (
            <CircleCheck className="size-3.5" />
          )}
          {issues.length ? (
            <>
              {issues.length}
              <span className="max-sm:hidden"> issue{issues.length === 1 ? '' : 's'}</span>
            </>
          ) : (
            <span className="max-sm:hidden">Valid</span>
          )}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div className="hidden items-center gap-1.5 lg:flex">
            <Button
              size="sm"
              variant="ghost"
              icon={<Stethoscope />}
              onClick={() => setDialog('doctor')}
            >
              Doctor
            </Button>
            <Button size="sm" variant="ghost" icon={<Upload />} onClick={() => setDialog('push')}>
              Push
            </Button>
            <Button
              size="sm"
              variant="danger-ghost"
              iconOnly
              icon={<Trash2 />}
              title="Delete agent"
              onClick={remove}
            />
            <div className="mx-1 h-5 w-px bg-line" />
          </div>
          <Button
            size="sm"
            icon={<MessageSquare />}
            onClick={openChat}
            className="max-sm:hidden"
            collapse="lg"
            title="Chat with this agent"
          >
            Chat
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Save />}
            loading={saving}
            disabled={!dirty}
            onClick={save}
            title={`Save (${isMac ? '⌘' : 'Ctrl+'}S)`}
          >
            Save
            <span className="text-2xs font-normal opacity-70 max-lg:hidden">
              {isMac ? '⌘S' : 'Ctrl S'}
            </span>
          </Button>
          <Menu
            className="lg:hidden"
            items={[
              { label: 'Chat', icon: <MessageSquare />, onSelect: openChat },
              { label: 'Doctor', icon: <Stethoscope />, onSelect: () => setDialog('doctor') },
              { label: 'Push to registry', icon: <Upload />, onSelect: () => setDialog('push') },
              { label: 'Delete agent', icon: <Trash2 />, onSelect: remove, danger: true },
            ]}
          />
        </div>
      </header>

      {issues.length > 0 && issuesOpen && (
        <div className="max-h-48 shrink-0 animate-fade-in overflow-y-auto overscroll-contain border-b bg-danger-soft/40 max-lg:max-h-[40dvh]">
          <ul className="py-1">
            {issues.map((issue, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: issues have no ids
              <li key={i}>
                <button
                  type="button"
                  onClick={() => jumpTo(issue)}
                  className="flex w-full flex-col gap-0.5 px-4 py-2 text-left hover:bg-danger-soft sm:flex-row sm:items-baseline sm:gap-3 lg:py-1"
                >
                  <span className="min-w-0 truncate font-mono text-xs text-danger sm:w-56 sm:shrink-0">
                    {issue.path || '(document)'}
                  </span>
                  <span className="text-sm text-fg">{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setIssuesOpen(false)}
            className="flex w-full items-center justify-center gap-1 py-1 text-2xs text-faint hover:text-fg max-lg:py-2.5 max-lg:text-xs"
          >
            <ChevronDown className="size-3 rotate-180" /> Hide
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav
          ref={sectionNav}
          className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto border-b bg-surface px-3 py-2 lg:w-48 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-r lg:border-b-0 lg:p-2"
          aria-label="Editor sections"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              aria-current={section === s.id}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-left text-base whitespace-nowrap transition-colors lg:h-8 lg:rounded-md lg:px-2.5',
                section === s.id
                  ? 'bg-accent-soft font-medium text-accent-text'
                  : 'text-muted hover:bg-hover hover:text-fg max-lg:bg-sunken',
              )}
            >
              <span className="lg:flex-1">{s.label}</span>
              {issueSections.has(s.id) && (
                <span className="size-1.5 rounded-full bg-danger" title="Has issues" />
              )}
              {counts[s.id] !== undefined && (
                <span className="text-xs text-faint tabular-nums">{counts[s.id]}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-hidden">
          {section === 'yaml' ? (
            <YamlEditor
              value={yamlText}
              onChange={updateYaml}
              error={parseError}
              onFormat={() => {
                const parsed = parseConfig(yamlText)
                if ('config' in parsed) updateConfig(parsed.config)
              }}
            />
          ) : !config ? (
            <EmptyState
              className="h-full"
              icon={<FileWarning />}
              title="This file does not parse"
              description="Fix the YAML to use the form editor."
              action={<Button onClick={() => setSection('yaml')}>Open YAML</Button>}
            />
          ) : section === 'topology' ? (
            <TopologySection
              config={config}
              onChange={updateConfig}
              issues={issues}
              stale={!!parseError}
              onGoToYaml={() => setSection('yaml')}
              onSelectAgent={setAgent}
            />
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="mx-auto max-w-3xl px-4 pt-5 pb-10 sm:px-6 lg:px-8 lg:py-6">
                {parseError && (
                  <div className="mb-5 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>
                      The YAML has a parse error, so the form shows the last valid version. Editing
                      here replaces the YAML.{' '}
                      <button
                        type="button"
                        className="font-medium underline"
                        onClick={() => setSection('yaml')}
                      >
                        Go to YAML
                      </button>
                    </span>
                  </div>
                )}
                {section === 'agents' && (
                  <AgentsSection
                    config={config}
                    onChange={updateConfig}
                    selected={agent}
                    onSelect={setAgent}
                  />
                )}
                {section === 'models' && <ModelsSection config={config} onChange={updateConfig} />}
                {section === 'mcps' && <McpsSection config={config} onChange={updateConfig} />}
                {section === 'permissions' && (
                  <PermissionsSection config={config} onChange={updateConfig} />
                )}
                {section === 'metadata' && (
                  <MetadataSection config={config} onChange={updateConfig} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <DoctorDialog
        name={name}
        open={dialog === 'doctor'}
        onClose={() => setDialog(null)}
        dirty={dirty}
      />
      <PushDialog
        name={name}
        open={dialog === 'push'}
        onClose={() => setDialog(null)}
        dirty={dirty}
      />
    </>
  )
}
