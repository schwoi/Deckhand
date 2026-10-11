import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeState, RuntimeStatus } from '@shared/api'
import type { Subprocess } from 'bun'
import { CLI_CMD, CLI_ENV } from './cli'
import { AGENTS_DIR, RUNTIME_LISTEN, SESSION_DB, STUDIO_HOME } from './paths'

const LOG_LINES = 200
const PING_TIMEOUT_MS = 15_000
const STOP_GRACE_MS = 5_000

type Child = Subprocess<'ignore', 'pipe', 'pipe'>

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Supervises a single `docker agent serve api` child process. */
class Runtime {
  readonly url = `http://${RUNTIME_LISTEN}`
  private state: RuntimeState = 'stopped'
  private child?: Child
  private startedAt?: string
  private error?: string
  private logTail: string[] = []
  private lastStderr = ''
  private stopRequested = false
  private pending?: Promise<RuntimeStatus>
  private debounce?: Timer

  status(): RuntimeStatus {
    return {
      state: this.state,
      pid: this.child?.pid,
      listen: RUNTIME_LISTEN,
      agentsDir: AGENTS_DIR,
      startedAt: this.startedAt,
      error: this.error,
      logTail: [...this.logTail],
    }
  }

  isRunning(): boolean {
    return this.state === 'running'
  }

