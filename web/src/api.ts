import type {
  AgentDetail,
  AgentSummary,
  AuthInfo,
  CliVersion,
  CommandResult,
  CreateAgentRequest,
  CredentialsStatus,
  DoctorReport,
  EnvironmentInfo,
  EnvironmentInput,
  EnvironmentTest,
  LiveModels,
  ModelInfo,
  RegistryPullRequest,
  RegistryPushRequest,
  RuntimeSessionSummary,
  RuntimeStatus,
  TemplateInfo,
  ToolsetInfo,
  ValidateResponse,
} from '@shared/api'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message)
  }
}

function errorMessage(data: unknown, res: Response): string {
  if (typeof data === 'string' && data.trim()) return data.trim().slice(0, 300)
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    for (const k of ['error', 'message', 'detail'])
      if (typeof o[k] === 'string') return o[k] as string
  }
  return `${res.status} ${res.statusText || 'Request failed'}`
}

// ---- Environment scoping and auth ----
// Calls go to the selected environment: the local instance under /api, or a remote Deckhand
// under /api/env/:id (the local server proxies). Environment management and auth are always local.

const LOCAL_ENV = 'local'
let envId = LOCAL_ENV
export function setApiEnvironment(id: string): void {
  envId = id
}
const enc = encodeURIComponent
const base = (local = false) => (local || envId === LOCAL_ENV ? '/api' : `/api/env/${enc(envId)}`)

const TOKEN_KEY = 'deckhand.token'
export const authToken = {
  get: () => localStorage.getItem(TOKEN_KEY) ?? '',
  set: (t: string) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)),
}
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = authToken.get()
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra
}

