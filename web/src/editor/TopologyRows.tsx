import type { TopologyDiagnostic, TopologyNode } from '@shared/topology'
import { CircleAlert, Trash2, TriangleAlert } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/misc'
import { cn } from '../lib/util'
import type { VisualEdge } from './topologyLayout'
import { EDGE_STYLE, RelationSample } from './topologyStyle'

/** Arrow keys, Home and End move between the `[data-nav]` rows inside `e.currentTarget`. */
export function onListNavKey(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')]
  const at = rows.indexOf(document.activeElement as HTMLElement)
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))
  e.preventDefault()
  rows[next]?.focus()
  rows[next]?.scrollIntoView({ block: 'nearest' })
}

export function DiagnosticLine({ d }: { d: TopologyDiagnostic }) {
  return (
    <span
      className={cn(
        'flex items-start gap-1.5 text-xs',
        d.severity === 'error' ? 'text-danger' : 'text-warning',
      )}
    >
      {d.severity === 'error' ? (
        <CircleAlert className="mt-0.5 size-3 shrink-0" />
      ) : (
        <TriangleAlert className="mt-0.5 size-3 shrink-0" />
      )}
      <span className="text-fg/80">{d.message}</span>
    </span>
  )
}

/**
 * One relationship as a navigable row with its diagnostics and a remove button. `direction`
 * says which end the surrounding list is about: `out` names the target, `in` the source. A forced
 * handoff that is also listed in handoffs is one row, and removing it removes both entries.
 */
export function EdgeRow({
  edge: e,
  direction,
  far,
  diagnostics,
  highlighted,
  readOnly,
  onOpen,
  onRemove,
  className,
}: {
  edge: VisualEdge
  direction: 'out' | 'in'
  /** the node at the other end of the edge */
  far: TopologyNode | undefined
  diagnostics: TopologyDiagnostic[]
  highlighted: boolean
  readOnly: boolean
  onOpen: () => void
  onRemove: () => void
  className?: string
}) {
  const verb = EDGE_STYLE[e.kind].short
  const first = e.members[0]
  const from = first?.from ?? ''
  const ref = first?.ref ?? ''
  const merged = e.members.length > 1
  const target =
    far?.kind === 'external' && direction === 'out'
      ? `${ref} (external reference, unverified)`
      : far?.kind === 'missing' && direction === 'out'
        ? `${ref} (not defined)`
        : ref
  const text = `${from} ${verb} ${target}${merged ? ' (also listed in handoffs)' : ''}`
  const ids = new Set(e.members.map((m) => m.id))
  // cycle warnings span several rows, so the surrounding list shows them once instead
  const own = diagnostics.filter((d) => d.code !== 'cycle' && d.edges.some((id) => ids.has(id)))
  return (
    <li
      className={cn('flex items-start gap-1 pr-2', highlighted && 'bg-accent-soft/60', className)}
    >
      <button
        type="button"
        data-nav
        aria-label={text}
        aria-current={highlighted}
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pr-2 pl-3 text-left hover:bg-hover max-lg:py-3"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <RelationSample kind={e.kind} />
          <span className="shrink-0 text-muted">{direction === 'out' ? verb : `${verb} from`}</span>
          <span
            className={cn('min-w-0 truncate font-mono', far?.kind === 'missing' && 'text-danger')}
          >
            {direction === 'out' ? ref : from}
          </span>
          {far?.kind === 'external' && <Badge>unverified</Badge>}
          {merged && <Badge title="Also listed in handoffs">+ handoffs</Badge>}
        </span>
        {own.map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: diagnostics have no ids
          <DiagnosticLine key={i} d={d} />
        ))}
      </button>
      {!readOnly && (
        <Button
          size="xs"
          variant="danger-ghost"
          iconOnly
          icon={<Trash2 />}
          title={merged ? `Remove: ${text} (removes both entries)` : `Remove: ${text}`}
          className="mt-1.5 max-lg:mt-2"
          onClick={onRemove}
        />
      )}
    </li>
  )
}