  /** Resolves once the runtime answers /api/ping (state 'running') or fails (state 'error'). */
  start(): Promise<RuntimeStatus> {
    if (this.pending) return this.pending
    if (this.state === 'running') return Promise.resolve(this.status())
    this.pending = this.launch().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  async stop(): Promise<RuntimeStatus> {
    clearTimeout(this.debounce)
    // Mark intent first so a startup in progress is cancelled instead of awaited.
    this.stopRequested = true
    const child = this.child
    if (child) {
      child.kill('SIGTERM')
      const exited = await Promise.race([
        child.exited.then(() => true),
        sleep(STOP_GRACE_MS).then(() => false),
      ])
      if (!exited) {
        child.kill('SIGKILL')
        await child.exited
      }
      if (this.child === child) this.child = undefined
    }
    await this.pending?.catch(() => undefined)
    this.state = 'stopped'
    this.startedAt = undefined
    this.error = undefined
    return this.status()
  }

  async restart(): Promise<RuntimeStatus> {
    await this.stop()
    return this.start()
  }

  /** `serve api` reads the agents dir at start, so restart (debounced) after file changes. */
  restartIfRunning(): void {
    clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      if (this.state === 'running' || this.state === 'starting') {
        this.log('[studio] agents changed, restarting runtime')
        this.restart().catch((e: unknown) => {
          this.state = 'error'
          this.error = `restart failed: ${e instanceof Error ? e.message : String(e)}`
          this.log(`[studio] ${this.error}`)
        })
      }
    }, 500)
  }

  /** Best-effort kill for process shutdown (sync; used by the 'exit' hook). */
  kill(): void {
    this.stopRequested = true
    this.child?.kill('SIGKILL')
  }

  private async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/api/ping`, { signal: AbortSignal.timeout(1000) })
      return res.ok
    } catch {
      return false
    }
  }

  private log(line: string): void {
    this.logTail.push(line)
    if (this.logTail.length > LOG_LINES) this.logTail.splice(0, this.logTail.length - LOG_LINES)
  }

  private async pump(stream: ReadableStream<Uint8Array>, isErr: boolean): Promise<void> {
    const decoder = new TextDecoder()
    let buf = ''
    const emit = (line: string) => {
      if (!line) return
      this.log(line)
      if (isErr) this.lastStderr = line
    }
    for await (const chunk of stream) {
      buf += decoder.decode(chunk, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) emit(l.trimEnd())
    }
    emit(buf.trimEnd())
  }

  private async launch(): Promise<RuntimeStatus> {
    this.state = 'starting'
    this.error = undefined
    this.startedAt = undefined
    this.stopRequested = false
    this.lastStderr = ''
    const args = [
      ...CLI_CMD,
      'serve',
      'api',
      AGENTS_DIR,
      '--listen',
      RUNTIME_LISTEN,
      '--session-db',
      SESSION_DB,
    ]
    if (await this.ping()) {
      this.state = 'error'
      this.error = `something else is already listening on ${RUNTIME_LISTEN}`
      this.log(`[studio] ${this.error}`)
      return this.status()
    }
    this.log(`[studio] $ ${args.join(' ')}`)
    let child: Child
    try {
      child = Bun.spawn(args, {
        cwd: STUDIO_HOME,
        env: CLI_ENV,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
    } catch (e) {
      this.state = 'error'
      this.error = e instanceof Error ? e.message : String(e)
      this.log(`[studio] spawn failed: ${this.error}`)
      return this.status()
    }
    this.child = child
    writePidFile(child.pid)
    const output = Promise.all([this.pump(child.stdout, false), this.pump(child.stderr, true)])
    void child.exited.then(async (code) => {
      await output.catch(() => undefined)
      clearPidFile(child.pid)
      if (this.child !== child) return
      this.child = undefined
      this.startedAt = undefined
      this.log(`[studio] runtime exited with code ${code}`)
      if (this.stopRequested) {
        this.state = 'stopped'
      } else {
        this.state = 'error'
        this.error = `runtime exited with code ${code}${this.lastStderr ? `: ${this.lastStderr}` : ''}`
      }
    })

    const deadline = Date.now() + PING_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.child !== child || this.stopRequested) return this.status() // exited or cancelled
      if ((await this.ping()) && this.child === child) {
        this.state = 'running'
        this.startedAt = new Date().toISOString()
        return this.status()
      }
      await sleep(250)
    }
    this.child = undefined
    child.kill('SIGKILL')
    await child.exited
    this.state = 'error'
    this.error = 'timed out waiting for /api/ping'
    return this.status()
  }
}

// --- stale runtime cleanup -------------------------------------------------
// A dev-server reload or a crash can leave a previous child running and holding the port.
// Record the child's pid and, on boot, terminate a leftover that is still a `serve api`.

const PID_FILE = join(STUDIO_HOME, 'runtime.pid')

function writePidFile(pid: number): void {
  try {
    writeFileSync(PID_FILE, String(pid))
  } catch {}
}

function clearPidFile(pid: number): void {
  try {
    if (existsSync(PID_FILE) && readFileSync(PID_FILE, 'utf8').trim() === String(pid))
      unlinkSync(PID_FILE)
  } catch {}
}

function isServeApi(pid: number): boolean {
  try {
    // Linux: confirm the pid was not recycled by an unrelated process.
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ')
    return cmdline.includes('serve api')
  } catch {
    return process.platform !== 'linux' // no /proc: trust the pid file
  }
}

function reapStaleRuntime(): void {
  if (!existsSync(PID_FILE)) return
  const pid = Number(readFileSync(PID_FILE, 'utf8').trim())
  try {
    unlinkSync(PID_FILE)
  } catch {}
  if (!Number.isInteger(pid) || pid <= 1) return
  try {
    process.kill(pid, 0) // throws if not alive
  } catch {
    return
  }
  if (!isServeApi(pid)) return
  console.warn(`[studio] terminating stale runtime pid ${pid} left by a previous run`)
  try {
    process.kill(pid, 'SIGTERM')
  } catch {}
}

reapStaleRuntime()

export const runtime = new Runtime()

process.on('exit', () => runtime.kill())
let shuttingDown = false
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (shuttingDown) return
    shuttingDown = true
    // Graceful stop (SIGTERM, then SIGKILL after STOP_GRACE_MS) with a hard exit fallback.
    setTimeout(() => process.exit(1), STOP_GRACE_MS + 1000).unref()
    runtime.stop().finally(() => process.exit(0))
  })
}
