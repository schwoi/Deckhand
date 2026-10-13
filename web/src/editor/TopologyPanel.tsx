import { RELATIONS, RELATION_KINDS, type RelationKind, addRelation } from '@shared/agent-refs'
import type { AgentFile } from '@shared/config'
import { type Topology, type TopologyDiagnostic, agentId } from '@shared/topology'
import { Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Combobox } from '../components/ui/Combobox'
import { Dialog } from '../components/ui/Dialog'
import { Field, Input, Select } from '../components/ui/form'
import { Badge, Code } from '../components/ui/misc'
import { NAME_RE, cn } from '../lib/util'
import { AgentForm, agentNameError, newAgentDefaults, orderedAgentNames } from './AgentsSection'
import { DiagnosticLine, EdgeRow, onListNavKey } from './TopologyRows'
import { type VisualEdge, visualEdges } from './topologyLayout'
import { RelationSample } from './topologyStyle'

/** Side-panel body for the selected node: its relationships, then the agent's form. */
export function NodePanel({
  topology,
  diagnostics,
  nodeId,
  highlightEdge,
  config,
  onChange,
  readOnly,
  onSelect,
  onRemove,
  onAdd,
  onCleared,
}: {
  topology: Topology
  diagnostics: TopologyDiagnostic[]
  nodeId: string
  highlightEdge?: string
  config: AgentFile
  onChange: (c: AgentFile) => void
  readOnly: boolean
  onSelect: (id: string, edge?: string) => void
  onRemove: (e: VisualEdge) => void
  onAdd: (from: string) => void
  onCleared: () => void
}) {
  const node = topology.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const byId = new Map(topology.nodes.map((n) => [n.id, n]))
  const drawn = visualEdges(topology.edges)
  const outgoing = drawn.filter((e) => e.source === nodeId)
  const incoming = drawn.filter((e) => e.target === nodeId && e.source !== nodeId)
  const nodeDiags = diagnostics.filter(
    (d) => d.nodes.includes(nodeId) && (d.edges.length === 0 || d.code === 'cycle'),
  )

  const row = (e: VisualEdge, direction: 'out' | 'in') => {
    const far = byId.get(direction === 'out' ? e.target : e.source)
    return (
      <EdgeRow
        key={`${direction}:${e.id}`}
        edge={e}
        direction={direction}
        far={far}
        diagnostics={diagnostics}
        highlighted={e.members.some((m) => m.id === highlightEdge)}
        readOnly={readOnly}
        onOpen={() => far && onSelect(far.id)}
        onRemove={() => onRemove(e)}
      />
    )
  }

  const relations = (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-md font-semibold">Relationships</h3>
        {node.kind === 'agent' && !readOnly && (
          <Button size="xs" variant="ghost" icon={<Plus />} onClick={() => onAdd(node.name)}>
            Add
          </Button>
        )}
      </div>
      {outgoing.length + incoming.length === 0 ? (
        <p className="text-sm text-muted">No relationships.</p>
      ) : (
        <ul className="divide-y rounded-md border" onKeyDown={onListNavKey}>
          {outgoing.map((e) => row(e, 'out'))}
          {incoming.map((e) => row(e, 'in'))}
        </ul>
      )}
      {nodeDiags.map((d, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: diagnostics have no ids
        <DiagnosticLine key={i} d={d} />
      ))}
    </section>
  )

  if (node.kind === 'external')
    return (
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Reference</dt>
          <dd className="min-w-0 font-mono break-all">{node.reference}</dd>
          <dt className="text-muted">Name</dt>
          <dd className="font-mono">{node.name}</dd>
          <dt className="text-muted">Status</dt>
          <dd>
            <Badge>unverified</Badge>
          </dd>
        </dl>
        <p className="text-xs text-faint">
          Deckhand does not fetch external agents when showing the graph, so this reference is
          unresolved until the runtime pulls it. Pin OCI references to a digest (
          <Code>@sha256:…</Code>) to avoid a registry lookup on every run.
        </p>
        {relations}
      </div>
    )

  if (node.kind === 'missing')
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">
          <Code>{node.name}</Code> is referenced but not defined in this file, so the runtime will
          refuse to load it.
        </p>
        {!readOnly && NAME_RE.test(node.name) && (
          <div>
            <Button
              icon={<Plus />}
              onClick={() => {
                onChange({ ...config, agents: { ...config.agents, [node.name]: {} } })
                onSelect(agentId(node.name))
              }}
            >
              Create agent {node.name}
            </Button>
          </div>
        )}
        {relations}
      </div>
    )

  return (
    <div className="flex flex-col gap-6">
      {relations}
      <fieldset disabled={readOnly} className="min-w-0 border-t pt-5">
        <legend className="sr-only">{node.name} settings</legend>
        <AgentForm
          name={node.name}
          config={config}
          onChange={onChange}
          onRenamed={(n) => onSelect(agentId(n))}
          onRemoved={onCleared}
          entry={node.entry}
        />
      </fieldset>
    </div>
  )
}

const KIND_HELP: Record<RelationKind, string> = {
  delegation: 'Can hand a task to the target and get the result back.',
  handoff: 'Can transfer the whole conversation to the target.',
  force_handoff: 'Always transfers the conversation after its final answer. One per agent.',
}

