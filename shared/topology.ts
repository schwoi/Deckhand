// Projects a parsed (possibly schema-invalid) configuration into an agent relationship graph with
// diagnostics. Pure: the topology view renders it, and later revision/run views can reuse it.
// Relationships are capabilities the runtime may use, not an execution order.

import {
  RELATIONS,
  type RelationKind,
  parseAgentRef,
  relationEntries,
  relationProblems,
} from './agent-refs'
import type { ValidationIssue } from './api'

export type NodeKind = 'agent' | 'external' | 'missing'

export interface TopologyNode {
  /** `agent:<name>`, `external:<ref as written>` or `missing:<name>` */
  id: string
  kind: NodeKind
  name: string
  /** YAML path of the definition, or of the first reference for external/missing nodes */
  path: string
  entry: boolean
  description?: string
  model?: string
  /** inline toolsets plus use_toolsets references */
  toolsets: number
  /** external only: the reference without its alias */
  reference?: string
  /** external references are never fetched here, so they stay unverified */
  resolution?: 'unverified'
}

export interface TopologyEdge {
  /** `<kind>:<source agent>-><target as written>`; stable across reordering */
  id: string
  kind: RelationKind
  source: string
  target: string
  /** source agent name and target as written */
  from: string
  ref: string
  path: string
}

export type DiagnosticCode =
  | 'unresolved-target'
  | 'self-link'
  | 'duplicate'
  | 'cycle'
  | 'force-handoff-cycle'
  | 'name-conflict'
  | 'unreachable'
  | 'issue'

export interface TopologyDiagnostic {
  severity: 'error' | 'warning'
  code: DiagnosticCode
  message: string
  /** YAML path of the field to fix */
  path: string
  nodes: string[]
  edges: string[]
}

