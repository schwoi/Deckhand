import type { RuntimeState, RuntimeStatus } from '@shared/api'
import type { Subprocess } from 'bun'
import { CLI_ENV } from './cli'
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
    await this.pending?.catch(() => undefined)
    const child = this.child
    if (child) {
      this.stopRequested = true
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
        void this.restart()
      }
    }, 500)
  }

  /** Synchronous best-effort kill for process shutdown. */
  kill(): void {
    this.stopRequested = true
    this.child?.kill('SIGTERM')
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
      'docker',
      'agent',
      'serve',
      'api',
      AGENTS_DIR,
      '--listen',
      RUNTIME_LISTEN,
      '--session-db',
      SESSION_DB,
    ]
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
    const output = Promise.all([this.pump(child.stdout, false), this.pump(child.stderr, true)])
    void child.exited.then(async (code) => {
      await output.catch(() => undefined)
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
      if (this.child !== child) return this.status() // exited during startup
      try {
        const res = await fetch(`${this.url}/api/ping`, { signal: AbortSignal.timeout(1000) })
        if (res.ok && this.child === child) {
          this.state = 'running'
          this.startedAt = new Date().toISOString()
          return this.status()
        }
      } catch {
        // not listening yet
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

export const runtime = new Runtime()

process.on('exit', () => runtime.kill())
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    runtime.kill()
    process.exit(0)
  })
}
