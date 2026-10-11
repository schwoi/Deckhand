import type { SafetyMode } from '@shared/config'

export interface ToolsetMeta {
  type: string
  label: string
  description: string
}

export const TOOLSET_GROUPS: { title: string; items: ToolsetMeta[] }[] = [
  {
    title: 'Reasoning & planning',
    items: [
      { type: 'think', label: 'Think', description: 'Scratchpad for step-by-step reasoning.' },
      { type: 'todo', label: 'Todo', description: 'Track a task list during a session.' },
      { type: 'plan', label: 'Plan', description: 'Draft and maintain a plan before acting.' },
      { type: 'tasks', label: 'Tasks', description: 'Persistent task list stored on disk.' },
      {
        type: 'memory',
        label: 'Memory',
        description: 'Long-term memory backed by a local database.',
      },
      {
        type: 'session_context',
        label: 'Session context',
        description: 'Read details about the current session.',
      },
    ],
  },
  {
    title: 'Files & code',
    items: [
      {
        type: 'filesystem',
        label: 'Filesystem',
        description: 'Read, write, search and edit files.',
      },
      { type: 'file', label: 'File', description: 'Lightweight single-file read/write tools.' },
      {
        type: 'shell',
        label: 'Shell',
        description: 'Run shell commands in the working directory.',
      },
      {
        type: 'background_jobs',
        label: 'Background jobs',
        description: 'Start and monitor long-running commands.',
      },
      { type: 'git', label: 'Git', description: 'Inspect and operate on git repositories.' },
      { type: 'lsp', label: 'LSP', description: 'Language-server powered code intelligence.' },
      { type: 'script', label: 'Script', description: 'Expose your own shell scripts as tools.' },
    ],
  },
  {
    title: 'Web & APIs',
    items: [
      { type: 'fetch', label: 'Fetch', description: 'Fetch URLs and read web pages.' },
      { type: 'api', label: 'API', description: 'Call a single HTTP endpoint as a tool.' },
      { type: 'openapi', label: 'OpenAPI', description: 'Generate tools from an OpenAPI spec.' },
      { type: 'open_url', label: 'Open URL', description: "Open a URL in the user's browser." },
      { type: 'webhook', label: 'Webhook', description: 'Send events to an HTTP webhook.' },
      { type: 'rag', label: 'RAG', description: 'Retrieval over indexed documents.' },
    ],
  },
  {
    title: 'MCP & agents',
    items: [
      {
        type: 'mcp',
        label: 'MCP server',
        description: 'Docker MCP Catalog, local stdio or remote server.',
      },
      {
        type: 'mcp_catalog',
        label: 'MCP catalog',
        description: 'Let the agent discover and enable catalog servers.',
      },
      { type: 'a2a', label: 'A2A', description: 'Talk to a remote agent over the A2A protocol.' },
      {
        type: 'background_agents',
        label: 'Background agents',
        description: 'Run sub-agents asynchronously.',
      },
      {
        type: 'model_picker',
        label: 'Model picker',
        description: 'Let the agent switch between allowed models.',
      },
    ],
  },
  {
    title: 'Utilities',
    items: [
      {
        type: 'user_prompt',
        label: 'User prompt',
        description: 'Ask the user a question mid-task.',
      },
      { type: 'calculator', label: 'Calculator', description: 'Evaluate arithmetic expressions.' },
      { type: 'datetime', label: 'Date & time', description: 'Current date, time and time zones.' },
      { type: 'random', label: 'Random', description: 'Random numbers and choices.' },
      { type: 'environment', label: 'Environment', description: 'Read environment information.' },
      { type: 'scheduler', label: 'Scheduler', description: 'Schedule follow-up work.' },
    ],
  },
]

export const TOOLSET_META: Record<string, ToolsetMeta> = Object.fromEntries(
  TOOLSET_GROUPS.flatMap((g) => g.items).map((m) => [m.type, m]),
)

export const SAFETY_INFO: Record<SafetyMode, string> = {
  strict: 'Ask before every tool call that is not explicitly allowed.',
  balanced: 'Auto-approve safe, read-only calls; ask for everything else.',
  restricted: 'Fail-closed for unattended runs: safe calls auto-approve, the rest are denied.',
  autonomous: 'Auto-approve every tool call. Only for configs you fully trust.',
}

export const SECTIONS = [
  { id: 'agents', label: 'Agents' },
  { id: 'models', label: 'Models' },
  { id: 'mcps', label: 'MCP servers' },
  { id: 'permissions', label: 'Permissions & runtime' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'yaml', label: 'YAML' },
] as const
export type SectionId = (typeof SECTIONS)[number]['id']

/** Which editor section a validation issue path belongs to. */
export function sectionForPath(path: string): SectionId {
  const head = path.split('.')[0] ?? ''
  if (head === 'agents') return 'agents'
  if (head === 'models' || head === 'providers') return 'models'
  if (head === 'mcps') return 'mcps'
  if (head === 'permissions' || head === 'runtime' || head === 'budget') return 'permissions'
  if (head === 'metadata' || head === 'version') return 'metadata'
  return 'yaml'
}
