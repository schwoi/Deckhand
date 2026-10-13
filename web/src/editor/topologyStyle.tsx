// Visual vocabulary shared by the topology graph, list and panel.

import type { RelationKind } from '@shared/agent-refs'
import type { DiagnosticCode, TopologyDiagnostic } from '@shared/topology'
import { cn } from '../lib/util'

export const EDGE_STYLE: Record<
  RelationKind,
  { color: string; dash?: string; width: number; label: string; short: string }
> = {
  delegation: { color: 'var(--accent)', width: 1.5, label: 'Delegation', short: 'delegates' },
  handoff: {
    color: 'var(--success)',
    dash: '7 4',
    width: 1.5,
    label: 'Handoff',
    short: 'hands off',
  },
  force_handoff: {
    color: 'var(--warning)',
    dash: '1 4',
    width: 2.75,
    label: 'Forced handoff',
    short: 'always hands off',
  },
}

/** Short line sample in an edge style, for the legend and relationship lists. */
export function RelationSample({ kind, className }: { kind: RelationKind; className?: string }) {
  const s = EDGE_STYLE[kind]
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="8"
      viewBox="0 0 24 8"
      className={cn('shrink-0', className)}
    >
      <line
        x1="1"
        y1="4"
        x2="23"
        y2="4"
        strokeLinecap="round"
        style={{ stroke: s.color, strokeWidth: s.width, strokeDasharray: s.dash }}
      />
    </svg>
  )
}

export interface Severity {
  errors: number
  warnings: number
}

export function severityById(diagnostics: TopologyDiagnostic[]) {
  const nodes = new Map<string, Severity>()
  const edges = new Map<string, Severity>()
  const bump = (m: Map<string, Severity>, id: string, d: TopologyDiagnostic) => {
    const s = m.get(id) ?? { errors: 0, warnings: 0 }
    if (d.severity === 'error') s.errors++
    else s.warnings++
    m.set(id, s)
  }
  for (const d of diagnostics) {
    for (const id of d.nodes) bump(nodes, id, d)
    for (const id of d.edges) bump(edges, id, d)
  }
  return { nodes, edges }
}

/** Few-word form of a diagnostic, appended to a highlighted edge's label. */
export const DIAGNOSTIC_SHORT: Record<DiagnosticCode, string> = {
  'unresolved-target': 'not defined',
  'self-link': 'self-link',
  duplicate: 'listed twice',
  cycle: 'in a cycle',
  'force-handoff-cycle': 'forced loop',
  unreachable: 'unreachable',
  issue: 'invalid',
}
