import type { RelationKind } from '@shared/agent-refs'
import type { Topology, TopologyDiagnostic, TopologyNode } from '@shared/topology'
import {
  CircleAlert,
  Crosshair,
  Info,
  Maximize,
  Package,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  type KeyboardEvent,
  type PointerEvent,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/misc'
import { cn } from '../lib/util'
import {
  type GraphLayout,
  NODE_H,
  NODE_W,
  type Point,
  type VisualEdge,
  edgeGeometry,
  visualEdges,
} from './topologyLayout'
import {
  DIAGNOSTIC_SHORT,
  EDGE_STYLE,
  RelationSample,
  type Severity,
  severityById,
} from './topologyStyle'

interface View {
  x: number
  y: number
  k: number
}
const MIN_K = 0.1
const MAX_K = 2.5
const MARGIN = 56
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k))

export function TopologyCanvas({
  topology,
  layout,
  diagnostics,
  selected,
  highlightEdge,
  matches,
  focus,
  onFocusChange,
  onSelectNode,
  onSelectEdge,
  onClear,
}: {
  topology: Topology
  layout: GraphLayout
  diagnostics: TopologyDiagnostic[]
  /** selected node id */
  selected: string | null
  highlightEdge: string | null
  /** node ids matching the search; null when not searching */
  matches: Set<string> | null
  focus: boolean
  onFocusChange: (focus: boolean) => void
  onSelectNode: (id: string) => void
  onSelectEdge: (edge: VisualEdge) => void
  onClear: () => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const fitted = useRef(false)

  const neighborhood = useMemo(() => {
    if (!selected) return null
    const ids = new Set([selected])
    for (const e of topology.edges) {
      if (e.source === selected) ids.add(e.target)
      if (e.target === selected) ids.add(e.source)
    }
    return ids
  }, [topology.edges, selected])

  const fitTo = useCallback(
    (ids?: Iterable<string>) => {
      const el = viewport.current
      if (!el || !el.clientWidth || !el.clientHeight) return
      const pts = [...(ids ?? layout.pos.keys())]
        .map((id) => layout.pos.get(id))
        .filter((p): p is Point => !!p)
      if (!pts.length) return
      const x0 = Math.min(...pts.map((p) => p.x)) - MARGIN
      const y0 = Math.min(...pts.map((p) => p.y)) - MARGIN
      const x1 = Math.max(...pts.map((p) => p.x + NODE_W)) + MARGIN + 40 // room for self-loops
      const y1 = Math.max(...pts.map((p) => p.y + NODE_H)) + MARGIN
      const k = clampK(Math.min(el.clientWidth / (x1 - x0), el.clientHeight / (y1 - y0), 1.25))
      setView({
        k,
        x: (el.clientWidth - (x1 - x0) * k) / 2 - x0 * k,
        y: (el.clientHeight - (y1 - y0) * k) / 2 - y0 * k,
      })
    },
    [layout],
  )

  // fit once the viewport has a size (framing the focus if on); later edits keep the user's view
  const framed = useRef<Set<string> | null>(null)
  framed.current = focus ? neighborhood : null
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!fitted.current && el.clientWidth && el.clientHeight) {
        fitted.current = true
        fitTo(framed.current ?? undefined)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitTo])

  // pan just enough to center a node that is not fully visible
  const viewRef = useRef(view)
  viewRef.current = view
  const ensureVisible = useCallback(
    (id: string) => {
      const el = viewport.current
      const p = layout.pos.get(id)
      if (!el || !p) return
      const { x, y, k } = viewRef.current
      const left = x + p.x * k
      const top = y + p.y * k
      const inside =
        left >= 0 &&
        top >= 0 &&
        left + NODE_W * k <= el.clientWidth &&
        top + NODE_H * k <= el.clientHeight
      if (!inside)
        setView({
          k,
          x: el.clientWidth / 2 - (p.x + NODE_W / 2) * k,
          y: el.clientHeight / 2 - (p.y + NODE_H / 2) * k,
        })
    },
    [layout],
  )

  // focus mode frames the selection and its neighbours; otherwise bring the selection into view
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to selection/focus changes
  useEffect(() => {
    if (!selected) return
    if (focus && neighborhood) fitTo(neighborhood)
    else ensureVisible(selected)
  }, [selected, focus])

  const zoomAt = useCallback((factor: number, at?: Point) => {
    const el = viewport.current
    const cx = at?.x ?? (el?.clientWidth ?? 0) / 2
    const cy = at?.y ?? (el?.clientHeight ?? 0) / 2
    setView((v) => {
      const k = clampK(v.k * factor)
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }
    })
  }, [])

  // wheel/trackpad zoom around the pointer; needs a non-passive listener to stop page scroll
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // Pan with one pointer (from the background or a node), pinch with two. Dragging starts after a
  // few pixels, and the click that ends a drag is ignored so it does not select anything.
  const pointers = useRef(new Map<number, Point>())
  const last = useRef<{ c: Point; d: number } | null>(null)
  const dragged = useRef(false)
  const gestureState = () => {
    const pts = [...pointers.current.values()]
    const c = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    }
    const [a, b] = pts
    return { c, d: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 }
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as Element).closest('[data-controls]')) return
    const r = e.currentTarget.getBoundingClientRect()
    pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top })
    if (pointers.current.size === 1) dragged.current = false
    last.current = gestureState()
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !last.current) return
    const r = e.currentTarget.getBoundingClientRect()
    pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top })
    const next = gestureState()
    const prev = last.current
    if (!dragged.current) {
      if (Math.hypot(next.c.x - prev.c.x, next.c.y - prev.c.y) < 4 && pointers.current.size < 2)
        return
      dragged.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    last.current = next
    setView((v) => {
      const k = prev.d && next.d ? clampK(v.k * (next.d / prev.d)) : v.k
      return {
        k,
        x: next.c.x - ((prev.c.x - v.x) * k) / v.k,
        y: next.c.y - ((prev.c.y - v.y) * k) / v.k,
      }
    })
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    last.current = pointers.current.size ? gestureState() : null
  }

  const selectNode = useCallback(
    (id: string, byPointer: boolean) => {
      if (byPointer && dragged.current) return
      onSelectNode(id)
    },
    [onSelectNode],
  )
  const selectEdge = useCallback(
    (edge: VisualEdge) => {
      if (!dragged.current) onSelectEdge(edge)
    },
    [onSelectEdge],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') return onClear()
    if (e.target !== e.currentTarget) return
    const pan = (dx: number, dy: number) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
    const actions: Record<string, () => void> = {
      '+': () => zoomAt(1.2),
      '=': () => zoomAt(1.2),
      '-': () => zoomAt(1 / 1.2),
      '0': () => fitTo(),
      ArrowLeft: () => pan(60, 0),
      ArrowRight: () => pan(-60, 0),
      ArrowUp: () => pan(0, 60),
      ArrowDown: () => pan(0, -60),
    }
    const action = actions[e.key]
    if (!action) return
    e.preventDefault()
    action()
  }

  const content = useMemo(
    () => (
      <GraphContent
        topology={topology}
        layout={layout}
        diagnostics={diagnostics}
        selected={selected}
        highlightEdge={highlightEdge}
        matches={matches}
        dimOutside={focus ? neighborhood : null}
        onSelectNode={selectNode}
        onSelectEdge={selectEdge}
        onFocusNode={ensureVisible}
      />
    ),
    [
      topology,
      layout,
      diagnostics,
      selected,
      highlightEdge,
      matches,
      focus,
      neighborhood,
      selectNode,
      selectEdge,
      ensureVisible,
    ],
  )

  const grid = 24 * view.k
  return (
    <div
      ref={viewport}
      // biome-ignore lint/a11y/useSemanticElements: a pannable canvas, not a form group
      role="group"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users can pan and zoom
      tabIndex={0}
      aria-label="Agent topology graph. Arrow keys pan, plus and minus zoom, 0 fits the graph. Use the List view for a keyboard-friendly list of every relationship."
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // tabbing to an off-screen node scrolls this clipped box; undo that and pan instead
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0
        e.currentTarget.scrollLeft = 0
      }}
      onClick={(e) => {
        if (dragged.current) dragged.current = false
        else if (!(e.target as Element).closest('[data-node], [data-edge], [data-controls]'))
          onClear()
      }}
      className="relative h-full touch-none overflow-hidden bg-canvas outline-offset-[-2px] select-none"
      style={{
        backgroundImage: 'radial-gradient(var(--border-strong) 1px, transparent 1px)',
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
        }}
      >
        {content}
      </div>
      <Legend />
      <div
        data-controls
        className="absolute right-3 bottom-3 flex flex-col gap-1 rounded-lg border bg-surface p-1 shadow-sm"
      >
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon={<ZoomIn />}
          title="Zoom in"
          onClick={() => zoomAt(1.25)}
        />
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon={<ZoomOut />}
          title="Zoom out"
          onClick={() => zoomAt(1 / 1.25)}
        />
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon={<Maximize />}
          title="Fit to view"
          onClick={() => fitTo(focus && neighborhood ? neighborhood : undefined)}
        />
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon={<Crosshair />}
          title={
            selected ? 'Focus on the selection and its relationships' : 'Select an agent to focus'
          }
          aria-pressed={focus}
          disabled={!selected}
          className={cn(focus && 'bg-accent-soft text-accent-text')}
          onClick={() => onFocusChange(!focus)}
        />
      </div>
    </div>
  )
}

