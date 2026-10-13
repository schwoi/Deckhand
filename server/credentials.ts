import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CredentialsStatus } from '@shared/api'
import { HttpError } from './agents'
import { PRIVATE_DIR, PRIVATE_FILE } from './paths'

// Model credentials live where `docker agent setup` puts them, so the CLI and the runtime pick
// them up with no flags: API keys as KEY=value lines in <config dir>/.env, and the ChatGPT
// account login in <config dir>/chatgpt-auth.json. Values are write-only through the API; only
// variable names ever come back out.

const CONFIG_DIR = join(homedir(), '.config', 'cagent')
const ENV_FILE = join(CONFIG_DIR, '.env')
const CHATGPT_FILE = join(CONFIG_DIR, 'chatgpt-auth.json')

const FLOW_TIMEOUT_MS = 10 * 60_000

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function writePrivate(path: string, content: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: PRIVATE_DIR })
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(tmp, content, { mode: PRIVATE_FILE, flag: 'wx' })
  renameSync(tmp, path)
}

// --- env file ---

const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

const keyOf = (line: string) =>
  line
    .split('=', 1)[0]
    ?.replace(/^export\s+/, '')
    .trim()

function envLines(): string[] {
  const text = readText(ENV_FILE).replace(/\n+$/, '')
  return text ? text.split('\n') : []
}

function envEntries(): [string, string][] {
  return envLines()
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => {
      const v = l.slice(l.indexOf('=') + 1).trim()
      return [keyOf(l) ?? '', /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v]
    })
}

function envNames(): string[] {
  return [
    ...new Set(
      envEntries()
        .map(([k]) => k)
        .filter(Boolean),
    ),
  ]
}

/** A secret as docker-agent resolves it here: the process environment, then its env file. */
export function lookupSecret(name: string): string | undefined {
  return process.env[name] || envEntries().find(([k]) => k === name)?.[1] || undefined
}

/** Set NAME=value in the env file, replacing the first existing line and dropping repeats. */
export function setEnvVar(name: string, value: string): void {
  if (!VAR_RE.test(name)) throw new HttpError(400, `invalid variable name: ${name}`)
  const v = value.trim()
  if (!v || /[\r\n]/.test(v)) throw new HttpError(400, 'the value must be a single non-empty line')
  const line = `${name}=${v}`
  let replaced = false
  const lines = envLines().flatMap((l) => {
    if (keyOf(l) !== name) return [l]
    if (replaced) return []
    replaced = true
    return [line]
  })
  if (!replaced) lines.push(line)
  writePrivate(ENV_FILE, `${lines.join('\n')}\n`)
}

export function removeEnvVar(name: string): void {
  const lines = envLines()
  const kept = lines.filter((l) => keyOf(l) !== name)
  if (kept.length === lines.length) throw new HttpError(404, `${name} is not in ${ENV_FILE}`)
  writePrivate(ENV_FILE, kept.length ? `${kept.join('\n')}\n` : '')
}

// --- ChatGPT account sign-in ---
// The same OAuth client, redirect and file format as docker-agent's own `setup` sign-in
// (pkg/chatgpt), so docker-agent refreshes the token itself afterwards. The redirect URI is
// registered with OpenAI and fixed to localhost:1455: when the browser runs on this machine we
// catch it there; otherwise (a remote environment, a container) the user pastes the URL the
// browser ended up on.

const OPENAI_AUTH = 'https://auth.openai.com'
const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CHATGPT_REDIRECT = 'http://localhost:1455/auth/callback'

interface ChatgptFlow {
  state: string
  verifier: string
  authUrl: string
  server?: ReturnType<typeof Bun.serve>
  timer: ReturnType<typeof setTimeout>
}
let chatgptFlow: ChatgptFlow | null = null
let chatgptError: string | undefined

const b64url = (buf: Buffer) => buf.toString('base64url')

interface Claims {
  email?: string
  exp?: number
  'https://api.openai.com/auth'?: { chatgpt_account_id?: string; chatgpt_plan_type?: string }
}

function claims(jwt: string | undefined): Claims {
  try {
    return JSON.parse(Buffer.from(jwt?.split('.')[1] ?? '', 'base64url').toString()) as Claims
  } catch {
    return {}
  }
}

/** End the pending flow, or only `flow` if given (a stale attempt must not end a newer one). */
function endChatgptFlow(flow?: ChatgptFlow): void {
  if (!chatgptFlow || (flow && flow !== chatgptFlow)) return
  clearTimeout(chatgptFlow.timer)
  chatgptFlow.server?.stop() // graceful: the callback that ends the flow still needs its page
  chatgptFlow = null
}

