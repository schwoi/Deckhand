import type { EnvironmentInfo, EnvironmentTest } from '@shared/api'
import {
  ChevronsUpDown,
  CircleCheck,
  CircleX,
  Globe,
  Monitor,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { api, errorText } from '../api'
import { LOCAL, useEnvironments } from '../env'
import { cn } from '../lib/util'
import { Button } from './ui/Button'
import { Dialog, confirmDialog } from './ui/Dialog'
import { Menu } from './ui/Menu'
import { Field, Input } from './ui/form'
import { Badge, Spinner } from './ui/misc'
import { toast } from './ui/toast'

/** Pick the Deckhand instance the whole UI talks to. */
export function EnvironmentSwitcher({ className }: { className?: string }) {
  const { environments, current, select } = useEnvironments()
  const [manage, setManage] = useState(false)
  const items = [LOCAL, ...environments].map((e) => ({
    label: e.name,
    icon: e.id === LOCAL.id ? <Monitor /> : <Globe />,
    active: e.id === current.id,
    onSelect: () => select(e.id),
  }))
  return (
    <>
      <Menu
        label="Switch environment"
        align="left"
        className={className}
        trigger={{
          variant: 'secondary',
          size: 'md',
          className: 'w-full justify-between font-medium',
          icon: current.id === LOCAL.id ? <Monitor /> : <Globe />,
          children: (
            <>
              <span className="min-w-0 flex-1 truncate text-left">{current.name}</span>
              <ChevronsUpDown className="text-faint" />
            </>
          ),
        }}
        items={[
          ...items,
          {
            label: 'Manage environments…',
            icon: <Settings2 />,
            separator: true,
            onSelect: () => setManage(true),
          },
        ]}
      />
      <ManageEnvironmentsDialog open={manage} onClose={() => setManage(false)} />
    </>
  )
}

type Draft = { id?: string; name: string; url: string; token: string }
const EMPTY: Draft = { name: '', url: '', token: '' }

function ManageEnvironmentsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { environments, current, select, refresh } = useEnvironments()
  const [draft, setDraft] = useState<Draft | null>(null)
  useEffect(() => {
    if (!open) setDraft(null)
    else if (environments.length === 0) setDraft(EMPTY)
  }, [open, environments.length])

  const remove = async (env: EnvironmentInfo) => {
    const ok = await confirmDialog({
      title: `Remove ${env.name}?`,
      message: 'Only the connection is removed. Nothing changes on that machine.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    try {
      await api.environments.remove(env.id)
      if (current.id === env.id) select(LOCAL.id)
      await refresh()
    } catch (e) {
      toast.error(`Could not remove environment: ${errorText(e)}`)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Environments"
      description="Other Deckhand instances this dashboard can drive. Each one manages its own agents and runtime."
      footer={
        draft ? undefined : (
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" icon={<Plus />} onClick={() => setDraft(EMPTY)}>
              Add environment
            </Button>
          </>
        )
      }
    >
      {draft ? (
        <EnvironmentForm
          draft={draft}
          onCancel={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null)
            await refresh()
          }}
        />
      ) : (
        <ul className="divide-y rounded-md border">
          {environments.map((env) => (
            <EnvironmentRow
              key={env.id}
              env={env}
              active={env.id === current.id}
              onEdit={() => setDraft({ id: env.id, name: env.name, url: env.url, token: '' })}
              onRemove={() => remove(env)}
            />
          ))}
        </ul>
      )}
    </Dialog>
  )
}

function EnvironmentRow({
  env,
  active,
  onEdit,
  onRemove,
}: { env: EnvironmentInfo; active: boolean; onEdit: () => void; onRemove: () => void }) {
  const [test, setTest] = useState<EnvironmentTest | null>(null)
  useEffect(() => {
    let live = true
    api.environments
      .test(env.id)
      .then((t) => live && setTest(t))
      .catch((e) => live && setTest({ ok: false, error: errorText(e) }))
    return () => {
      live = false
    }
  }, [env.id])
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <TestIcon test={test} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-base font-medium">
          <span className="truncate">{env.name}</span>
          {active && <Badge tone="accent">current</Badge>}
        </div>
        <div className="truncate font-mono text-xs text-faint">{env.url}</div>
        <TestLine test={test} />
      </div>
      <Button variant="ghost" iconOnly icon={<Pencil />} title="Edit" onClick={onEdit} />
      <Button variant="danger-ghost" iconOnly icon={<Trash2 />} title="Remove" onClick={onRemove} />
    </li>
  )
}

function TestIcon({ test }: { test: EnvironmentTest | null }) {
  if (!test) return <Spinner className="size-4" />
  return test.ok ? (
    <CircleCheck className="size-4 shrink-0 text-success" />
  ) : (
    <CircleX className="size-4 shrink-0 text-danger" />
  )
}

function TestLine({ test, className }: { test: EnvironmentTest | null; className?: string }) {
  if (!test) return null
  return (
    <div className={cn('truncate text-xs', test.ok ? 'text-muted' : 'text-danger', className)}>
      {test.ok
        ? `docker agent ${test.version ?? '?'} · runtime ${test.runtime ?? 'unknown'}`
        : test.error}
    </div>
  )
}

function EnvironmentForm({
  draft,
  onCancel,
  onSaved,
}: { draft: Draft; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState(draft)
  const [test, setTest] = useState<EnvironmentTest | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<Draft>) => {
    setForm((f) => ({ ...f, ...patch }))
    setTest(null)
  }
  const valid = form.name.trim() !== '' && /^https?:\/\/\S+$/.test(form.url.trim())

  const runTest = async () => {
    setTesting(true)
    try {
      setTest(await api.environments.testInput({ id: form.id, url: form.url, token: form.token }))
    } catch (e) {
      setTest({ ok: false, error: errorText(e) })
    } finally {
      setTesting(false)
    }
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setSaving(true)
    try {
      const input = { name: form.name, url: form.url, token: form.token || undefined }
      if (form.id) await api.environments.update(form.id, input)
      else await api.environments.create(input)
      toast.success(form.id ? 'Environment updated' : 'Environment added')
      await onSaved()
    } catch (err) {
      toast.error(`Could not save environment: ${errorText(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <Field label="Name">
        <Input
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Build box"
          data-autofocus
        />
      </Field>
      <Field label="URL" help="Where that Deckhand listens, including the port.">
        <Input
          mono
          type="url"
          value={form.url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="http://build-box:4800"
        />
      </Field>
      <Field
        label="Token"
        help={
          form.id
            ? 'Leave empty to keep the stored token.'
            : 'The DECKHAND_TOKEN that instance was started with, if any.'
        }
      >
        <Input
          mono
          type="password"
          autoComplete="off"
          value={form.token}
          onChange={(e) => set({ token: e.target.value })}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button loading={testing} disabled={!valid} onClick={runTest}>
          Test connection
        </Button>
        {test && (
          <span className="flex min-w-0 items-center gap-1.5">
            <TestIcon test={test} />
            <TestLine test={test} />
          </span>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving} disabled={!valid}>
          {form.id ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  )
}
