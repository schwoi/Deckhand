import type { Topology, TopologyDiagnostic } from '@shared/topology'
import { Plus } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/misc'
import { cn } from '../lib/util'
import { DiagnosticLine, EdgeRow, onListNavKey } from './TopologyRows'
import { type VisualEdge, visualEdges } from './topologyLayout'

/** Accessible alternative to the graph: every agent and every relationship, keyboard navigable. */
export function TopologyList({
  topology,
  diagnostics,
  selected,
  highlightEdge,
  matches,
  readOnly,
  onSelectNode,
  onSelectEdge,
  onRemove,
  onAddAgent,
}: {
  topology: Topology
  diagnostics: TopologyDiagnostic[]
  selected: string | null
  highlightEdge: string | null
  matches: Set<string> | null
  readOnly: boolean
  onSelectNode: (id: string) => void
  onSelectEdge: (edge: VisualEdge) => void
  onRemove: (edge: VisualEdge) => void
  onAddAgent: () => void
}) {
  const byId = new Map(topology.nodes.map((n) => [n.id, n]))
  const drawn = visualEdges(topology.edges)
  const groups = topology.nodes
    .filter((n) => n.kind === 'agent')
    .map((n) => ({
      node: n,
      edges: drawn.filter(
        (e) => e.source === n.id && (!matches || matches.has(e.source) || matches.has(e.target)),
      ),
    }))
    .filter((g) => !matches || matches.has(g.node.id) || g.edges.length > 0)

  if (groups.length === 0)
    return <p className="p-6 text-center text-sm text-muted">No agents match the search.</p>

  return (
    <div className="h-full overflow-y-auto">
      <div
        className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4 sm:px-6"
        onKeyDown={onListNavKey}
      >
        <div className="flex items-start gap-3">
          <p className="flex-1 text-xs text-faint">
            {drawn.length} relationship{drawn.length === 1 ? '' : 's'} between{' '}
            {topology.nodes.length} node{topology.nodes.length === 1 ? '' : 's'}. Use the arrow keys
            to move between rows.
          </p>
          {!readOnly && (
            <Button size="xs" icon={<Plus />} onClick={onAddAgent}>
              Add agent
            </Button>
          )}
        </div>
        {groups.map(({ node, edges }) => {
          const current = node.id === selected && !highlightEdge
          return (
            <section key={node.id} aria-label={node.name} className="rounded-lg border bg-surface">
              <button
                type="button"
                data-nav
                onClick={() => onSelectNode(node.id)}
                aria-current={current}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-t-lg px-3 py-2 text-left hover:bg-hover max-lg:py-3',
                  current && 'bg-accent-soft/60',
                  edges.length === 0 && 'rounded-b-lg',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="truncate font-mono text-sm font-semibold">{node.name}</span>
                  {node.entry && <Badge tone="accent">entry point</Badge>}
                  <span className="ml-auto text-2xs text-faint">
                    {edges.length ? `${edges.length} outgoing` : 'no outgoing relationships'}
                  </span>
                </span>
                {node.description && (
                  <span className="truncate text-xs text-muted">{node.description}</span>
                )}
                {diagnostics
                  .filter(
                    (d) =>
                      (d.nodes.includes(node.id) && d.edges.length === 0) ||
                      // a cycle is listed once, under its first member
                      (d.code === 'cycle' && d.nodes[0] === node.id),
                  )
                  .map((d, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: diagnostics have no ids
                    <DiagnosticLine key={i} d={d} />
                  ))}
              </button>
              {edges.length > 0 && (
                <ul className="divide-y border-t">
                  {edges.map((e) => (
                    <EdgeRow
                      key={e.id}
                      edge={e}
                      direction="out"
                      far={byId.get(e.target)}
                      diagnostics={diagnostics}
                      highlighted={e.members.some((m) => m.id === highlightEdge)}
                      readOnly={readOnly}
                      onOpen={() => onSelectEdge(e)}
                      onRemove={() => onRemove(e)}
                      className="pl-2"
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
