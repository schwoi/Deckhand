import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EnvironmentInfo, EnvironmentInput, EnvironmentTest, RuntimeStatus } from '@shared/api'
import { isInsecureUrl } from '@shared/net'
import { HttpError } from './agents'
import { DECKHAND_HOME } from './paths'

/** Registry of remote Deckhand instances, persisted as JSON in the data directory. */

interface Environment {
  id: string
  name: string
  url: string
  token?: string
  allowInsecure?: boolean
}

type Transport = Pick<Environment, 'url' | 'token' | 'allowInsecure'>

/**
 * Plain http to another machine leaks the token to anyone on the path, so it needs an explicit
 * per-environment opt-in (for a VPN, a tunnel, or a network the operator trusts). Checked on
 * save, on test and on every proxied request, so stored environments are covered too.
 */
export function assertTransport(env: Transport): void {
  if (isInsecureUrl(env.url) && !env.allowInsecure)
    throw new HttpError(
      400,
      `${env.url} is plain http to another machine; use https or allow an unencrypted connection`,
    )
}

const FILE = join(DECKHAND_HOME, 'environments.json')

function load(): Environment[] {
  if (!existsSync(FILE)) return []
  try {
    const data: unknown = JSON.parse(readFileSync(FILE, 'utf8'))
    return Array.isArray(data) ? (data as Environment[]) : []
  } catch {
    return []
  }
}

let envs = load()

function persist(): void {
  writeFileSync(FILE, `${JSON.stringify(envs, null, 2)}\n`, { mode: 0o600 })
}

const toInfo = ({ token, allowInsecure, ...e }: Environment): EnvironmentInfo => ({
  ...e,
  hasToken: !!token,
  insecure: isInsecureUrl(e.url),
  allowInsecure: !!allowInsecure,
})

export function listEnvironments(): EnvironmentInfo[] {
  return envs.map(toInfo)
}

export function getEnvironment(id: string): Environment {
  const env = envs.find((e) => e.id === id)
  if (!env) throw new HttpError(404, `environment not found: ${id}`)
  return env
}

function normalizeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new HttpError(400, 'url must be an absolute http(s) URL')
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new HttpError(400, 'url must use http or https')
  return url.toString().replace(/\/+$/, '')
}

export function addEnvironment(input: EnvironmentInput): EnvironmentInfo {
  const name = input.name.trim()
  if (!name) throw new HttpError(400, 'name is required')
  const env: Environment = {
    id: crypto.randomUUID().slice(0, 8),
    name,
    url: normalizeUrl(input.url),
    token: input.token || undefined,
    allowInsecure: input.allowInsecure || undefined,
  }
  assertTransport(env)
  envs = [...envs, env]
  persist()
  return toInfo(env)
}

export function updateEnvironment(id: string, input: Partial<EnvironmentInput>): EnvironmentInfo {
  const prev = getEnvironment(id)
  const next: Environment = {
    ...prev,
    name: input.name === undefined ? prev.name : input.name.trim() || prev.name,
    url: input.url === undefined ? prev.url : normalizeUrl(input.url),
    token: input.token === undefined ? prev.token : input.token || undefined,
    allowInsecure:
      (input.allowInsecure === undefined ? prev.allowInsecure : input.allowInsecure) || undefined,
  }
  assertTransport(next)
  envs = envs.map((e) => (e.id === id ? next : e))
  persist()
  return toInfo(next)
}

export function removeEnvironment(id: string): void {
  getEnvironment(id)
  envs = envs.filter((e) => e.id !== id)
  persist()
}

export function authHeaders(env: Pick<Environment, 'token'>): Record<string, string> {
  return env.token ? { authorization: `Bearer ${env.token}` } : {}
}

/** Reach the remote and report its CLI version and runtime state. */
export async function testEnvironment(env: Transport): Promise<EnvironmentTest> {
  assertTransport(env)
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${env.url}/api${path}`, {
      headers: authHeaders(env),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 401) throw new Error('the environment rejected the token')
    if (!res.ok) throw new Error(`${path} returned ${res.status}`)
    return (await res.json()) as T
  }
  try {
    const [version, runtime] = await Promise.all([
      get<{ installed: boolean; version?: string }>('/system/version'),
      get<RuntimeStatus>('/runtime'),
    ])
    return { ok: true, version: version.version, runtime: runtime.state }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg.includes('fetch failed') ? `cannot reach ${env.url}` : msg }
  }
}