export function startChatgptLogin(onDone: () => void): void {
  endChatgptFlow()
  chatgptError = undefined
  const verifier = b64url(randomBytes(32))
  const state = randomBytes(32).toString('hex')
  const authUrl = `${OPENAI_AUTH}/oauth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: CHATGPT_CLIENT_ID,
    redirect_uri: CHATGPT_REDIRECT,
    scope: 'openid profile email offline_access',
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
  })}`
  const timer = setTimeout(() => {
    endChatgptFlow()
    chatgptError = 'Sign-in timed out. Start again.'
  }, FLOW_TIMEOUT_MS) // cleared when the flow ends, so it only ever fires for this one
  const flow: ChatgptFlow = { state, verifier, authUrl, timer }
  chatgptFlow = flow
  try {
    flow.server = Bun.serve({
      hostname: '127.0.0.1',
      port: 1455,
      fetch: async (req) => {
        const url = new URL(req.url)
        if (url.pathname !== '/auth/callback') return new Response('not found', { status: 404 })
        try {
          await completeChatgptLogin(req.url)
          onDone()
          return callbackPage(
            'Signed in to ChatGPT',
            'You can close this tab and return to Deckhand.',
          )
        } catch (e) {
          return callbackPage('Sign-in failed', e instanceof Error ? e.message : String(e), 400)
        }
      },
    })
  } catch {
    // Port taken (another sign-in, Codex CLI): the paste-the-URL path still works.
  }
}

