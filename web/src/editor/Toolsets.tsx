import type { Toolset } from '@shared/config'
import { ArrowDown, ArrowUp, ChevronRight, Plus, Search, Trash2 } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { Field, Input, NumberInput, Switch, Textarea } from '../components/ui/form'
import { KeyValueEditor, StringListEditor, TagInput } from '../components/ui/lists'
import { Code, Disclosure } from '../components/ui/misc'
import { cn, withField } from '../lib/util'
import { McpForm } from './McpForm'
import { TOOLSET_GROUPS, TOOLSET_META } from './catalog'
import { strList, strRecord } from './hooks'

export function toolsetSummary(ts: Toolset): string {
  if (ts.type === 'mcp') return ts.ref ?? ts.command ?? ts.remote?.url ?? ''
  return ts.path ?? ts.url ?? ''
}

export function ToolsetList({
  value,
  onChange,
  mcpNames,
  path,
}: {
  value: Toolset[] | undefined
  onChange: (v: Toolset[]) => void
  mcpNames: string[]
  path: string
}) {
  const list = value ?? []
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [picking, setPicking] = useState(false)

  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s)
      n.has(i) ? n.delete(i) : n.add(i)
      return n
    })
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j] as Toolset, next[i] as Toolset]
    onChange(next)
    setOpen(new Set())
  }
  const add = (type: string) => {
    const ts: Toolset = type === 'mcp' ? { type, ref: 'docker:' } : { type }
    onChange([...list, ts])
    setOpen(new Set([list.length]))
    setPicking(false)
  }

  return (
    <div className="flex flex-col gap-2">
      {list.length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-3 text-center text-sm text-muted">
          No toolsets. The agent can only talk.
        </p>
      )}
      {list.map((ts, i) => {
        const meta = TOOLSET_META[ts.type]
        const isOpen = open.has(i)
        const summary = toolsetSummary(ts)
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: toolsets are positional
          <div key={i} id={`f-${path}.${i}`} className="rounded-md border bg-surface">
            <div className="flex items-center gap-1 pr-1.5">
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left max-lg:min-h-11"
              >
                <ChevronRight
                  className={cn(
                    'size-3.5 shrink-0 text-faint transition-transform',
                    isOpen && 'rotate-90',
                  )}
                />
                <span className="font-mono text-sm font-medium">{ts.type}</span>
                <span className="truncate text-sm text-faint">
                  {summary ? (
                    <span className="font-mono text-xs">{summary}</span>
                  ) : (
                    meta?.description
                  )}
                </span>
              </button>
              <Button
                size="xs"
                variant="ghost"
                iconOnly
                icon={<ArrowUp />}
                title="Move up"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              />
              <Button
                size="xs"
                variant="ghost"
                iconOnly
                icon={<ArrowDown />}
                title="Move down"
                disabled={i === list.length - 1}
                onClick={() => move(i, 1)}
              />
              <Button
                size="xs"
                variant="danger-ghost"
                iconOnly
                icon={<Trash2 />}
                title="Remove toolset"
                onClick={() => {
                  onChange(list.filter((_, j) => j !== i))
                  setOpen(new Set())
                }}
              />
            </div>
            {isOpen && (
              <div className="border-t px-3 pt-3 pb-3.5">
                <ToolsetForm
                  value={ts}
                  onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))}
                  mcpNames={mcpNames}
                  path={`${path}.${i}`}
                />
              </div>
            )}
          </div>
        )
      })}
      <div>
        <Button size="sm" icon={<Plus />} onClick={() => setPicking(true)}>
          Add toolset
        </Button>
      </div>
      <ToolsetPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={add}
        used={list.map((t) => t.type)}
      />
    </div>
  )
}