export interface Topology {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  diagnostics: TopologyDiagnostic[]
  /** entry-point agent name, null when no agents are defined */
  entry: string | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export const agentId = (name: string) => `agent:${name}`
export const edgeId = (kind: RelationKind, from: string, ref: string) => `${kind}:${from}->${ref}`

/** Docker Agent runs `root` when defined, otherwise the first agent in the file. */
export function defaultEntry(names: string[]): string | null {
  return names.includes('root') ? 'root' : (names[0] ?? null)
}

const listNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

export function projectTopology(config: unknown, opts: { entry?: string } = {}): Topology {
  const agents = isObj(config) && isObj(config.agents) ? config.agents : {}
  const names = Object.keys(agents)
  const entry = opts.entry && Object.hasOwn(agents, opts.entry) ? opts.entry : defaultEntry(names)
  const nodes: TopologyNode[] = []
  const byId = new Map<string, TopologyNode>()
  const edges: TopologyEdge[] = []
  const edgeIds = new Set<string>()
  const diagnostics: TopologyDiagnostic[] = []

  for (const name of names) {
    const a = agents[name]
    const agent = isObj(a) ? a : {}
    const node: TopologyNode = {
      id: agentId(name),
      kind: 'agent',
      name,
      path: `agents.${name}`,
      entry: name === entry,
      description: typeof agent.description === 'string' ? agent.description : undefined,
      model: typeof agent.model === 'string' ? agent.model : undefined,
      toolsets:
        (Array.isArray(agent.toolsets) ? agent.toolsets.length : 0) +
        (Array.isArray(agent.use_toolsets) ? agent.use_toolsets.length : 0),
    }
    nodes.push(node)
    byId.set(node.id, node)
  }

  const targetNode = (ref: string, path: string): TopologyNode => {
    const parsed = parseAgentRef(ref)
    const id =
      parsed.kind === 'external'
        ? `external:${ref}`
        : Object.hasOwn(agents, ref)
          ? agentId(ref)
          : `missing:${ref}`
    let node = byId.get(id)
    if (!node) {
      node =
        parsed.kind === 'external'
          ? {
              id,
              kind: 'external',
              name: parsed.name,
              path,
              entry: false,
              toolsets: 0,
              reference: parsed.reference,
              resolution: 'unverified',
            }
          : { id, kind: 'missing', name: ref, path, entry: false, toolsets: 0 }
      nodes.push(node)
      byId.set(id, node)
    }
    return node
  }

  for (const { from, kind, ref, path } of relationEntries(agents)) {
    const { field, verb } = RELATIONS[kind]
    const id = edgeId(kind, from, ref)
    const at = { nodes: [agentId(from)], edges: [id], path }
    if (edgeIds.has(id)) {
      diagnostics.push({
        ...at,
        severity: 'warning',
        code: 'duplicate',
        message: `${ref} is listed more than once in ${from}'s ${field}.`,
      })
      continue
    }
    edgeIds.add(id)
    const target = targetNode(ref, path)
    edges.push({ id, kind, source: agentId(from), target: target.id, from, ref, path })
    // a forced self-handoff is a load error, reported with the other runtime rules below
    if (ref === from && kind !== 'force_handoff')
      diagnostics.push({
        ...at,
        severity: 'warning',
        code: 'self-link',
        message: `${from} ${verb} itself. This is allowed, but rarely intended.`,
      })
  }

  // load errors from the rules shared with the server validator; duplicates are reported once
  const edgeAt = new Map(edges.map((e) => [e.path, e]))
  for (const p of relationProblems(agents)) {
    const e = edgeAt.get(p.entry.path)
    if (!e) continue
    const { verb } = RELATIONS[e.kind]
    const base = { severity: 'error' as const, path: e.path, nodes: [e.source], edges: [e.id] }
    if (p.code === 'unknown-agent')
      diagnostics.push({
        ...base,
        nodes: [e.target],
        code: 'unresolved-target',
        message: `${e.from} ${verb} ${e.ref}, which is not an agent in this file.`,
      })
    else if (p.code === 'force-self')
      diagnostics.push({
        ...base,
        code: 'self-link',
        message: `${e.from} cannot force a handoff to itself; Docker Agent rejects this.`,
      })
    else if (p.code === 'name-conflict')
      diagnostics.push({
        ...base,
        nodes: [e.source, e.target, agentId(p.name)],
        code: 'name-conflict',
        message: `${e.ref} is named ${p.name}, like the local agent ${p.name}; Docker Agent refuses to load a team with this clash. Give it another name with name:reference.`,
      })
    else {
      const loop = p.loop.flatMap((l) => edgeAt.get(l.path) ?? [])
      diagnostics.push({
        ...base,
        nodes: loop.map((l) => l.source),
        edges: loop.map((l) => l.id),
        code: 'force-handoff-cycle',
        message: `Forced handoffs loop (${[...p.loop.map((l) => l.from), p.entry.from].join(' → ')}); Docker Agent rejects force_handoff cycles.`,
      })
    }
  }

  diagnostics.push(...cycles(nodes, edges))

  if (entry) {
    const reached = reachable(agentId(entry), edges)
    for (const n of nodes)
      if (n.kind === 'agent' && !reached.has(n.id))
        diagnostics.push({
          severity: 'warning',
          code: 'unreachable',
          message: `${n.name} is not reachable from the entry point ${entry}. It only runs when started directly.`,
          path: n.path,
          nodes: [n.id],
          edges: [],
        })
  }

  return { nodes, edges, diagnostics, entry }
}

function reachable(start: string, edges: TopologyEdge[]): Set<string> {
  const out = adjacency(edges)
  const seen = new Set([start])
  const queue = [start]
  for (let id = queue.shift(); id !== undefined; id = queue.shift())
    for (const e of out.get(id) ?? [])
      if (!seen.has(e.target)) {
        seen.add(e.target)
        queue.push(e.target)
      }
  return seen
}

function adjacency(edges: TopologyEdge[]): Map<string, TopologyEdge[]> {
  const out = new Map<string, TopologyEdge[]>()
  for (const e of edges) {
    const list = out.get(e.source)
    if (list) list.push(e)
    else out.set(e.source, [e])
  }
  return out
}

/** Strongly connected agent groups (Tarjan). Cycles are valid designs, so these are warnings. */
function cycles(nodes: TopologyNode[], edges: TopologyEdge[]): TopologyDiagnostic[] {
  const out = adjacency(edges)
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const groups: string[][] = []
  let counter = 0
  const visit = (v: string) => {
    index.set(v, counter)
    low.set(v, counter++)
    stack.push(v)
    onStack.add(v)
    for (const { target: w } of out.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0))
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0))
    }
    if (low.get(v) === index.get(v)) {
      const group: string[] = []
      for (let w = stack.pop(); w !== undefined; w = stack.pop()) {
        onStack.delete(w)
        group.push(w)
        if (w === v) break
      }
      if (group.length > 1) groups.push(group)
    }
  }
  for (const n of nodes) if (n.kind === 'agent' && !index.has(n.id)) visit(n.id)

  const order = new Map(nodes.map((n, i) => [n.id, i]))
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]))
  const result: TopologyDiagnostic[] = []
  for (const group of groups) {
    group.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    const members = new Set(group)
    const inner = edges.filter(
      (e) => members.has(e.source) && members.has(e.target) && e.source !== e.target,
    )
    // a pure forced-handoff loop is already reported as an error
    if (inner.every((e) => e.kind === 'force_handoff')) continue
    result.push({
      severity: 'warning',
      code: 'cycle',
      message: `${listNames(group.map((id) => nameOf.get(id) ?? id))} can reach each other in a cycle. Cycles are allowed; make sure instructions say when to stop delegating or handing back.`,
      path: inner[0]?.path ?? '',
      nodes: group,
      edges: inner.map((e) => e.id),
    })
  }
  return result
}

