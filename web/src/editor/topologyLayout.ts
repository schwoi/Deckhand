// Deterministic layered layout for the topology graph: BFS ranks from the entry point, a few
// barycenter sweeps to reduce crossings, and wide layers wrapped into rows. Depends only on graph
// structure, so description/model edits never move nodes. Pure, so a stored layout can later
// replace it per node.

import type { RelationKind } from '@shared/agent-refs'
import type { Topology, TopologyEdge } from '@shared/topology'

export const NODE_W = 208
export const NODE_H = 80
const GAP_X = 48
const GAP_Y = 88
const MAX_ROW = 8
const SWEEPS = 4

export interface Point {
  x: number
  y: number
}

export interface GraphLayout {
  /** top-left corner of each node */
  pos: Map<string, Point>
  row: Map<string, number>
  width: number
  height: number
}

/** Changes only when nodes, edge endpoints or the entry point change. */
export function structureKey(t: Pick<Topology, 'nodes' | 'edges' | 'entry'>): string {
  return [
    t.entry,
    t.nodes.map((n) => n.id).join('\0'),
    t.edges.map((e) => `${e.source}\0${e.target}`).join('\0'),
  ].join('\n')
}

export function layoutGraph(
  nodes: { id: string }[],
  edges: { source: string; target: string }[],
  entry?: string,
): GraphLayout {
  const out = new Map<string, string[]>()
  const inn = new Map<string, string[]>()
  for (const n of nodes) {
    out.set(n.id, [])
    inn.set(n.id, [])
  }
  for (const e of edges) {
    const o = out.get(e.source)
    const i = inn.get(e.target)
    if (e.source === e.target || !o || !i || o.includes(e.target)) continue
    o.push(e.target)
    i.push(e.source)
  }

  // ranks: BFS from the entry point, then from each still-unplaced node in file order
  const rank = new Map<string, number>()
  const layers: string[][] = []
  const starts = [...(entry && out.has(entry) ? [entry] : []), ...nodes.map((n) => n.id)]
  for (const start of starts) {
    if (rank.has(start)) continue
    rank.set(start, 0)
    const queue = [start]
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const r = rank.get(id) ?? 0
      const layer = layers[r]
      if (layer) layer.push(id)
      else layers[r] = [id]
      for (const t of out.get(id) ?? [])
        if (!rank.has(t)) {
          rank.set(t, r + 1)
          queue.push(t)
        }
    }
  }

  // crossing reduction: order each layer by the mean position of its neighbours in the next one
  const index = new Map<string, number>()
  const reindex = (layer: string[]) => layer.forEach((id, i) => index.set(id, i))
  for (const layer of layers) reindex(layer)
  const reorder = (layer: string[], ref: string[]) => {
    const inRef = new Set(ref)
    const scale = ref.length / Math.max(layer.length, 1)
    const bary = new Map<string, number>()
    for (const id of layer) {
      const near = [...(out.get(id) ?? []), ...(inn.get(id) ?? [])].filter((n) => inRef.has(n))
      bary.set(
        id,
        near.length
          ? near.reduce((s, n) => s + (index.get(n) ?? 0), 0) / near.length
          : (index.get(id) ?? 0) * scale,
      )
    }
    layer.sort(
      (a, b) =>
        (bary.get(a) ?? 0) - (bary.get(b) ?? 0) || (index.get(a) ?? 0) - (index.get(b) ?? 0),
    )
    reindex(layer)
  }
  for (let s = 0; s < SWEEPS; s++) {
    for (let r = 1; r < layers.length; r++) reorder(layers[r] ?? [], layers[r - 1] ?? [])
    for (let r = layers.length - 2; r >= 0; r--) reorder(layers[r] ?? [], layers[r + 1] ?? [])
  }

  // pull same-layer partners next to each other so their edge runs side to side, unless that
  // adds crossings with the neighbouring layers
  const linked = (a: string, b: string) => out.get(a)?.includes(b) || out.get(b)?.includes(a)
  const crossings = (upper: string[], lower: string[]) => {
    const pairs: [number, number][] = []
    upper.forEach((u, i) => {
      lower.forEach((l, j) => {
        if (linked(u, l)) pairs.push([i, j])
      })
    })
    let n = 0
    for (let a = 0; a < pairs.length; a++)
      for (let b = a + 1; b < pairs.length; b++) {
        const [i1, j1] = pairs[a] ?? [0, 0]
        const [i2, j2] = pairs[b] ?? [0, 0]
        if ((i1 - i2) * (j1 - j2) < 0) n++
      }
    return n
  }
  layers.forEach((layer, r) => {
    const cost = () => crossings(layers[r - 1] ?? [], layer) + crossings(layer, layers[r + 1] ?? [])
    for (const u of [...layer])
      for (const v of out.get(u) ?? []) {
        const iu = layer.indexOf(u)
        const iv = layer.indexOf(v)
        if (iv < 0 || Math.abs(iu - iv) <= 1) continue
        const before = cost()
        const saved = [...layer]
        layer.splice(iv, 1)
        layer.splice(iv > iu ? iu + 1 : iu, 0, v)
        if (cost() > before) layer.splice(0, layer.length, ...saved)
      }
    reindex(layer)
  })

  const rows = layers.flatMap((layer) =>
    Array.from({ length: Math.ceil(layer.length / MAX_ROW) }, (_, i) =>
      layer.slice(i * MAX_ROW, (i + 1) * MAX_ROW),
    ),
  )
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const width = cols * (NODE_W + GAP_X) - GAP_X
  const pos = new Map<string, Point>()
  const row = new Map<string, number>()
  rows.forEach((ids, r) => {
    const offset = (width - (ids.length * (NODE_W + GAP_X) - GAP_X)) / 2
    ids.forEach((id, i) => {
      pos.set(id, { x: offset + i * (NODE_W + GAP_X), y: r * (NODE_H + GAP_Y) })
      row.set(id, r)
    })
  })
  return { pos, row, width, height: Math.max(0, rows.length * (NODE_H + GAP_Y) - GAP_Y) }
}