function callbackPage(title: string, detail: string, status = 200): Response {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  return new Response(
    `<!doctype html><title>${esc(title)}</title><body style="font-family:system-ui,sans-serif;text-align:center;padding-top:4rem"><h1>${esc(title)}</h1><p>${esc(detail)}</p>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

/** Finish the pending sign-in from the redirect URL (caught on :1455 or pasted by the user). */
export async function completeChatgptLogin(redirectUrl: string): Promise<void> {
  const flow = chatgptFlow
  if (!flow) throw new HttpError(409, 'no ChatGPT sign-in in progress; start again')
  let params: URLSearchParams
  try {
    params = new URL(redirectUrl.trim()).searchParams
  } catch {
    throw new HttpError(
      400,
      'paste the full address from the browser, starting with http://localhost:1455',
    )
  }
  // State first, errors included: anything can navigate to localhost:1455, and only a
  // response to this attempt may end it.
  const state = Buffer.from(params.get('state') ?? '')
  const expected = Buffer.from(flow.state)
  if (state.length !== expected.length || !timingSafeEqual(state, expected))
    throw new HttpError(400, 'that address belongs to a different sign-in attempt')
  const err = params.get('error')
  if (err) {
    endChatgptFlow(flow)
    chatgptError = `ChatGPT refused the sign-in: ${params.get('error_description') || err}`
    throw new HttpError(400, chatgptError)
  }
  const code = params.get('code')
  if (!code) throw new HttpError(400, 'that address has no authorization code')

  const res = await fetch(`${OPENAI_AUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CHATGPT_REDIRECT,
      client_id: CHATGPT_CLIENT_ID,
      code_verifier: flow.verifier,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const superseded = () => new HttpError(409, 'this sign-in was cancelled or replaced; start again')
  if (chatgptFlow !== flow) throw superseded()
  if (!res.ok) {
    endChatgptFlow(flow)
    chatgptError = `Token exchange failed (HTTP ${res.status}). Start again.`
    throw new HttpError(502, chatgptError)
  }
  const token = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    id_token?: string
    expires_in?: number
  }
  if (!token.access_token) throw new HttpError(502, 'ChatGPT returned no access token')
  if (chatgptFlow !== flow) throw superseded()
  // Same precedence as docker-agent: per claim, the id_token wins over the access token.
  const access = claims(token.access_token)
  const id = claims(token.id_token)
  const accessAuth = access['https://api.openai.com/auth']
  const idAuth = id['https://api.openai.com/auth']
  const exp = token.expires_in
    ? Date.now() + token.expires_in * 1000
    : (access.exp ?? Number.NaN) * 1000
  writePrivate(
    CHATGPT_FILE,
    JSON.stringify(
      {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        id_token: token.id_token,
        account_id: idAuth?.chatgpt_account_id || accessAuth?.chatgpt_account_id,
        email: id.email || access.email,
        plan: idAuth?.chatgpt_plan_type || accessAuth?.chatgpt_plan_type,
        expires_at: Number.isFinite(exp) ? new Date(exp).toISOString() : undefined,
        last_refresh: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  endChatgptFlow(flow)
}

/** Reported as an error so another tab's dialog for the same flow doesn't read it as success. */
const CANCELLED = 'The sign-in was cancelled.'

export function cancelChatgptLogin(): void {
  if (!chatgptFlow) return
  endChatgptFlow()
  chatgptError = CANCELLED
}

export function chatgptSignOut(): void {
  rmSync(CHATGPT_FILE, { force: true })
}

/** The stored ChatGPT access token while it is still valid; docker-agent owns refreshing it. */
export function chatgptToken(): { token: string; accountId?: string } | undefined {
  try {
    const c = JSON.parse(readText(CHATGPT_FILE)) as {
      access_token?: string
      account_id?: string
      expires_at?: string
    }
    if (!c.access_token) return undefined
    if (c.expires_at && Date.parse(c.expires_at) < Date.now() + 60_000) return undefined
    return { token: c.access_token, accountId: c.account_id }
  } catch {
    return undefined
  }
}

function chatgptAccount(): CredentialsStatus['chatgpt']['account'] {
  try {
    const c = JSON.parse(readText(CHATGPT_FILE)) as {
      access_token?: string
      email?: string
      plan?: string
    }
    return c.access_token ? { email: c.email, plan: c.plan } : undefined
  } catch {
    return undefined
  }
}

// --- GitHub Copilot sign-in (device flow) ---
// docker-agent sends GITHUB_TOKEN straight to api.githubcopilot.com, which accepts OAuth
// (gho_) tokens. The device flow needs an OAuth app with device flow enabled; the default is
// the GitHub CLI's public client, whose tokens Copilot accepts (it is Copilot CLI's fallback).

const GITHUB_CLIENT_ID = process.env.DECKHAND_GITHUB_CLIENT_ID || '178c6fc778ccc68e1d6a'

interface CopilotFlow {
  abort: AbortController
  device?: { userCode: string; verificationUri: string } // unset while GitHub issues the code
}
let copilotFlow: CopilotFlow | null = null
let copilotError: string | undefined

async function githubPost<T>(path: string, body: Record<string, string>, signal: AbortSignal) {
  const res = await fetch(`https://github.com${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Copilot access is per account; OAuth succeeds without it, so ask before saving the token. */
async function copilotDenied(token: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://api.github.com/copilot_internal/user', {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return
    const user = (await res.json()) as { chat_enabled?: boolean }
    if (user.chat_enabled === false)
      return 'This GitHub account has no GitHub Copilot access. It needs a Copilot plan or an organization seat.'
  } catch {}
}

export async function startCopilotLogin(onDone: () => void): Promise<void> {
  copilotFlow?.abort.abort()
  copilotError = undefined
  // Installed before the first await so a cancel or a newer start can abort this one.
  const abort = new AbortController()
  const flow: CopilotFlow = { abort }
  copilotFlow = flow
  const device = await githubPost<{
    device_code: string
    user_code: string
    verification_uri: string
    interval: number
    expires_in: number
  }>('/login/device/code', { client_id: GITHUB_CLIENT_ID, scope: 'read:user' }, abort.signal).catch(
    (e: unknown) => {
      if (copilotFlow === flow) copilotFlow = null
      if (abort.signal.aborted) throw new HttpError(409, 'the GitHub sign-in was cancelled')
      throw new HttpError(
        502,
        `could not start the GitHub sign-in: ${e instanceof Error ? e.message : e}`,
      )
    },
  )
  if (copilotFlow !== flow) throw new HttpError(409, 'the GitHub sign-in was cancelled')
  flow.device = { userCode: device.user_code, verificationUri: device.verification_uri }
  const deadline = Date.now() + Math.min(device.expires_in * 1000, FLOW_TIMEOUT_MS)
  let interval = Math.max(device.interval, 1) * 1000

  const finish = (error?: string) => {
    if (copilotFlow !== flow) return
    copilotFlow = null
    copilotError = error
  }
  void (async () => {
    while (!abort.signal.aborted) {
      await Bun.sleep(interval)
      if (abort.signal.aborted) return
      if (Date.now() > deadline) return finish('The code expired. Start again.')
      try {
        const r = await githubPost<{ access_token?: string; error?: string; interval?: number }>(
          '/login/oauth/access_token',
          {
            client_id: GITHUB_CLIENT_ID,
            device_code: device.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          },
          abort.signal,
        )
        if (r.access_token) {
          const denied = await copilotDenied(r.access_token)
          if (denied) return finish(denied)
          if (copilotFlow !== flow) return
          setEnvVar('GITHUB_TOKEN', r.access_token)
          finish()
          return onDone()
        }
        if (r.error === 'authorization_pending') continue
        if (r.error === 'slow_down') {
          interval = (r.interval ?? interval / 1000 + 5) * 1000
          continue
        }
        if (r.error === 'access_denied') return finish('The sign-in was cancelled on GitHub.')
        if (r.error === 'expired_token') return finish('The code expired. Start again.')
        return finish(`GitHub sign-in failed: ${r.error ?? 'unknown error'}`)
      } catch (e) {
        if (abort.signal.aborted) return
        return finish(`GitHub sign-in failed: ${e instanceof Error ? e.message : e}`)
      }
    }
  })()
}

export function cancelCopilotLogin(): void {
  if (!copilotFlow) return
  copilotFlow.abort.abort()
  copilotFlow = null
  copilotError = CANCELLED
}

export function credentialsStatus(): CredentialsStatus {
  return {
    envFile: ENV_FILE,
    envVars: envNames(),
    chatgpt: {
      account: chatgptAccount(),
      flow: chatgptFlow
        ? { authUrl: chatgptFlow.authUrl, listening: !!chatgptFlow.server }
        : undefined,
      error: chatgptError,
    },
    githubCopilot: {
      flow: copilotFlow?.device,
      error: copilotError,
    },
  }
}