/** Where a validation issue path points in the graph: an edge, an agent node, or nothing. */
export function locateIssue(topology: Topology, path: string): { node?: string; edge?: string } {
  const name = topology.nodes
    .filter((n) => n.kind === 'agent')
    .map((n) => n.name)
    .sort((a, b) => b.length - a.length)
    .find((n) => path === `agents.${n}` || path.startsWith(`agents.${n}.`))
  if (name === undefined) return {}
  const rest = path.slice(`agents.${name}.`.length)
  const m = /^(sub_agents\.\d+|handoffs\.\d+|force_handoff)(\.|$)/.exec(rest)
  const fieldPath = m ? `agents.${name}.${m[1]}` : undefined
  const edge = fieldPath ? topology.edges.find((e) => e.path === fieldPath) : undefined
  return edge ? { node: edge.source, edge: edge.id } : { node: agentId(name) }
}

/**
 * Projection diagnostics plus the validation issues that belong to an agent, attached to their
 * node or edge. Issues elsewhere (models, MCP servers, metadata) stay in the editor's issue list.
 * Issues at a path (or edge) a projection error already explains are dropped to avoid repeating it.
 */
export function withIssues(topology: Topology, issues: ValidationIssue[]): TopologyDiagnostic[] {
  const edgePath = new Map(topology.edges.map((e) => [e.id, e.path]))
  const covered = new Set(
    topology.diagnostics
      .filter((d) => d.severity === 'error')
      .flatMap((d) => [d.path, ...d.edges.map((id) => edgePath.get(id) ?? '')]),
  )
  const extra = issues.flatMap((i): TopologyDiagnostic[] => {
    if (covered.has(i.path)) return []
    const at = locateIssue(topology, i.path)
    if (!at.node) return []
    return [
      {
        severity: 'error',
        code: 'issue',
        message: i.message,
        path: i.path,
        nodes: [at.node],
        edges: at.edge ? [at.edge] : [],
      },
    ]
  })
  return [...topology.diagnostics, ...extra]
}