/** Always shown from sm up; a toggle on phones so it doesn't cover the graph. */
function Legend() {
  const [open, setOpen] = useState(false)
  return (
    <div data-controls className="absolute bottom-3 left-3 flex flex-col items-start gap-1.5">
      <div
        className={cn(
          'flex flex-col gap-1 rounded-lg border bg-surface/90 px-2.5 py-2 text-2xs text-muted shadow-sm backdrop-blur-sm',
          !open && 'max-sm:hidden',
        )}
      >
        {(Object.keys(EDGE_STYLE) as RelationKind[]).map((k) => (
          <span key={k} className="flex items-center gap-2">
            <RelationSample kind={k} />
            {EDGE_STYLE[k].label}
          </span>
        ))}
        <span className="flex items-center gap-2">
          <span className="h-2 w-6 rounded-sm border border-dashed border-line-strong" />
          External reference
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-6 rounded-sm border border-dashed border-danger" />
          Not defined
        </span>
      </div>
      <Button
        size="sm"
        icon={<Info />}
        aria-expanded={open}
        className="shadow-sm sm:hidden"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide legend' : 'Legend'}
      </Button>
    </div>
  )
}

/** Node badges only for problems with the node itself; relationship warnings live on edges. */
const badgesNode = (d: TopologyDiagnostic) => d.severity === 'error' || d.code === 'unreachable'