/** Fired when the local server answers 401; the app asks for a token and retries. */
export const UNAUTHORIZED_EVENT = 'deckhand:unauthorized'
function unauthorized(res: Response): void {
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  local = false,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${base(local)}${path}`, {
      method,
      headers: headers(body === undefined ? {} : { 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'Cannot reach the Deckhand server')
  }
  unauthorized(res)
  const text = await res.text()
  let data: unknown
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res), data)
  return data as T
}

const get = <T>(path: string) => request<T>('GET', path)
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {})
const localReq = <T>(method: string, path: string, body?: unknown) =>
  request<T>(method, path, body, undefined, true)

// ---- Runtime (docker agent serve api) shapes, proxied verbatim ----

export interface RuntimeAgent {
  name: string
  description?: string
  multi?: boolean
  commands?: unknown
}

export interface ToolCall {
  id: string
  type?: string
  function: { name: string; arguments: string }
}

export interface RuntimeMessage {
  message_id?: string
  role: 'user' | 'assistant' | 'tool' | 'system' | string
  content?: string
  reasoning_content?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface RuntimeSession {
  id: string
  title: string
  created_at: string
  messages?: { agent_name?: string; message: RuntimeMessage }[]
  tools_approved?: boolean
  input_tokens?: number
  output_tokens?: number
  cost?: number
}

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  context_length?: number
  context_limit?: number
  cost?: number
}

interface EventBase {
  session_id?: string
  agent?: string
  agent_name?: string
}
export type StreamEvent = EventBase &
  (
    | { type: 'stream_started' }
    | { type: 'user_message'; message?: string }
    | { type: 'agent_choice'; content: string; message_id?: string }
    | { type: 'agent_choice_reasoning'; content: string }
    | { type: 'partial_tool_call' | 'tool_call' | 'tool_call_confirmation'; tool_call: ToolCall }
    | { type: 'tool_call_response'; tool_call_id: string; response?: string }
    | { type: 'token_usage'; usage: Usage }
    | { type: 'session_title'; title: string }
    | { type: 'error'; error: string; code?: string }
    | { type: 'stream_stopped'; reason?: string; finish_reason?: string }
    | { type: 'budget_exceeded' | 'budget_usage' | 'elicitation_request' }
  )

export type Confirmation =
  | 'approve'
  | 'approve-tool'
  | 'approve-balanced'
  | 'approve-autonomous'
  | 'reject'

const RT = '/runtime/proxy/api'

/** POST and consume an SSE response, calling onEvent for every `data:` JSON payload. */
async function streamSse(
  path: string,
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
) {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json', accept: 'text/event-stream' }),
    body: JSON.stringify(body),
    signal,
  })
  unauthorized(res)
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    let data: unknown = text
    try {
      data = JSON.parse(text)
    } catch {}
    throw new ApiError(res.status, errorMessage(data, res), data)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let dataLines: string[] = []
  const flush = () => {
    if (dataLines.length === 0) return
    const payload = dataLines.join('\n')
    dataLines = []
    try {
      onEvent(JSON.parse(payload) as StreamEvent)
    } catch {
      // ignore malformed frames
    }
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      if (line === '') flush()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      nl = buffer.indexOf('\n')
    }
  }
  if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart())
  flush()
}

export const api = {
  agents: {
    list: () => get<AgentSummary[]>('/agents'),
    get: (name: string) => get<AgentDetail>(`/agents/${enc(name)}`),
    create: (req: CreateAgentRequest) => post<AgentDetail>('/agents', req),
    save: (name: string, yaml: string) =>
      request<AgentDetail>('PUT', `/agents/${enc(name)}`, { yaml }),
    remove: (name: string) => request<unknown>('DELETE', `/agents/${enc(name)}`),
    duplicate: (name: string, newName: string) =>
      post<AgentDetail>(`/agents/${enc(name)}/duplicate`, { name: newName }),
    doctor: (name: string) => get<DoctorReport>(`/agents/${enc(name)}/doctor`),
  },
  templates: () => get<TemplateInfo[]>('/templates'),
  validate: (yaml: string, signal?: AbortSignal) =>
    request<ValidateResponse>('POST', '/validate', { yaml }, signal),
  registry: {
    push: (req: RegistryPushRequest) => post<CommandResult>('/registry/push', req),
    pull: (req: RegistryPullRequest) =>
      post<{ result: CommandResult; agent?: AgentDetail }>('/registry/pull', req),
  },
  system: {
    version: () => get<CliVersion>('/system/version'),
    toolsets: () => get<ToolsetInfo[]>('/system/toolsets'),
    models: (all = false) => get<ModelInfo[]>(`/system/models${all ? '?all=1' : ''}`),
    liveModels: (q: { provider: string; base_url?: string; token_key?: string }) =>
      get<LiveModels>(
        `/system/models/live?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`,
      ),
    doctor: () => get<DoctorReport>('/system/doctor'),
  },
  credentials: {
    status: () => get<CredentialsStatus>('/credentials'),
    setEnv: (name: string, value: string) =>
      request<CredentialsStatus>('PUT', `/credentials/env/${enc(name)}`, { value }),
    removeEnv: (name: string) =>
      request<CredentialsStatus>('DELETE', `/credentials/env/${enc(name)}`),
    chatgptLogin: () => post<CredentialsStatus>('/credentials/chatgpt/login'),
    chatgptComplete: (url: string) =>
      post<CredentialsStatus>('/credentials/chatgpt/complete', { url }),
    chatgptCancel: () => request<CredentialsStatus>('DELETE', '/credentials/chatgpt/login'),
    chatgptSignOut: () => request<CredentialsStatus>('DELETE', '/credentials/chatgpt'),
    copilotLogin: () => post<CredentialsStatus>('/credentials/github-copilot/login'),
    copilotCancel: () => request<CredentialsStatus>('DELETE', '/credentials/github-copilot/login'),
  },
  auth: () => localReq<AuthInfo>('GET', '/auth'),
  environments: {
    list: () => localReq<EnvironmentInfo[]>('GET', '/environments'),
    create: (input: EnvironmentInput) => localReq<EnvironmentInfo>('POST', '/environments', input),
    update: (id: string, input: Partial<EnvironmentInput>) =>
      localReq<EnvironmentInfo>('PUT', `/environments/${enc(id)}`, input),
    remove: (id: string) => localReq<unknown>('DELETE', `/environments/${enc(id)}`),
    test: (id: string) => localReq<EnvironmentTest>('GET', `/environments/${enc(id)}/test`),
    testInput: (input: { id?: string; url: string; token?: string; allowInsecure?: boolean }) =>
      localReq<EnvironmentTest>('POST', '/environments/test', input),
  },
  runtime: {
    status: () => get<RuntimeStatus>('/runtime'),
    start: () => post<RuntimeStatus>('/runtime/start'),
    stop: () => post<RuntimeStatus>('/runtime/stop'),
    restart: () => post<RuntimeStatus>('/runtime/restart'),
  },
  rt: {
    agents: () => get<RuntimeAgent[]>(`${RT}/agents`),
    sessions: () => get<RuntimeSessionSummary[]>(`${RT}/sessions`),
    session: (id: string) => get<RuntimeSession>(`${RT}/sessions/${enc(id)}`),
    createSession: (title: string) => post<RuntimeSession>(`${RT}/sessions`, { title }),
    deleteSession: (id: string) => request<unknown>('DELETE', `${RT}/sessions/${enc(id)}`),
    resume: (id: string, confirmation: Confirmation, toolName?: string) =>
      post<unknown>(`${RT}/sessions/${enc(id)}/resume`, { confirmation, tool_name: toolName }),
    toggleTools: (id: string) => post<unknown>(`${RT}/sessions/${enc(id)}/tools/toggle`),
    stream: (
      id: string,
      agent: string,
      content: string,
      onEvent: (e: StreamEvent) => void,
      signal: AbortSignal,
    ) =>
      streamSse(
        `${RT}/sessions/${enc(id)}/agent/${enc(agent)}`,
        { messages: [{ role: 'user', content }] },
        onEvent,
        signal,
      ),
  },
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
