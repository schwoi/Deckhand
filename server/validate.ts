import type { ValidateResponse, ValidationIssue } from '@shared/api'
import type { ErrorObject } from 'ajv'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import Ajv2020 from 'ajv/dist/2020'
import { parse } from 'yaml'
import schema from '../shared/agent-schema.json'

const opts = { strict: false, allErrors: true, allowUnionTypes: true }
const ajv = String(schema.$schema).includes('2020-12') ? new Ajv2020(opts) : new Ajv(opts)
addFormats(ajv)
const validateSchema = ajv.compile(schema)

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const keys = (v: unknown): Set<string> => new Set(isObj(v) ? Object.keys(v) : [])

function schemaIssue(e: ErrorObject): ValidationIssue {
  const extra =
    typeof e.params.additionalProperty === 'string' ? `: ${e.params.additionalProperty}` : ''
  return {
    path: e.instancePath.replace(/^\//, '').replaceAll('/', '.'),
    message: `${e.message ?? 'invalid'}${extra}`,
  }
}

function semanticIssues(doc: Obj): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const agents = isObj(doc.agents) ? doc.agents : {}
  const agentNames = Object.keys(agents)
  if (agentNames.length === 0)
    issues.push({ path: 'agents', message: 'at least one agent must be defined' })
  const models = keys(doc.models)
  const mcps = keys(doc.mcps)
  const toolsets = keys(doc.toolsets)
  const commands = keys(doc.commands)
  const skills = keys(doc.skills)

  for (const [name, agent] of Object.entries(agents)) {
    if (!isObj(agent)) continue
    const base = `agents.${name}`
    for (const field of ['sub_agents', 'handoffs'] as const) {
      strings(agent[field]).forEach((ref, i) => {
        if (!ref.includes('/') && !ref.includes(':') && !(ref in agents))
          issues.push({ path: `${base}.${field}.${i}`, message: `unknown agent: ${ref}` })
      })
    }
    // Docker Agent refuses to load these; force_handoff cycles are reported below.
    const forced = agent.force_handoff
    if (typeof forced === 'string' && !forced.includes('/') && !forced.includes(':')) {
      if (forced === name)
        issues.push({ path: `${base}.force_handoff`, message: 'cannot force_handoff to itself' })
      else if (!Object.hasOwn(agents, forced))
        issues.push({ path: `${base}.force_handoff`, message: `unknown agent: ${forced}` })
    }
    const model = agent.model
    if (typeof model === 'string') {
      // comma-separated lists are allowed (alloy models); each entry must resolve
      for (const m of model
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (!m.includes('/') && !models.has(m))
          issues.push({ path: `${base}.model`, message: `unknown model: ${m}` })
      }
    }
    if (Array.isArray(agent.toolsets)) {
      agent.toolsets.forEach((ts, i) => {
        if (
          isObj(ts) &&
          ts.type === 'mcp' &&
          typeof ts.ref === 'string' &&
          !ts.ref.startsWith('docker:') &&
          !mcps.has(ts.ref)
        )
          issues.push({ path: `${base}.toolsets.${i}.ref`, message: `unknown mcp: ${ts.ref}` })
      })
    }
    const refs: [string, Set<string>, string][] = [
      ['use_toolsets', toolsets, 'toolset'],
      ['use_commands', commands, 'command'],
      ['use_skills', skills, 'skill'],
    ]
    for (const [field, defined, label] of refs) {
      strings(agent[field]).forEach((ref, i) => {
        if (!defined.has(ref))
          issues.push({ path: `${base}.${field}.${i}`, message: `unknown ${label}: ${ref}` })
      })
    }
  }
  const forcedTo = (n: string) => {
    const a = agents[n]
    return isObj(a) && typeof a.force_handoff === 'string' ? a.force_handoff : undefined
  }
  for (const name of agentNames) {
    const seen = new Set([name])
    for (let n = forcedTo(name); n && n !== name && Object.hasOwn(agents, n); n = forcedTo(n)) {
      if (seen.has(n)) break
      seen.add(n)
      if (forcedTo(n) === name) {
        issues.push({ path: `agents.${name}.force_handoff`, message: 'force_handoff cycle' })
        break
      }
    }
  }
  return issues
}

/** Validate an already-parsed document against the JSON schema plus Docker Agent's semantic rules. */
export function validateDoc(doc: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  // Docker Agent decodes YAML scalars into string fields, so `version: 16` is valid.
  const subject =
    isObj(doc) && typeof doc.version === 'number' ? { ...doc, version: String(doc.version) } : doc
  if (!validateSchema(subject)) issues.push(...(validateSchema.errors ?? []).map(schemaIssue))
  if (isObj(doc)) issues.push(...semanticIssues(doc))
  const seen = new Set<string>()
  return issues.filter((i) => {
    const k = `${i.path}\0${i.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export type ParseResult = { ok: true; doc: unknown } | { ok: false; issue: ValidationIssue }

export function parseYaml(yaml: string): ParseResult {
  try {
    return { ok: true, doc: parse(yaml) }
  } catch (e) {
    return { ok: false, issue: { path: '', message: e instanceof Error ? e.message : String(e) } }
  }
}

export function validateYaml(yaml: string): ValidateResponse {
  const parsed = parseYaml(yaml)
  const issues = parsed.ok ? validateDoc(parsed.doc) : [parsed.issue]
  return { valid: issues.length === 0, issues }
}