const GraphContent = memo(function GraphContent({
  topology,
  layout,
  diagnostics,
  selected,
  highlightEdge,
  matches,
  dimOutside,
  onSelectNode,
  onSelectEdge,
  onFocusNode,
}: {
  topology: Topology
  layout: GraphLayout
  diagnostics: TopologyDiagnostic[]
  selected: string | null
  highlightEdge: string | null
  matches: Set<string> | null
  dimOutside: Set<string> | null
  /** `byPointer` is false for keyboard activation */
  onSelectNode: (id: string, byPointer: boolean) => void
  onSelectEdge: (edge: VisualEdge) => void
  onFocusNode: (id: string) => void
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const edges = useMemo(() => visualEdges(topology.edges), [topology.edges])
  const geometry = useMemo(() => edgeGeometry(edges, layout), [edges, layout])
  const nodeSeverity = useMemo(
    () => severityById(diagnostics.filter(badgesNode)).nodes,
    [diagnostics],
  )
  const edgeDiags = useMemo(() => {
    const m = new Map<string, TopologyDiagnostic[]>()
    for (const d of diagnostics) for (const id of d.edges) m.set(id, [...(m.get(id) ?? []), d])
    return m
  }, [diagnostics])
  const [hoverNode, setHoverNode] = useState<string | null>(null)
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)

  // hovering (or else selecting) a node lightly emphasises it and its direct relationships
  const emphasis = hoverNode ?? selected
  const related = useMemo(() => {
    if (!emphasis) return null
    const ids = new Set([emphasis])
    for (const e of edges) {
      if (e.source === emphasis) ids.add(e.target)
      if (e.target === emphasis) ids.add(e.source)
    }
    return ids
  }, [edges, emphasis])

  const markers: [string, string][] = [
    ...(Object.keys(EDGE_STYLE) as RelationKind[]).map((k): [string, string] => [
      k,
      EDGE_STYLE[k].color,
    ]),
    ['error', 'var(--danger)'],
  ]
  // large graphs rest at lower contrast; hover or selection brings relationships forward
  const resting = edges.length > 60 ? 0.5 : 1
  const drawn = edges.flatMap((e) => {
    const g = geometry.get(e.id)
    if (!g) return []
    const diags = e.members.flatMap((m) => edgeDiags.get(m.id) ?? [])
    const error = diags.some((d) => d.severity === 'error')
    const incident = emphasis !== null && (e.source === emphasis || e.target === emphasis)
    const active =
      e.id === hoverEdge ||
      (highlightEdge !== null && e.members.some((m) => m.id === highlightEdge))
    const hidden =
      (dimOutside && !(e.source === selected || e.target === selected)) ||
      (matches !== null && !matches.has(e.source) && !matches.has(e.target))
    const opacity = hidden ? 0.08 : active ? 1 : emphasis ? (incident ? 1 : 0.12) : resting
    const color = error ? 'var(--danger)' : EDGE_STYLE[e.kind].color
    const notes = [...new Set(diags.map((d) => DIAGNOSTIC_SHORT[d.code]))]
    return [{ e, g, error, incident, active, opacity, color, notes }]
  })

  return (
    <>
      <svg
        aria-hidden="true"
        width={layout.width}
        height={layout.height}
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
      >
        <defs>
          {markers.map(([k, color]) => (
            <marker
              key={k}
              id={`${uid}-${k}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L10,5 L0,9 z" style={{ fill: color }} />
            </marker>
          ))}
        </defs>
        {drawn.map(({ e, g, error, incident, active, opacity, color }) => {
          const s = EDGE_STYLE[e.kind]
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users reach edges through the List view and node panels
            <g
              key={e.id}
              data-edge
              className="cursor-pointer"
              style={{ opacity }}
              onClick={(ev) => {
                ev.stopPropagation()
                onSelectEdge(e)
              }}
              onPointerEnter={() => setHoverEdge(e.id)}
              onPointerLeave={() => setHoverEdge((h) => (h === e.id ? null : h))}
            >
              <title>{describeEdge(e)}</title>
              <path
                d={g.d}
                fill="none"
                className="pointer-events-auto"
                style={{ stroke: 'transparent', strokeWidth: 14 }}
              />
              <path
                d={g.d}
                fill="none"
                strokeLinecap="round"
                markerEnd={`url(#${uid}-${error ? 'error' : e.kind})`}
                style={{
                  stroke: color,
                  strokeWidth: s.width + (active ? 1.25 : incident ? 0.5 : 0),
                  strokeDasharray: s.dash,
                }}
              />
            </g>
          )
        })}
        {/* labels only for the hovered/selected relationship, drawn above every edge */}
        {drawn
          .filter((x) => x.active)
          .map(({ e, g, color, notes }) => (
            <text
              key={e.id}
              x={g.label.x}
              y={g.label.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-2xs font-medium"
              style={{
                fill: color,
                stroke: 'var(--bg)',
                strokeWidth: 4,
                paintOrder: 'stroke',
                strokeLinejoin: 'round',
              }}
            >
              {[EDGE_STYLE[e.kind].short, ...notes].join(' · ')}
            </text>
          ))}
      </svg>
      {topology.nodes.map((n) => {
        const p = layout.pos.get(n.id)
        if (!p) return null
        const dimmed =
          (dimOutside && !dimOutside.has(n.id)) || (matches !== null && !matches.has(n.id))
        return (
          <GraphNode
            key={n.id}
            node={n}
            at={p}
            selected={n.id === selected}
            dimmed={!!dimmed}
            faded={!dimmed && related !== null && !related.has(n.id)}
            match={matches?.has(n.id) ?? false}
            severity={nodeSeverity.get(n.id)}
            onSelect={onSelectNode}
            onFocus={onFocusNode}
            onHover={setHoverNode}
          />
        )
      })}
    </>
  )
})

/** Accessible name for a drawn edge, covering every relationship it stands for. */
export function describeEdge(e: VisualEdge): string {
  const first = e.members[0]
  if (!first) return ''
  const text = `${first.from} ${EDGE_STYLE[e.kind].short} ${first.ref}`
  return e.members.length > 1 ? `${text} (also listed in handoffs)` : text
}

const GraphNode = memo(function GraphNode({
  node: n,
  at,
  selected,
  dimmed,
  faded,
  match,
  severity,
  onSelect,
  onFocus,
  onHover,
}: {
  node: TopologyNode
  at: Point
  selected: boolean
  /** hidden by focus mode or search */
  dimmed: boolean
  /** unrelated to the hovered/selected node */
  faded: boolean
  match: boolean
  severity?: Severity
  onSelect: (id: string, byPointer: boolean) => void
  onFocus: (id: string) => void
  onHover: (id: string | null) => void
}) {
  const errors = severity?.errors ?? 0
  const warnings = severity?.warnings ?? 0
  const kindLabel =
    n.kind === 'external'
      ? 'external reference, unverified'
      : n.kind === 'missing'
        ? 'not defined in this file'
        : 'agent'
  const issueLabel = [
    errors && `${errors} error${errors === 1 ? '' : 's'}`,
    warnings && `${warnings} warning${warnings === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <button
      type="button"
      data-node
      aria-pressed={selected}
      aria-label={[n.name, kindLabel, n.entry && 'entry point', issueLabel]
        .filter(Boolean)
        .join(', ')}
      onClick={(e) => onSelect(n.id, e.detail > 0)}
      onFocus={() => onFocus(n.id)}
      onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(n.id)}
      onPointerLeave={() => onHover(null)}
      style={{ left: at.x, top: at.y, width: NODE_W, height: NODE_H }}
      className={cn(
        'absolute flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg border bg-surface px-3 text-left shadow-xs transition-[opacity,box-shadow] hover:border-line-strong hover:shadow-sm',
        n.kind !== 'agent' && 'border-dashed bg-sunken',
        n.kind === 'missing' && 'border-danger',
        errors > 0 && 'border-danger',
        n.entry && 'border-accent/60',
        selected && 'border-accent ring-2 ring-accent/40',
        match && !selected && 'ring-2 ring-warning/60',
        dimmed && 'opacity-25',
        faded && 'opacity-45',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {n.kind === 'external' && <Package className="size-3.5 shrink-0 text-faint" />}
        <span className="min-w-0 truncate font-mono text-sm font-semibold">{n.name}</span>
        {n.entry && <Badge tone="accent">entry</Badge>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {errors > 0 && <CircleAlert className="size-3.5 text-danger" />}
          {warnings > 0 && <TriangleAlert className="size-3.5 text-warning" />}
        </span>
      </span>
      {n.kind === 'agent' ? (
        <>
          <span className={cn('truncate text-xs', n.description ? 'text-muted' : 'text-faint')}>
            {n.description || 'No description'}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-faint">
            <span className="min-w-0 truncate font-mono">{n.model || 'no model'}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">
              {n.toolsets} toolset{n.toolsets === 1 ? '' : 's'}
            </span>
          </span>
        </>
      ) : n.kind === 'external' ? (
        <>
          <span className="truncate font-mono text-2xs text-muted">{n.reference}</span>
          <span className="text-2xs text-faint">Unverified · not fetched</span>
        </>
      ) : (
        <span className="text-xs text-danger">Not defined in this file</span>
      )}
    </button>
  )
})
