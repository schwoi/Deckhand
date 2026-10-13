import { addRelation, removeRelation } from '@shared/agent-refs'
import type { ValidationIssue } from '@shared/api'
import type { AgentFile } from '@shared/config'
import {
  type TopologyDiagnostic,
  agentId,
  edgeId,
  projectTopology,
  withIssues,
} from '@shared/topology'
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  Plus,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/form'
import { EmptyState, Tabs } from '../components/ui/misc'
import { cn } from '../lib/util'
import { TopologyCanvas, type Viewport } from './TopologyCanvas'
import { TopologyList } from './TopologyList'
import { AddAgentDialog, AddRelationDialog, NodePanel } from './TopologyPanel'
import { onListNavKey } from './TopologyRows'
import { revealField } from './reveal'
import { type VisualEdge, layoutGraph, structureKey } from './topologyLayout'

/**
 * View state that outlives the section: the editor keeps one per file so switching to another
 * section and back restores the selection, open panel, mode, entry choice and viewport.
 */
export interface TopologyMemory {
  view?: 'graph' | 'list'
  entry?: string
  query?: string
  selection?: Selection | null
  focus?: boolean
  viewport?: Viewport
}

interface Selection {
  node: string
  /** a relationship highlighted within the node's panel */
  edge?: string
}

/**
 * Graph of the draft's delegation and handoff relationships. `stale` shows the last parseable
 * config read-only while the YAML does not parse.
 */
