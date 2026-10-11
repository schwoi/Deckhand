import { readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import type {
  CliVersion,
  CommandResult,
  DoctorReport,
  ModelInfo,
  TemplateInfo,
  ToolsetInfo,
} from '@shared/api'
import { TEMPLATES } from '@shared/templates'
import { type Context, Hono } from 'hono'
import {
  HttpError,
  NAME_RE,
  agentPath,
  assertName,
  createAgent,
  deleteAgent,
  getAgent,
  importAgentFile,
  listAgents,
  saveAgent,
} from './agents'
import { CliError, runCli, runJson, ttlCache } from './cli'
import { AGENTS_DIR, initPaths } from './paths'
import { runtime } from './runtime'
import { validateYaml } from './validate'

initPaths()

const app = new Hono()

app.use(async (c, next) => {
  const t0 = performance.now()
  await next()
  console.log(
    `${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - t0)}ms`,
  )
})

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, ...err.extra }, err.status)
  if (err instanceof CliError) return c.json({ error: err.message, result: err.result }, 502)
  console.error(err)
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
})

// --- request body helpers ---

type Body = Record<string, unknown>

async function body(c: Context): Promise<Body> {
  let data: unknown
  try {
    data = await c.req.json()
  } catch {
    throw new HttpError(400, 'request body must be JSON')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new HttpError(400, 'request body must be a JSON object')
  return data as Body
}

function str(b: Body, key: string, optional: true): string | undefined
function str(b: Body, key: string, optional?: false): string
function str(b: Body, key: string, optional = false): string | undefined {
  const v = b[key]
  if (v === undefined && optional) return undefined
  if (typeof v !== 'string') throw new HttpError(400, `"${key}" must be a string`)
  return v
}

// --- agents ---

app.get('/api/agents', async (c) => c.json(await listAgents()))
app.get('/api/agents/:name', async (c) => c.json(await getAgent(c.req.param('name'))))

app.put('/api/agents/:name', async (c) => {
  const name = c.req.param('name')
  assertName(name)
  const agent = await saveAgent(name, str(await body(c), 'yaml'))
  runtime.restartIfRunning()
  return c.json(agent)
})

app.post('/api/agents', async (c) => {
  const b = await body(c)
  const name = str(b, 'name')
  const templateId = str(b, 'template')
  assertName(name)
  const template = TEMPLATES.find((t) => t.id === templateId)
  if (!template) throw new HttpError(400, `unknown template: ${templateId}`)
  const agent = await createAgent(name, template.yaml)
  runtime.restartIfRunning()
  return c.json(agent, 201)
})

app.post('/api/agents/:name/duplicate', async (c) => {
  const source = await getAgent(c.req.param('name'))
  const name = str(await body(c), 'name')
  assertName(name)
  const agent = await createAgent(name, source.yaml)
  runtime.restartIfRunning()
  return c.json(agent, 201)
})

app.delete('/api/agents/:name', async (c) => {
  await deleteAgent(c.req.param('name'))
  runtime.restartIfRunning()
  return c.body(null, 204)
})

app.get('/api/agents/:name/doctor', async (c) => {
  const file = agentPath(c.req.param('name'))
  if (!file) throw new HttpError(404, `agent not found: ${c.req.param('name')}`)
  return c.json(await runJson<DoctorReport>(['doctor', file, '--json'], { allowNonZero: true }))
})

app.get('/api/templates', (c) => c.json(TEMPLATES satisfies TemplateInfo[]))

app.post('/api/validate', async (c) => c.json(validateYaml(str(await body(c), 'yaml'))))

// --- docker agent CLI ---

const toolsetsCache = ttlCache<ToolsetInfo[]>(10 * 60_000)
const modelsCache = ttlCache<ModelInfo[]>(60_000)

app.get('/api/system/version', async (c) => {
  const r = await runCli(['version'], { timeoutMs: 10_000 })
  if (!r.ok) {
    const error = r.stderr.trim() || `docker agent exited with ${r.exitCode}`
    return c.json({ installed: false, error } satisfies CliVersion)
  }
  const version = /version\s+(v?\d[\w.+-]*)/.exec(r.stdout)?.[1]
  return c.json({ installed: true, version } satisfies CliVersion)
})

app.get('/api/system/toolsets', async (c) =>
  c.json(
    await toolsetsCache('all', () => runJson<ToolsetInfo[]>(['toolsets', '--format', 'json'])),
  ),
)

app.get('/api/system/models', async (c) => {
  const all = ['1', 'true'].includes(c.req.query('all') ?? '')
  const args = ['models', '--format', 'json', ...(all ? ['--all'] : [])]
  return c.json(await modelsCache(all ? 'all' : 'default', () => runJson<ModelInfo[]>(args)))
})

app.get('/api/system/doctor', async (c) =>
  c.json(await runJson<DoctorReport>(['doctor', '--json'], { allowNonZero: true })),
)

// --- registry ---

app.post('/api/registry/push', async (c) => {
  const b = await body(c)
  const name = str(b, 'name')
  const file = agentPath(name)
  if (!file) throw new HttpError(404, `agent not found: ${name}`)
  return c.json(
    (await runCli(['share', 'push', file, str(b, 'ref')], {
      timeoutMs: 120_000,
    })) satisfies CommandResult,
  )
})

function nameFromRef(ref: string): string {
  const last = ref.split('@')[0]?.split('/').at(-1)?.split(':')[0] ?? ''
  return last.replace(/[^a-z0-9._-]/gi, '-').replace(/^[^a-z0-9]+/i, '')
}

function findYaml(dir: string): string | undefined {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
  const hit = files.find((f) => ['.yaml', '.yml'].includes(extname(f)))
  return hit && join(dir, hit)
}

app.post('/api/registry/pull', async (c) => {
  const b = await body(c)
  const ref = str(b, 'ref')
  const force = b.force === true
  const name = str(b, 'name', true) || nameFromRef(ref)
  if (!NAME_RE.test(name))
    throw new HttpError(400, `cannot derive a valid agent name from "${ref}"; pass "name"`)
  if (!force && agentPath(name))
    throw new HttpError(409, `agent already exists: ${name} (pass force to overwrite)`)
  const dir = await mkdtemp(join(tmpdir(), 'das-pull-'))
  try {
    const result = await runCli(['share', 'pull', ref, ...(force ? ['--force'] : [])], {
      cwd: dir,
      timeoutMs: 120_000,
    })
    if (!result.ok) return c.json({ result })
    const file = findYaml(dir)
    if (!file)
      return c.json({
        result: { ...result, ok: false, stderr: `${result.stderr}\nno YAML file was pulled` },
      })
    const agent = await importAgentFile(file, name)
    runtime.restartIfRunning()
    return c.json({ result, agent })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// --- managed runtime ---

app.get('/api/runtime', (c) => c.json(runtime.status()))
app.post('/api/runtime/start', async (c) => c.json(await runtime.start()))
app.post('/api/runtime/stop', async (c) => c.json(await runtime.stop()))
app.post('/api/runtime/restart', async (c) => c.json(await runtime.restart()))

const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
]

async function proxy(c: Context, upstreamPath: string): Promise<Response> {
  if (!runtime.isRunning()) return c.json({ error: 'runtime not running' }, 503)
  const req = c.req.raw
  const search = new URL(req.url).search
  const headers = new Headers()
  for (const h of ['content-type', 'accept']) {
    const v = req.headers.get(h)
    if (v) headers.set(h, v)
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method)
  let upstream: Response
  try {
    upstream = await fetch(`${runtime.url}/${upstreamPath}${search}`, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      signal: req.signal, // cancel upstream SSE when the client disconnects
      redirect: 'manual',
    })
  } catch (e) {
    return c.json(
      { error: `runtime request failed: ${e instanceof Error ? e.message : String(e)}` },
      502,
    )
  }
  const out = new Headers(upstream.headers)
  for (const h of HOP_BY_HOP) out.delete(h)
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

app.all('/api/runtime/proxy/*', (c) => proxy(c, c.req.path.slice('/api/runtime/proxy/'.length)))
// Alias matching the comment in shared/api.ts: /api/runtime/api/* -> <runtime>/api/*
app.all('/api/runtime/api/*', (c) => proxy(c, c.req.path.slice('/api/runtime/'.length)))

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

// --- static SPA (production) ---

if (process.env.NODE_ENV === 'production') {
  const dist = normalize(join(import.meta.dir, '../dist'))
  app.get('*', async (c) => {
    const path = normalize(join(dist, decodeURIComponent(c.req.path)))
    const file = Bun.file(path)
    if (path.startsWith(dist) && path !== dist && (await file.exists())) return new Response(file)
    return new Response(Bun.file(join(dist, 'index.html')), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  })
}

const port = Number(process.env.PORT) || 4800
console.log(`Docker Agent Studio API on http://localhost:${port} (agents: ${AGENTS_DIR})`)

// idleTimeout 0: proxied SSE streams can be idle for long stretches while the model thinks.
export default { port, fetch: app.fetch, idleTimeout: 0 }