function ToolsetForm({
  value: ts,
  onChange,
  mcpNames,
  path,
}: { value: Toolset; onChange: (v: Toolset) => void; mcpNames: string[]; path: string }) {
  const set = <K extends keyof Toolset>(k: K, v: Toolset[K]) => onChange(withField(ts, k, v))
  const t = ts.type
  let body: ReactNode = null

  if (t === 'mcp') body = <McpForm value={ts} onChange={onChange} mcpNames={mcpNames} path={path} />
  else if (t === 'memory' || t === 'tasks')
    body = (
      <Field
        label="Storage path"
        path={`${path}.path`}
        help="Where the data is stored. Defaults to a per-agent location."
      >
        <Input
          mono
          value={ts.path ?? ''}
          placeholder={t === 'memory' ? './memory.db' : './tasks.json'}
          onChange={(e) => set('path', e.target.value)}
        />
      </Field>
    )
  else if (t === 'fetch')
    body = (
      <div className="flex flex-col gap-3">
        <Field
          label="Allowed domains"
          help="Bare host matches the apex and subdomains; leading dot matches only subdomains."
        >
          <TagInput
            mono
            value={ts.allowed_domains}
            onChange={(v) => set('allowed_domains', v)}
            placeholder="example.com"
          />
        </Field>
        <Field label="Blocked domains">
          <TagInput
            mono
            value={ts.blocked_domains}
            onChange={(v) => set('blocked_domains', v)}
            placeholder="internal.example.com"
          />
        </Field>
        <Field label="Timeout (seconds)" className="w-40">
          <NumberInput value={ts.timeout} onChange={(v) => set('timeout', v)} placeholder="30" />
        </Field>
      </div>
    )
  else if (t === 'shell')
    body = (
      <Field label="Environment" help="Extra environment variables for commands.">
        <KeyValueEditor value={ts.env} onChange={(v) => set('env', v)} addLabel="Add variable" />
      </Field>
    )
  else if (t === 'filesystem' || t === 'file')
    body = (
      <div className="flex flex-col gap-3">
        <Field
          label="Allow list"
          help={
            <>
              Directories the tool may access: <Code>.</Code> (working dir), <Code>~</Code>, or
              absolute paths.
            </>
          }
        >
          <StringListEditor
            value={strList(ts.allow_list)}
            onChange={(v) => set('allow_list', v)}
            placeholder="."
            addLabel="Add directory"
          />
        </Field>
        <Field label="Deny list" help="Takes precedence over the allow list.">
          <StringListEditor
            value={strList(ts.deny_list)}
            onChange={(v) => set('deny_list', v)}
            placeholder="~/.ssh"
            addLabel="Add directory"
          />
        </Field>
      </div>
    )
  else if (t === 'openapi' || t === 'a2a' || t === 'open_url')
    body = (
      <div className="flex flex-col gap-3">
        <Field label={t === 'openapi' ? 'Spec URL' : 'URL'} path={`${path}.url`}>
          <Input
            mono
            value={ts.url ?? ''}
            placeholder="https://api.example.com/openapi.json"
            onChange={(e) => set('url', e.target.value)}
          />
        </Field>
        {t !== 'open_url' && (
          <Field label="Headers" help="Supports ${env.VAR} interpolation.">
            <KeyValueEditor
              value={strRecord(ts.headers)}
              onChange={(v) => set('headers', v)}
              keyPlaceholder="Header"
              addLabel="Add header"
            />
          </Field>
        )}
      </div>
    )
  else if (t === 'lsp')
    body = (
      <div className="flex flex-col gap-3">
        <Field label="Command">
          <Input
            mono
            value={ts.command ?? ''}
            placeholder="gopls"
            onChange={(e) => set('command', e.target.value)}
          />
        </Field>
        <Field label="Arguments">
          <StringListEditor
            value={ts.args}
            onChange={(v) => set('args', v)}
            addLabel="Add argument"
          />
        </Field>
        <Field label="File types">
          <TagInput
            mono
            value={strList(ts.file_types)}
            onChange={(v) => set('file_types', v)}
            placeholder=".go"
          />
        </Field>
      </div>
    )

  const yamlOnly = t === 'script' || t === 'api' || t === 'rag' || t === 'webhook'
  const deferList = strList(ts.defer as unknown)
  return (
    <div className="flex flex-col gap-3">
      {body}
      {yamlOnly && (
        <p className="rounded-md bg-sunken px-3 py-2 text-sm text-muted">
          The detailed configuration for <Code>{t}</Code> toolsets is edited in the YAML tab.
        </p>
      )}
      {!body && !yamlOnly && (
        <p className="text-sm text-faint">{TOOLSET_META[t]?.description ?? 'No options.'}</p>
      )}
      <Disclosure title="Advanced">
        <div className="flex flex-col gap-3">
          <Field
            label="Instruction"
            help={
              <>
                Replaces the toolset's built-in instructions. Include{' '}
                <Code>{'{ORIGINAL_INSTRUCTIONS}'}</Code> to extend them instead.
              </>
            }
          >
            <Textarea
              autoGrow
              minRows={2}
              value={ts.instruction ?? ''}
              onChange={(e) => set('instruction', e.target.value)}
            />
          </Field>
          <Field label="Tools filter" help="Only expose these tools. Leave empty for all.">
            <TagInput
              mono
              value={ts.tools}
              onChange={(v) => set('tools', v)}
              placeholder="tool_name"
            />
          </Field>
          <div className="flex flex-col gap-2.5">
            <Switch
              checked={!!ts.readonly}
              onChange={(v) => set('readonly', v || undefined)}
              label="Read-only"
              description="Only expose tools annotated as read-only."
            />
            {deferList ? (
              <p className="text-sm text-muted">
                Deferred loading is set per tool (<Code>{deferList.join(', ')}</Code>); edit in
                YAML.
              </p>
            ) : (
              <Switch
                checked={ts.defer === true}
                onChange={(v) => set('defer', v || undefined)}
                label="Defer loading"
                description="Load tool definitions on demand instead of at startup."
              />
            )}
          </div>
        </div>
      </Disclosure>
    </div>
  )
}

function ToolsetPicker({
  open,
  onClose,
  onPick,
  used,
}: { open: boolean; onClose: () => void; onPick: (type: string) => void; used: string[] }) {
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    return TOOLSET_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter(
        (m) => !s || `${m.type} ${m.label} ${m.description}`.toLowerCase().includes(s),
      ),
    })).filter((g) => g.items.length > 0)
  }, [q])
  const first = groups[0]?.items[0]

  return (
    <Dialog open={open} onClose={onClose} title="Add toolset" width="lg">
      <div className="control mb-4 flex h-8 items-center gap-2 px-2.5 max-lg:h-10">
        <Search className="size-3.5 text-faint" />
        <input
          // biome-ignore lint/a11y/noAutofocus: primary input of this view
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && first) onPick(first.type)
          }}
          placeholder="Search toolsets"
          className="w-full bg-transparent text-base outline-none placeholder:text-faint"
        />
      </div>
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1.5 text-2xs font-semibold tracking-wide text-faint uppercase">
              {g.title}
            </h3>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {g.items.map((m) => {
                const added = used.includes(m.type) && m.type !== 'mcp'
                return (
                  <button
                    key={m.type}
                    type="button"
                    onClick={() => onPick(m.type)}
                    className="flex flex-col items-start rounded-md border px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-hover"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="text-base font-medium">{m.label}</span>
                      <span className="font-mono text-2xs text-faint">{m.type}</span>
                      {added && <span className="ml-auto text-2xs text-success">added</span>}
                    </span>
                    <span className="text-sm text-muted">{m.description}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
        {groups.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">No toolset matches “{q}”.</p>
        )}
      </div>
    </Dialog>
  )
}
