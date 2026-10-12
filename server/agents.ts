import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { AgentDetail, AgentSummary } from '@shared/api'
import type { AgentFile } from '@shared/config'
import { AGENTS_DIR, AGENTS_DIR_PRIVATE, PRIVATE_FILE, tighten } from './paths'
import { parseYaml, validateDoc } from './validate'

export const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i
const EXTS = ['.yaml', '.yml']

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 500 | 502 | 503,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export function assertName(name: string): void {
  if (!NAME_RE.test(name)) throw new HttpError(400, `invalid agent name: ${name}`)
}

/** Existing file for `name` (.yaml preferred over .yml), or undefined. */
export function agentPath(name: string): string | undefined {
  assertName(name)
  return EXTS.map((ext) => join(AGENTS_DIR, name + ext)).find((p) => existsSync(p))
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function build(name: string, file: string, yaml: string): AgentDetail {
  const updatedAt = statSync(file).mtime.toISOString()
  const parsed = parseYaml(yaml)
  const base = { name, file, yaml, updatedAt }
  if (!parsed.ok || !isObj(parsed.doc)) {
    const issue = parsed.ok
      ? { path: '', message: 'document must be a YAML mapping' }
      : parsed.issue
    return {
      ...base,
      description: '',
      rootModel: '',
      agentCount: 0,
      toolsetCount: 0,
      tags: [],
      valid: false,
      issues: [issue],
      config: null,
    }
  }
  const doc = parsed.doc
  const issues = validateDoc(doc)
  const agents = isObj(doc.agents) ? Object.values(doc.agents).filter(isObj) : []
  const root = isObj(doc.agents) && isObj(doc.agents.root) ? doc.agents.root : undefined
  const meta = isObj(doc.metadata) ? doc.metadata : {}
  return {
    ...base,
    description: str(meta.description) || str(root?.description),
    rootModel: str(root?.model) || str(agents[0]?.model),
    agentCount: agents.length,
    toolsetCount: agents.reduce(
      (n, a) => n + (Array.isArray(a.toolsets) ? a.toolsets.length : 0),
      0,
    ),
    tags: Array.isArray(meta.tags)
      ? meta.tags.filter((t): t is string => typeof t === 'string')
      : [],
    valid: issues.length === 0,
    issues,
    // Best-effort: the document parsed as a mapping; schema issues are reported separately.
    config: doc as AgentFile,
  }
}

function toSummary({ yaml: _y, config: _c, ...summary }: AgentDetail): AgentSummary {
  return summary
}

export async function listAgents(): Promise<AgentSummary[]> {
  const byName = new Map<string, string>()
  for (const f of readdirSync(AGENTS_DIR).sort()) {
    const ext = extname(f)
    const name = f.slice(0, -ext.length)
    // .yaml sorts before .yml, so a .yaml wins on stem collisions
    if (EXTS.includes(ext) && NAME_RE.test(name) && !byName.has(name))
      byName.set(name, join(AGENTS_DIR, f))
  }
  const details = await Promise.all(
    [...byName].map(async ([name, file]) => build(name, file, await readFile(file, 'utf8'))),
  )
  return details.map(toSummary).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getAgent(name: string): Promise<AgentDetail> {
  const file = agentPath(name)
  if (!file) throw new HttpError(404, `agent not found: ${name}`)
  return build(name, file, await readFile(file, 'utf8'))
}

/** Write YAML verbatim. Rejects text that does not parse as YAML. */
export async function saveAgent(name: string, yaml: string): Promise<AgentDetail> {
  const parsed = parseYaml(yaml)
  if (!parsed.ok)
    throw new HttpError(400, `invalid YAML: ${parsed.issue.message}`, { issues: [parsed.issue] })
  const file = agentPath(name) ?? join(AGENTS_DIR, `${name}.yaml`)
  await writeFile(file, yaml, AGENTS_DIR_PRIVATE ? { mode: PRIVATE_FILE } : undefined)
  if (AGENTS_DIR_PRIVATE) tighten(file, PRIVATE_FILE) // writeFile's mode is for new files only
  return build(name, file, yaml)
}

export async function createAgent(name: string, yaml: string): Promise<AgentDetail> {
  if (agentPath(name)) throw new HttpError(409, `agent already exists: ${name}`)
  return saveAgent(name, yaml)
}

export async function deleteAgent(name: string): Promise<void> {
  const file = agentPath(name)
  if (!file) throw new HttpError(404, `agent not found: ${name}`)
  await unlink(file)
}

/** Move an external YAML file into AGENTS_DIR as <name>.yaml (overwrites). */
export async function importAgentFile(src: string, name: string): Promise<AgentDetail> {
  assertName(name)
  const existing = agentPath(name)
  if (existing?.endsWith('.yml')) await unlink(existing)
  const dest = join(AGENTS_DIR, `${name}.yaml`)
  try {
    await rename(src, dest)
  } catch {
    // cross-device move
    await writeFile(dest, await readFile(src))
    await unlink(src)
  }
  // The pulled file keeps the mode `docker agent` gave it; same policy as saveAgent.
  if (AGENTS_DIR_PRIVATE) tighten(dest, PRIVATE_FILE)
  return getAgent(name)
}
