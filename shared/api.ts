// HTTP contract between web/ and server/. All routes are mounted under /api.
import type { AgentFile } from './config'

export interface ValidationIssue {
  path: string // JSON pointer-ish, e.g. "agents.root.model"
  message: string
}

export interface AgentSummary {
  name: string // file stem, used as the id everywhere (and as the runtime agent id)
  file: string // absolute path
  description: string
  rootModel: string
  agentCount: number
  toolsetCount: number
  tags: string[]
  updatedAt: string // ISO
  valid: boolean
  issues: ValidationIssue[]
}

export interface AgentDetail extends AgentSummary {
  yaml: string
  config: AgentFile | null // null when the YAML does not parse
}

export interface SaveAgentRequest {
  yaml: string
}

export interface CreateAgentRequest {
  name: string
  template: string // id from GET /api/templates
}

export interface TemplateInfo {
  id: string
  title: string
  description: string
  yaml: string
}

export interface ValidateRequest {
  yaml: string
}
export interface ValidateResponse {
  valid: boolean
  issues: ValidationIssue[]
}

// --- docker agent CLI wrappers ---

export interface CliVersion {
  installed: boolean
  version?: string
  error?: string
}

export interface ToolsetInfo {
  type: string
  summary: string
  docs: string
}

export interface ModelInfo {
  provider: string
  model: string
  default?: boolean
}

export interface DoctorProvider {
  provider: string
  env_vars: string[]
  found: boolean
  source?: string
}

export interface DoctorReport {
  user_config?: { path: string; status: string }
  providers: DoctorProvider[]
  dmr?: { status: string; models?: string[] }
  auto_model?: { provider: string; model: string; usable: boolean }
  // present when run against an agent file
  env_vars?: { name: string; found: boolean; source?: string }[]
  issues: string[]
  [k: string]: unknown
}

// --- managed runtime (docker agent serve api child process) ---

export type RuntimeState = 'stopped' | 'starting' | 'running' | 'error'

export interface RuntimeStatus {
  state: RuntimeState
  pid?: number
  listen: string
  agentsDir: string
  startedAt?: string
  error?: string
  logTail: string[]
}

// Runtime API (docker agent serve api) is proxied verbatim under /api/runtime/proxy/*,
// e.g. GET /api/runtime/proxy/api/agents, POST /api/runtime/proxy/api/sessions, and the SSE
// stream POST /api/runtime/proxy/api/sessions/:id/agent/:agent.

export interface RuntimeSessionSummary {
  id: string
  title: string
  created_at: string
  num_messages: number
  input_tokens: number
  output_tokens: number
  cost?: number
}

export interface RegistryPushRequest {
  name: string
  ref: string // e.g. docker.io/user/agent:tag
}
export interface RegistryPullRequest {
  ref: string
  name?: string // local file stem; defaults to the last path segment of ref
  force?: boolean
}
export interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number
}
export interface RegistryPullResponse {
  result: CommandResult
  agent?: AgentDetail // present when the pull produced a YAML file
}
export interface DuplicateAgentRequest {
  name: string
}

// --- environments (other Deckhand instances this one can drive) ---

export interface EnvironmentInfo {
  id: string
  name: string
  url: string // base URL of the remote Deckhand, e.g. http://build-box:4800
  hasToken: boolean
}
export interface EnvironmentInput {
  name: string
  url: string
  token?: string // omitted on update = keep the stored token; '' = clear it
}
export interface EnvironmentTest {
  ok: boolean
  version?: string // docker agent CLI version on the remote
  runtime?: RuntimeState
  error?: string
}
// Everything under /api/* of a remote environment is reachable at /api/env/:id/*; the local
// instance is addressed directly under /api/*. When DECKHAND_TOKEN is set, requests need
// `Authorization: Bearer <token>`; GET /api/auth reports whether that is the case.
export interface AuthInfo {
  required: boolean
}