/** One drawn edge; may stand for several configured relationships. */
export interface VisualEdge {
  /** id of the first member; the drawn style follows `kind` */
  id: string
  kind: RelationKind
  source: string
  target: string
  members: TopologyEdge[]
}

/**
 * Relationships as drawn. A handoff and a forced handoff to the same target are one relationship
 * (the forced one implies the other), drawn in the forced style; everything else stays separate.
 */
export function visualEdges(edges: TopologyEdge[]): VisualEdge[] {
  const pair = (e: TopologyEdge) => `${e.source}\0${e.target}`
  const handoffs = new Map(edges.filter((e) => e.kind === 'handoff').map((e) => [pair(e), e]))
  const forced = new Set(edges.filter((e) => e.kind === 'force_handoff').map(pair))
  return edges.flatMap((e): VisualEdge[] => {
    if (e.kind === 'handoff' && forced.has(pair(e))) return []
    const also = e.kind === 'force_handoff' ? handoffs.get(pair(e)) : undefined
    const members = also ? [e, also] : [e]
    return [{ id: e.id, kind: e.kind, source: e.source, target: e.target, members }]
  })
}

export interface EdgeGeometry {
  d: string
  label: Point
}

/** Ports stay this far from the node's corners; the top-right corner is kept for self-loops. */
const PORT_INSET = 36
const LANE = 14

type Route = 'down' | 'up' | 'side' | 'arc' | 'self'

/**
 * SVG paths for every drawn edge. Each edge gets its own port on the node's top or bottom side,
 * ordered by where the other end sits, so edges fan out without crossing at the node. Edges
 * between neighbours in a row run side to side; other same-row edges dip below the row.
 * Self-links loop over the top-right corner.
 */
