// Agent relationship references: parsing targets, and rename/delete/add/remove updates that keep
// every other key (known or not) untouched. Shared by the agent form and the topology view.

import type { AgentConfig, AgentFile } from './config'

export const RELATIONS = {
  delegation: { field: 'sub_agents', label: 'Delegation', verb: 'delegates to' },
  handoff: { field: 'handoffs', label: 'Handoff', verb: 'hands off to' },
  // Verified against Docker Agent v1.150.0: the target need not be listed in `handoffs`;
  // self-references, unknown local targets and force_handoff cycles fail to load.
  force_handoff: { field: 'force_handoff', label: 'Forced handoff', verb: 'always hands off to' },
} as const
export type RelationKind = keyof typeof RELATIONS
export const RELATION_KINDS = Object.keys(RELATIONS) as RelationKind[]

export type AgentRef =
  | { kind: 'local'; name: string }
  /** `name` is the explicit alias (`name:ref`) or the reference's last path segment. */
  | { kind: 'external'; name: string; reference: string }

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Classify a sub_agents/handoffs/force_handoff entry. Like the validator, anything containing `/`
 * or `:` is an external reference (OCI ref or URL); `name:ref` names it explicitly.
 */
export function parseAgentRef(raw: string): AgentRef {
  if (!raw.includes('/') && !raw.includes(':')) return { kind: 'local', name: raw }
  let reference = raw
  let name: string | undefined
  const colon = raw.indexOf(':')
  const head = raw.slice(0, colon)
  const rest = raw.slice(colon + 1)
  // Matches Docker Agent v1.150.0: `host:5000/repo` and `a:host:5000/repo` are full references
  // (the first path segment after the colon is a port or contains a colon), `a:org/repo:tag`
  // and `a:https://…` are aliases.
  const firstSegment = rest.split('/')[0] ?? ''
  const aliased =
    !URL_RE.test(raw) &&
    colon > 0 &&
    !head.includes('/') &&
    (URL_RE.test(rest) ||
      (rest.includes('/') && !/^\d+$/.test(firstSegment) && !firstSegment.includes(':')))
  if (aliased) {
    name = head
    reference = rest
  }
  if (!name) {
    const segment =
      reference
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '')
        .split('/')
        .pop() ?? ''
    name = segment.replace(/@.*$/, '').replace(/:[^:]*$/, '') || reference
  }
  return { kind: 'external', name, reference }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Copy of `obj` with `key` set, or removed when undefined/empty. Key order is preserved. */
function setOrDrop<T extends Obj>(obj: T, key: string, value: unknown): T {
  const next: Obj = { ...obj }
  if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key]
  else next[key] = value
  return next as T
}

/**
 * Rewrite every local agent reference in one agent: sub_agents, handoffs, force_handoff and
 * routing (allowed_agents/default_agent). `map` returns the new name, or undefined to drop it.
 * Returns the same object when nothing changed.
 */
function rewriteRefs(agent: AgentConfig, map: (ref: string) => string | undefined): AgentConfig {
  if (!isObj(agent)) return agent
  let next = agent
  let changed = false
  const list = (o: Obj, key: string): Obj => {
    const v = o[key]
    if (!Array.isArray(v)) return o
    const out = v.flatMap((x) => (typeof x === 'string' ? (map(x) ?? []) : [x]))
    if (out.length === v.length && out.every((x, i) => x === v[i])) return o
    changed = true
    return setOrDrop(o, key, out)
  }
  const single = (o: Obj, key: string): Obj => {
    const v = o[key]
    if (typeof v !== 'string' || map(v) === v) return o
    changed = true
    return setOrDrop(o, key, map(v))
  }
  next = list(next, 'sub_agents') as AgentConfig
  next = list(next, 'handoffs') as AgentConfig
  next = single(next, 'force_handoff') as AgentConfig
  if (isObj(next.routing)) {
    const routing = single(list(next.routing, 'allowed_agents'), 'default_agent')
    // routing requires at least one allowed agent, so drop it once none are left
    const emptied = Array.isArray(next.routing.allowed_agents) && !routing.allowed_agents
    if (routing !== next.routing) next = setOrDrop(next, 'routing', emptied ? undefined : routing)
  }
  return changed ? next : agent
}

function mapAgents(
  config: AgentFile,
  fn: (name: string, agent: AgentConfig) => [string, AgentConfig] | null,
): AgentFile {
  // fromEntries defines own properties, so an agent named `__proto__` survives
  const agents: Record<string, AgentConfig> = Object.fromEntries(
    Object.entries(config.agents ?? {}).flatMap(([k, a]) => {
      const r = fn(k, a)
      return r ? [r] : []
    }),
  )
  return { ...config, agents }
}

/**
 * Rename an agent and every local reference to it, preserving key order and unknown keys.
 * A no-op when `to` is already taken.
 */
export function renameAgent(config: AgentFile, from: string, to: string): AgentFile {
  const agents = config.agents ?? {}
  if (from === to || !Object.hasOwn(agents, from) || Object.hasOwn(agents, to)) return config
  const map = (r: string) => (r === from ? to : r)
  return mapAgents(config, (k, a) => [k === from ? to : k, rewriteRefs(a, map)])
}

/** Delete an agent and drop every local reference to it. */
export function removeAgent(config: AgentFile, name: string): AgentFile {
  const map = (r: string) => (r === name ? undefined : r)
  return mapAgents(config, (k, a) => (k === name ? null : [k, rewriteRefs(a, map)]))
}

/** Targets of one relationship kind as written (force_handoff is a single target). */
export function relationTargets(agent: unknown, kind: RelationKind): string[] {
  if (!isObj(agent)) return []
  const v = agent[RELATIONS[kind].field]
  if (kind === 'force_handoff') return typeof v === 'string' && v ? [v] : []
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function updateAgent(
  config: AgentFile,
  source: string,
  fn: (a: AgentConfig) => AgentConfig,
): AgentFile {
  const agent = config.agents?.[source]
  if (!Object.hasOwn(config.agents ?? {}, source)) return config
  return { ...config, agents: { ...config.agents, [source]: fn(isObj(agent) ? agent : {}) } }
}

/** Add a relationship. A forced handoff replaces the existing one; list entries are not duplicated. */
export function addRelation(
  config: AgentFile,
  source: string,
  kind: RelationKind,
  target: string,
): AgentFile {
  const { field } = RELATIONS[kind]
  return updateAgent(config, source, (a) => {
    if (kind === 'force_handoff') return setOrDrop(a, field, target)
    const list = Array.isArray(a[field]) ? (a[field] as unknown[]) : []
    return list.includes(target) ? a : setOrDrop(a, field, [...list, target])
  })
}

/** Remove a relationship (every matching list entry). */
export function removeRelation(
  config: AgentFile,
  source: string,
  kind: RelationKind,
  target: string,
): AgentFile {
  const { field } = RELATIONS[kind]
  return updateAgent(config, source, (a) => {
    if (kind === 'force_handoff') return a[field] === target ? setOrDrop(a, field, undefined) : a
    const list = a[field]
    if (!Array.isArray(list) || !list.includes(target)) return a
    return setOrDrop(
      a,
      field,
      list.filter((x) => x !== target),
    )
  })
}
