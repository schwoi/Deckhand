// TypeScript mirror of the parts of agent-schema.json the editor works with.
// Unknown keys are preserved via `unknown` index signatures so round-tripping YAML is lossless.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

export const TOOLSET_TYPES = [
  'think',
  'todo',
  'memory',
  'filesystem',
  'file',
  'shell',
  'background_jobs',
  'git',
  'fetch',
  'calculator',
  'datetime',
  'random',
  'environment',
  'plan',
  'tasks',
  'session_context',
  'script',
  'api',
  'openapi',
  'lsp',
  'rag',
  'mcp',
  'mcp_catalog',
  'a2a',
  'user_prompt',
  'open_url',
  'model_picker',
  'background_agents',
  'scheduler',
  'webhook',
] as const
export type ToolsetType = (typeof TOOLSET_TYPES)[number]

export const PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'amazon-bedrock',
  'dmr',
  'ollama',
  'mistral',
  'xai',
  'groq',
  'deepseek',
  'cerebras',
  'togetherai',
  'fireworks-ai',
  'huggingface',
  'moonshotai',
  'openrouter',
  'requesty',
  'nebius',
  'nvidia',
  'minimax',
  'baseten',
  'vercel',
  'cloudflare-workers-ai',
  'cloudflare-ai-gateway',
  'azure',
  'github-copilot',
  'chatgpt',
  'opencode',
] as const

export const SAFETY_MODES = ['strict', 'balanced', 'restricted', 'autonomous'] as const
export type SafetyMode = (typeof SAFETY_MODES)[number]

export interface RemoteConfig {
  url: string
  transport_type?: 'sse' | 'streamable' | 'websocket' | string
  headers?: Record<string, string>
  [k: string]: unknown
}

export interface Toolset {
  type: ToolsetType | string
  // mcp
  ref?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  remote?: RemoteConfig
  tools?: string[]
  working_dir?: string
  version?: string
  // common
  instruction?: string
  readonly?: boolean
  defer?: boolean
  toon?: boolean
  model?: string
  path?: string
  timeout?: number
  allowed_domains?: string[]
  blocked_domains?: string[]
  url?: string
  headers?: Record<string, string>
  shared?: boolean
  [k: string]: unknown
}

export interface FallbackConfig {
  models?: string[]
  retries?: number
  cooldown?: string
  [k: string]: unknown
}

export interface AgentConfig {
  model?: string
  description?: string
  instruction?: string | string[]
  instruction_file?: string | string[]
  welcome_message?: string
  toolsets?: Toolset[]
  use_toolsets?: string[]
  sub_agents?: string[]
  handoffs?: string[]
  force_handoff?: string
  fallback?: FallbackConfig
  commands?: Record<string, Json>
  safety?: SafetyMode
  readonly?: boolean
  add_date?: boolean
  add_environment_info?: boolean
  redact_secrets?: boolean
  code_mode_tools?: boolean
  max_iterations?: number
  max_consecutive_tool_calls?: number
  max_tool_result_tokens?: number
  num_history_items?: number
  session_compaction?: boolean
  compaction_threshold?: number
  compaction_model?: string
  skills?: boolean | Json[]
  [k: string]: unknown
}

export interface ModelConfig {
  provider?: string
  model?: string
  description?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  base_url?: string
  token_key?: string
  thinking_budget?: string | number
  parallel_tool_calls?: boolean
  track_usage?: boolean
  first_available?: string[]
  provider_opts?: Record<string, Json>
  [k: string]: unknown
}

export interface ProviderConfig {
  provider?: string
  api_type?: 'openai_chatcompletions' | 'openai_responses' | string
  base_url?: string
  token_key?: string
  max_tokens?: number
  temperature?: number
  thinking_budget?: string | number
  [k: string]: unknown
}

export interface Metadata {
  author?: string
  license?: string
  description?: string
  readme?: string
  version?: string
  tags?: string[]
}

export interface PermissionsConfig {
  allow?: string[]
  ask?: string[]
  deny?: string[]
}

export interface RuntimeDefaults {
  sandbox?: boolean
  network_allowlist?: string[]
  safety?: SafetyMode
}

export interface BudgetConfig {
  max_cost?: number
  max_tokens?: number
  [k: string]: unknown
}

export interface AgentFile {
  version?: string | number
  metadata?: Metadata
  agents: Record<string, AgentConfig>
  models?: Record<string, ModelConfig>
  providers?: Record<string, ProviderConfig>
  mcps?: Record<string, Omit<Toolset, 'type'>>
  toolsets?: Record<string, Toolset>
  permissions?: PermissionsConfig
  runtime?: RuntimeDefaults
  budget?: BudgetConfig
  [k: string]: unknown
}

export const CURRENT_CONFIG_VERSION = '16'