export function edgeGeometry(edges: VisualEdge[], layout: GraphLayout): Map<string, EdgeGeometry> {
  const centerX = (p: Point) => p.x + NODE_W / 2
  const routes = new Map<string, Route>()
  const ports = new Map<
    string,
    { node: Point; ends: { key: string; other: number; i: number }[] }
  >()
  const addPort = (node: string, side: 'top' | 'bottom', key: string, other: number, i: number) => {
    const at = layout.pos.get(node)
    if (!at) return
    const slot = `${side}\0${node}`
    const entry = ports.get(slot) ?? { node: at, ends: [] }
    entry.ends.push({ key, other, i })
    ports.set(slot, entry)
  }

  edges.forEach((e, i) => {
    const s = layout.pos.get(e.source)
    const t = layout.pos.get(e.target)
    if (!s || !t) return
    const sr = layout.row.get(e.source) ?? 0
    const tr = layout.row.get(e.target) ?? 0
    const route: Route =
      e.source === e.target
        ? 'self'
        : tr > sr
          ? 'down'
          : tr < sr
            ? 'up'
            : Math.abs(s.x - t.x) <= NODE_W + GAP_X + 1
              ? 'side'
              : 'arc'
    routes.set(e.id, route)
    if (route === 'self' || route === 'side') return
    const sSide = route === 'up' ? 'top' : 'bottom'
    const tSide = route === 'down' ? 'top' : 'bottom'
    addPort(e.source, sSide, `${e.id}\0s`, centerX(t), i)
    addPort(e.target, tSide, `${e.id}\0t`, centerX(s), i)
  })

  const portX = new Map<string, number>()
  for (const { node, ends } of ports.values()) {
    ends.sort((a, b) => a.other - b.other || a.i - b.i)
    const span = NODE_W - 2 * PORT_INSET
    ends.forEach((end, k) => {
      portX.set(end.key, node.x + PORT_INSET + (span * (k + 0.5)) / ends.length)
    })
  }

  // parallel lanes for side-by-side, below-row and self edges between the same nodes
  const lanes = new Map<string, number>()
  const laneOf = (e: VisualEdge) => {
    const key = [e.source, e.target].sort().join('\0')
    const n = lanes.get(key) ?? 0
    lanes.set(key, n + 1)
    return n
  }
  const sameRow = edges.filter((e) => ['side', 'arc', 'self'].includes(routes.get(e.id) ?? ''))
  const laneCount = new Map<string, number>()
  for (const e of sameRow) {
    const key = [e.source, e.target].sort().join('\0')
    laneCount.set(key, (laneCount.get(key) ?? 0) + 1)
  }

  const result = new Map<string, EdgeGeometry>()
  const cubic = (a: Point, c1: Point, c2: Point, b: Point): EdgeGeometry => ({
    d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`,
    label: { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 },
  })
  for (const e of edges) {
    const s = layout.pos.get(e.source)
    const t = layout.pos.get(e.target)
    const route = routes.get(e.id)
    if (!s || !t || !route) continue
    if (route === 'self') {
      const r = 34 + laneOf(e) * 16
      const a = { x: s.x + NODE_W, y: s.y + 22 }
      const b = { x: s.x + NODE_W - 16, y: s.y }
      result.set(e.id, cubic(a, { x: a.x + r, y: a.y }, { x: b.x, y: b.y - r }, b))
      continue
    }
    if (route === 'side') {
      const n = laneCount.get([e.source, e.target].sort().join('\0')) ?? 1
      const lane = (laneOf(e) - (n - 1) / 2) * LANE
      const dir = t.x > s.x ? 1 : -1
      const a = { x: dir > 0 ? s.x + NODE_W : s.x, y: s.y + NODE_H / 2 + lane }
      const b = { x: dir > 0 ? t.x : t.x + NODE_W, y: t.y + NODE_H / 2 + lane }
      result.set(e.id, cubic(a, { x: a.x + dir * 16, y: a.y }, { x: b.x - dir * 16, y: b.y }, b))
      continue
    }
    const a = {
      x: portX.get(`${e.id}\0s`) ?? centerX(s),
      y: route === 'up' ? s.y : s.y + NODE_H,
    }
    const b = {
      x: portX.get(`${e.id}\0t`) ?? centerX(t),
      y: route === 'down' ? t.y : t.y + NODE_H,
    }
    if (route === 'arc') {
      const depth = 36 + laneOf(e) * LANE * 1.3
      result.set(e.id, cubic(a, { x: a.x, y: a.y + depth }, { x: b.x, y: b.y + depth }, b))
      continue
    }
    const k = Math.max(36, Math.abs(b.y - a.y) * 0.45)
    const dir = route === 'down' ? 1 : -1
    result.set(e.id, cubic(a, { x: a.x, y: a.y + dir * k }, { x: b.x, y: b.y - dir * k }, b))
  }
  return result
}