export function TopologySection({
  config,
  onChange,
  issues,
  stale,
  onGoToYaml,
  onSelectAgent,
  memory,
}: {
  config: AgentFile
  onChange: (c: AgentFile) => void
  issues: ValidationIssue[]
  stale: boolean
  onGoToYaml: () => void
  /** keeps the Agents section on the agent last opened here */
  onSelectAgent: (name: string) => void
  memory: TopologyMemory
}) {
  const readOnly = stale
  const [view, setView] = useState(memory.view ?? 'graph')
  const [entry, setEntry] = useState(memory.entry)
  const [query, setQuery] = useState(memory.query ?? '')
  const [selection, setSelection] = useState(memory.selection ?? null)
  const [focus, setFocus] = useState(memory.focus ?? false)
  useEffect(() => {
    Object.assign(memory, { view, entry, query, selection, focus })
  }, [memory, view, entry, query, selection, focus])
  const [diagOpen, setDiagOpen] = useState(false)
  const [adding, setAdding] = useState<{ from?: string } | null>(null)
  const [addingAgent, setAddingAgent] = useState(false)

  const topology = useMemo(() => projectTopology(config, { entry }), [config, entry])
  // Validation issues describe the current YAML text, which no longer matches a stale graph.
  const diagnostics = useMemo(
    () => withIssues(topology, stale ? [] : issues),
    [topology, issues, stale],
  )
  const key = structureKey(topology)
  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute only on structural change
  const layout = useMemo(
    () =>
      layoutGraph(
        topology.nodes,
        topology.edges,
        topology.entry ? agentId(topology.entry) : undefined,
      ),
    [key],
  )

  const nodesById = useMemo(() => new Map(topology.nodes.map((n) => [n.id, n])), [topology.nodes])
  const selected = selection && nodesById.has(selection.node) ? selection : null
  const selectedNode = selected ? nodesById.get(selected.node) : undefined
  // focus mode needs a selection; drop it when the selected node disappears
  const hasSelection = !!selected
  useEffect(() => {
    if (!hasSelection) setFocus(false)
  }, [hasSelection])

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!q) return null
    return new Set(
      topology.nodes
        .filter((n) =>
          [n.name, n.description, n.reference, n.model].some((s) => s?.toLowerCase().includes(q)),
        )
        .map((n) => n.id),
    )
  }, [topology.nodes, q])

  const selectNode = useCallback(
    (id: string, edge?: string) => {
      setSelection({ node: id, edge })
      if (id.startsWith('agent:')) onSelectAgent(id.slice('agent:'.length))
    },
    [onSelectAgent],
  )
  const selectEdge = useCallback((e: VisualEdge) => selectNode(e.source, e.id), [selectNode])
  const clear = useCallback(() => {
    setSelection(null)
    setFocus(false)
  }, [])

  // a drawn edge can stand for several relationships (handoff + forced handoff); remove them all
  const remove = (e: VisualEdge) => {
    if (readOnly) return
    onChange(e.members.reduce((c, m) => removeRelation(c, m.from, m.kind, m.ref), config))
  }

  const openDiagnostic = (d: TopologyDiagnostic) => {
    const edge = topology.edges.find((e) => d.edges.includes(e.id))
    const node = edge?.source ?? d.nodes.find((id) => nodesById.get(id)?.kind === 'agent')
    if (!node) return
    selectNode(node, edge?.id)
    revealField(d.path)
  }

  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.length - errors
  const agentNames = topology.nodes.filter((n) => n.kind === 'agent').map((n) => n.name)

  const selectedAgent = selectedNode?.kind === 'agent' ? selectedNode.name : undefined
  const addAgentDialog = (
    <AddAgentDialog
      open={addingAgent && !readOnly}
      config={config}
      initialFrom={selectedAgent}
      onClose={() => setAddingAgent(false)}
      onCreate={(next, name) => {
        onChange(next)
        setAddingAgent(false)
        selectNode(agentId(name))
      }}
    />
  )

  if (agentNames.length === 0)
    return (
      <>
        <EmptyState
          className="h-full"
          icon={<Bot />}
          title="No agents yet"
          description="Add an agent to start building the team."
          action={
            <Button
              variant="primary"
              icon={<Plus />}
              disabled={readOnly}
              onClick={() => setAddingAgent(true)}
            >
              Add agent
            </Button>
          }
        />
        {addAgentDialog}
      </>
    )

  return (
    <div className="flex h-full flex-col">
      {stale && (
        <div className="flex shrink-0 items-start gap-2 border-b bg-warning-soft px-4 py-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <strong className="font-medium">Stale:</strong> the YAML has a parse error, so this is
            the last version that parsed. Editing is disabled until it is fixed.{' '}
            <button type="button" className="font-medium underline" onClick={onGoToYaml}>
              Go to YAML
            </button>
          </span>
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-surface px-3 py-2 sm:px-4">
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { value: 'graph', label: 'Graph' },
            { value: 'list', label: 'List' },
          ]}
        />
        <div className="relative max-sm:order-last max-sm:w-full sm:w-52">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
              if (e.key === 'Enter' && matches?.size) {
                const first = topology.nodes.find((n) => matches.has(n.id))
                if (first) selectNode(first.id)
              }
            }}
            placeholder="Search agents"
            aria-label="Search agents"
            className="pl-8"
          />
          {matches && (
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-2xs text-faint">
              {matches.size}
            </span>
          )}
        </div>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Select, which renders a <select> */}
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <span className="max-sm:sr-only">Entry</span>
          <Select
            value={topology.entry ?? ''}
            onChange={(e) => setEntry(e.target.value)}
            className="w-auto max-w-40 font-mono text-sm"
            title="Entry point used for reachability. Docker Agent starts root, or else the first agent."
          >
            {agentNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        {diagnostics.length > 0 && (
          <button
            type="button"
            onClick={() => setDiagOpen((o) => !o)}
            aria-expanded={diagOpen}
            className={cn(
              'flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium hover:brightness-95 max-lg:h-8 max-lg:px-2.5',
              errors ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning',
            )}
          >
            {errors ? <CircleAlert className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
            {[
              errors && `${errors} error${errors === 1 ? '' : 's'}`,
              warnings && `${warnings} warning${warnings === 1 ? '' : 's'}`,
            ]
              .filter(Boolean)
              .join(' · ')}
            <ChevronDown className={cn('size-3 transition-transform', diagOpen && 'rotate-180')} />
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            icon={<Bot />}
            collapse="sm"
            disabled={readOnly}
            onClick={() => setAddingAgent(true)}
          >
            Add agent
          </Button>
          <Button
            icon={<Plus />}
            collapse="sm"
            disabled={readOnly}
            onClick={() => setAdding({ from: selectedAgent })}
          >
            Add relationship
          </Button>
        </div>
      </div>

      {diagOpen && diagnostics.length > 0 && (
        <ul
          className="max-h-44 shrink-0 animate-fade-in overflow-y-auto overscroll-contain border-b bg-sunken/60 py-1 max-lg:max-h-[35dvh]"
          onKeyDown={onListNavKey}
        >
          {diagnostics.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diagnostics have no ids
            <li key={i}>
              <button
                type="button"
                data-nav
                onClick={() => openDiagnostic(d)}
                className="flex w-full flex-col gap-0.5 px-4 py-2 text-left hover:bg-hover sm:flex-row sm:items-baseline sm:gap-3 lg:py-1"
              >
                <span
                  className={cn(
                    'min-w-0 truncate font-mono text-xs sm:w-56 sm:shrink-0',
                    d.severity === 'error' ? 'text-danger' : 'text-warning',
                  )}
                >
                  {d.path || '(document)'}
                </span>
                <span className="text-sm text-fg">{d.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex min-h-0 flex-1">
        <div className={cn('min-w-0 flex-1', selectedNode && 'max-lg:hidden')}>
          {view === 'graph' ? (
            <TopologyCanvas
              topology={topology}
              layout={layout}
              diagnostics={diagnostics}
              selected={selected?.node ?? null}
              highlightEdge={selected?.edge ?? null}
              matches={matches}
              focus={focus && !!selected}
              onFocusChange={setFocus}
              onSelectNode={selectNode}
              onSelectEdge={selectEdge}
              onClear={clear}
              memory={memory}
            />
          ) : (
            <TopologyList
              topology={topology}
              diagnostics={diagnostics}
              selected={selected?.node ?? null}
              highlightEdge={selected?.edge ?? null}
              matches={matches}
              readOnly={readOnly}
              onSelectNode={selectNode}
              onSelectEdge={selectEdge}
              onRemove={remove}
              onAddAgent={() => setAddingAgent(true)}
            />
          )}
        </div>
        {selectedNode && selected && (
          <aside
            key={selectedNode.id}
            className="flex min-w-0 flex-1 animate-fade-in flex-col bg-surface lg:w-[min(560px,48%)] lg:flex-none lg:shrink-0 lg:border-l"
            aria-label={`${selectedNode.name} details`}
          >
            <div className="flex min-h-12 items-center gap-2 border-b py-2 pr-3 pl-1 lg:pl-4">
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<ChevronLeft />}
                title="Back to topology"
                className="lg:hidden [&_svg]:size-5!"
                onClick={clear}
              />
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-mono text-md font-semibold">{selectedNode.name}</h2>
                <p className="text-2xs text-faint">
                  {selectedNode.kind === 'agent'
                    ? selectedNode.entry
                      ? 'Agent · entry point'
                      : 'Agent'
                    : selectedNode.kind === 'external'
                      ? 'External reference'
                      : 'Not defined in this file'}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<X />}
                title="Close"
                className="max-lg:hidden"
                onClick={clear}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10">
              <NodePanel
                topology={topology}
                diagnostics={diagnostics}
                nodeId={selectedNode.id}
                highlightEdge={selected.edge}
                config={config}
                onChange={onChange}
                readOnly={readOnly}
                onSelect={selectNode}
                onRemove={remove}
                onAdd={(from) => setAdding({ from })}
                onCleared={clear}
              />
            </div>
          </aside>
        )}
      </div>

      <AddRelationDialog
        open={!!adding && !readOnly}
        initialFrom={adding?.from ?? topology.entry ?? agentNames[0] ?? ''}
        topology={topology}
        onClose={() => setAdding(null)}
        onAdd={(from, kind, to) => {
          onChange(addRelation(config, from, kind, to))
          setAdding(null)
          selectNode(agentId(from), edgeId(kind, from, to))
        }}
      />
      {addAgentDialog}
    </div>
  )
}
