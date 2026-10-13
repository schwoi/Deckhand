// The agent form edits well-formed values only. Schema-invalid drafts (a string where a list
// belongs, say) are shown as "fix in YAML" instead of being fed to controls that would crash or
// silently replace them.

import type { AgentConfig } from '@shared/config'

type Check = (v: unknown) => boolean
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str: Check = (v) => typeof v === 'string'
const num: Check = (v) => typeof v === 'number'
const strList: Check = (v) => Array.isArray(v) && v.every(str)
const strRecord: Check = (v) => isObj(v) && Object.values(v).every(str)
const optional =
  (check: Check): Check =>
  (v) =>
    v === undefined || v === null || check(v)

const TOOLSET_FIELDS: Record<string, Check> = {
  type: str,
  ref: optional(str),
  command: optional(str),
  url: optional(str),
  path: optional(str),
  instruction: optional(str),
  timeout: optional(num),
  args: optional(strList),
  tools: optional(strList),
  allowed_domains: optional(strList),
  blocked_domains: optional(strList),
  file_types: optional(strList),
  allow_list: optional(strList),
  deny_list: optional(strList),
  env: optional(strRecord),
  headers: optional(strRecord),
  remote: optional((v) => isObj(v) && optional(str)(v.url) && optional(strRecord)(v.headers)),
}
const toolset: Check = (v) =>
  isObj(v) && Object.entries(TOOLSET_FIELDS).every(([k, check]) => check(v[k]))

/** Fields the agent form renders, and the shape each control can handle. */
const AGENT_FIELDS: Record<string, Check> = {
  model: str,
  description: str,
  welcome_message: str,
  force_handoff: str,
  safety: str,
  instruction: (v) => str(v) || strList(v),
  sub_agents: strList,
  handoffs: strList,
  toolsets: (v) => Array.isArray(v) && v.every(toolset),
  // a list is valid YAML too; the form says so and leaves it alone
  commands: (v) =>
    Array.isArray(v) || (isObj(v) && Object.values(v).every((c) => str(c) || isObj(c))),
  max_iterations: num,
  max_consecutive_tool_calls: num,
  num_history_items: num,
  compaction_threshold: num,
}

export interface AgentFormView {
  /** the agent with unusable fields removed; never written back as a whole */
  agent: AgentConfig
  /** fields present with a shape the form cannot edit */
  invalid: Set<string>
  /** the agent itself is not a mapping (null counts as an empty agent) */
  malformed: boolean
}

export function agentFormView(raw: unknown): AgentFormView {
  if (raw === null || raw === undefined) return { agent: {}, invalid: new Set(), malformed: false }
  if (!isObj(raw)) return { agent: {}, invalid: new Set(), malformed: true }
  const invalid = new Set<string>()
  const agent: AgentConfig = { ...raw }
  for (const [k, check] of Object.entries(AGENT_FIELDS))
    if (raw[k] !== undefined && raw[k] !== null && !check(raw[k])) {
      invalid.add(k)
      delete agent[k]
    }
  return { agent, invalid, malformed: false }
}