export function AddRelationDialog({
  open,
  initialFrom,
  topology,
  onClose,
  onAdd,
}: {
  open: boolean
  initialFrom: string
  topology: Topology
  onClose: () => void
  onAdd: (from: string, kind: RelationKind, to: string) => void
}) {
  const [from, setFrom] = useState(initialFrom)
  const [kind, setKind] = useState<RelationKind>('delegation')
  const [to, setTo] = useState('')
  const [wasOpen, setWasOpen] = useState(false)
  // reset the form each time the dialog opens
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setFrom(initialFrom)
      setKind('delegation')
      setTo('')
    }
  }

  const agents = topology.nodes.filter((n) => n.kind === 'agent')
  const target = to.trim()
  const existing = topology.edges.find(
    (e) => e.from === from && e.kind === kind && e.ref === target,
  )
  const currentForced = topology.edges.find((e) => e.from === from && e.kind === 'force_handoff')
  const error = !target
    ? undefined
    : existing
      ? 'This relationship already exists.'
      : kind === 'force_handoff' && target === from
        ? 'An agent cannot force a handoff to itself.'
        : /\s/.test(target)
          ? 'Names and references cannot contain spaces.'
          : undefined
  const options = [
    ...agents.map((n) => ({ value: n.name, hint: n.description, group: 'Agents in this file' })),
    ...topology.nodes
      .filter((n) => n.kind === 'external')
      .map((n) => ({ value: n.id.slice('external:'.length), group: 'External references' })),
  ]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (target && !error) onAdd(from, kind, target)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add relationship"
      description="Relationships say what an agent may do at runtime; they are not an execution order."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-relation" disabled={!target || !!error}>
            Add relationship
          </Button>
        </>
      }
    >
      <form id="add-relation" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="From">
          <Select value={from} onChange={(e) => setFrom(e.target.value)} className="font-mono">
            {agents.map((n) => (
              <option key={n.id} value={n.name}>
                {n.name}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Relationship</legend>
          {RELATION_KINDS.map((k) => (
            <label
              key={k}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 max-lg:py-3',
                kind === k ? 'border-accent bg-accent-soft/50' : 'hover:bg-hover',
              )}
            >
              <input
                type="radio"
                name="relation-kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="mt-1 accent-accent"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-base font-medium">
                  {RELATIONS[k].label}
                  <RelationSample kind={k} />
                  <Code>{RELATIONS[k].field}</Code>
                </span>
                <span className="block text-xs text-faint">{KIND_HELP[k]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field
          label="To"
          error={error}
          help={
            kind === 'force_handoff' && currentForced
              ? `Replaces the current forced handoff to ${currentForced.ref}.`
              : 'An agent in this file, or an external reference such as org/agent:tag.'
          }
        >
          <Combobox
            mono
            value={to}
            onChange={setTo}
            options={options}
            placeholder="agent name or reference"
            aria-invalid={!!error}
          />
        </Field>
      </form>
    </Dialog>
  )
}

export function AddAgentDialog({
  open,
  config,
  initialFrom,
  onClose,
  onCreate,
}: {
  open: boolean
  config: AgentFile
  /** agent to connect from by default, usually the selected one */
  initialFrom?: string
  onClose: () => void
  onCreate: (next: AgentFile, name: string) => void
}) {
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [kind, setKind] = useState<'delegation' | 'handoff'>('delegation')
  const [wasOpen, setWasOpen] = useState(false)
  // reset the form each time the dialog opens
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(newAgentDefaults(config).name)
      setFrom(initialFrom ?? '')
      setKind('delegation')
    }
  }
  const trimmed = name.trim()
  const error = trimmed ? agentNameError(config, trimmed) : undefined
  const names = orderedAgentNames(config)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!trimmed || error) return
    const { agent } = newAgentDefaults(config)
    let next: AgentFile = { ...config, agents: { ...config.agents, [trimmed]: agent } }
    if (from) next = addRelation(next, from, kind, trimmed)
    onCreate(next, trimmed)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add agent"
      description="Creates an agent with the entry point's model; fill in the rest in its form."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-agent" disabled={!trimmed || !!error}>
            Add agent
          </Button>
        </>
      }
    >
      <form id="add-agent" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name" error={error}>
          <Input
            mono
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!error}
          />
        </Field>
        <Field
          label="Connect from"
          help={
            from ? undefined : 'Optional. Agents nothing points to only run when started directly.'
          }
        >
          <Select value={from} onChange={(e) => setFrom(e.target.value)} className="font-mono">
            <option value="">nothing</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        {from && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">As</legend>
            {(['delegation', 'handoff'] as const).map((k) => (
              <label
                key={k}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 max-lg:py-3',
                  kind === k ? 'border-accent bg-accent-soft/50' : 'hover:bg-hover',
                )}
              >
                <input
                  type="radio"
                  name="new-agent-kind"
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="accent-accent"
                />
                <RelationSample kind={k} />
                <span className="text-base">
                  <span className="font-mono">{from}</span> {RELATIONS[k].verb}{' '}
                  {trimmed && !error ? (
                    <span className="font-mono">{trimmed}</span>
                  ) : (
                    'the new agent'
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </form>
    </Dialog>
  )
}
