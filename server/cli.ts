import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CommandResult } from '@shared/api'

export const CLI_ENV = { ...process.env, DOCKER_AGENT_HIDE_TELEMETRY_BANNER: '1' }

const PLUGIN_CANDIDATES = [
  process.env.DOCKER_AGENT_BIN,
  join(homedir(), '.docker/cli-plugins/docker-agent'),
  '/usr/local/lib/docker/cli-plugins/docker-agent',
  '/usr/lib/docker/cli-plugins/docker-agent',
  '/usr/libexec/docker/cli-plugins/docker-agent',
  '/Applications/Docker.app/Contents/Resources/cli-plugins/docker-agent',
  Bun.which('docker-agent'),
].filter((p): p is string => !!p)

/**
 * Command prefix for the docker-agent CLI. The plugin binary is preferred over `docker agent`:
 * the docker CLI wrapper runs the plugin as a grandchild and ignores an early SIGTERM, which
 * leaves the real server orphaned when the wrapper is killed. Run standalone, the plugin takes
 * the same subcommands minus the leading `agent`.
 */
export const CLI_CMD: string[] = (() => {
  const bin = PLUGIN_CANDIDATES.find((p) => existsSync(p))
  return bin ? [bin] : ['docker', 'agent']
})()

export interface RunOptions {
  timeoutMs?: number
  cwd?: string
}

/** Run `docker agent <args>`; never throws (spawn failures become exitCode -1). */
export async function runCli(
  args: string[],
  { timeoutMs = 30_000, cwd }: RunOptions = {},
): Promise<CommandResult> {
  try {
    const proc = Bun.spawn([...CLI_CMD, ...args], {
      cwd,
      env: CLI_ENV,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs)
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    clearTimeout(timer)
    const timedOut = proc.signalCode === 'SIGKILL'
    return {
      ok: exitCode === 0,
      stdout,
      stderr: timedOut ? `${stderr}\ntimed out after ${timeoutMs}ms` : stderr,
      exitCode,
    }
  } catch (e) {
    return {
      ok: false,
      stdout: '',
      stderr: e instanceof Error ? e.message : String(e),
      exitCode: -1,
    }
  }
}

/** Memoize an async producer per key for ttlMs. Failed promises are not cached. */
export function ttlCache<T>(ttlMs: number) {
  const entries = new Map<string, { at: number; value: Promise<T> }>()
  const cached = (key: string, produce: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key)
    if (hit && Date.now() - hit.at < ttlMs) return hit.value
    const value = produce()
    entries.set(key, { at: Date.now(), value })
    value.catch(() => entries.delete(key))
    return value
  }
  return Object.assign(cached, { clear: () => entries.clear() })
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly result?: CommandResult,
  ) {
    super(message)
  }
}

function lastLine(s: string): string {
  return s.trim().split('\n').at(-1) ?? ''
}

/** Run a command whose stdout must be JSON; throws CliError on failure. */
export async function runJson<T>(args: string[], { allowNonZero = false } = {}): Promise<T> {
  const r = await runCli(args)
  if (!r.ok && !allowNonZero)
    throw new CliError(lastLine(r.stderr) || `docker agent exited with ${r.exitCode}`, r)
  try {
    return JSON.parse(r.stdout) as T
  } catch {
    throw new CliError(lastLine(r.stderr) || 'docker agent did not return JSON', r)
  }
}
