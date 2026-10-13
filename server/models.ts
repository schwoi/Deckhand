import type { LiveModels } from '@shared/api'
import { HttpError } from './agents'
import { ttlCache } from './cli'
import { chatgptToken, lookupSecret } from './credentials'

// The models a provider actually serves to *this* account, asked from the provider's own API.
// `docker agent models` lists the models.dev catalog instead, which knows nothing about a
// Copilot plan's policies or what a ChatGPT subscription unlocks. Credentials are resolved the
// way docker-agent does (process env, then its env file, then the ChatGPT login).

// OpenAI-compatible aliases, mirroring docker-agent's pkg/model/provider/aliases.go.
const OPENAI_COMPATIBLE: Record<string, { baseUrl: string; tokenKey?: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', tokenKey: 'OPENAI_API_KEY' },
  xai: { baseUrl: 'https://api.x.ai/v1', tokenKey: 'XAI_API_KEY' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', tokenKey: 'MISTRAL_API_KEY' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', tokenKey: 'GROQ_API_KEY' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', tokenKey: 'DEEPSEEK_API_KEY' },
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', tokenKey: 'CEREBRAS_API_KEY' },
  togetherai: { baseUrl: 'https://api.together.xyz/v1', tokenKey: 'TOGETHER_API_KEY' },
  'fireworks-ai': {
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    tokenKey: 'FIREWORKS_API_KEY',
  },
  huggingface: { baseUrl: 'https://router.huggingface.co/v1', tokenKey: 'HF_TOKEN' },
  moonshotai: { baseUrl: 'https://api.moonshot.ai/v1', tokenKey: 'MOONSHOT_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', tokenKey: 'OPENROUTER_API_KEY' },
  requesty: { baseUrl: 'https://router.requesty.ai/v1', tokenKey: 'REQUESTY_API_KEY' },
  nebius: { baseUrl: 'https://api.studio.nebius.com/v1', tokenKey: 'NEBIUS_API_KEY' },
  nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', tokenKey: 'NVIDIA_API_KEY' },
  minimax: { baseUrl: 'https://api.minimax.io/v1', tokenKey: 'MINIMAX_API_KEY' },
  baseten: { baseUrl: 'https://inference.baseten.co/v1', tokenKey: 'BASETEN_API_KEY' },
  ovhcloud: {
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    tokenKey: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN',
  },
  daoxe: { baseUrl: 'https://api.daoxe.com/v1', tokenKey: 'DAOXE_API_KEY' },
  vercel: { baseUrl: 'https://ai-gateway.vercel.sh/v1', tokenKey: 'AI_GATEWAY_API_KEY' },
  opencode: { baseUrl: 'https://opencode.ai/zen/v1', tokenKey: 'OPENCODE_API_KEY' },
  'opencode-go': { baseUrl: 'https://opencode.ai/zen/go/v1', tokenKey: 'OPENCODE_API_KEY' },
  ollama: { baseUrl: 'http://localhost:11434/v1' },
}

const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

class Unavailable extends Error {}

function need(...names: string[]): string {
  for (const n of names) {
    const v = lookupSecret(n)
    if (v) return v
  }
  throw new Unavailable(`no ${names.join(' or ')} found`)
}

// Error messages never include the URL: a custom base_url may have secrets expanded into it.
async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    })
  } catch (e) {
    throw new Error(
      e instanceof Error && e.name === 'TimeoutError'
        ? 'timed out'
        : 'could not reach the provider',
    )
  }
  if (res.status === 401 || res.status === 403)
    throw new Error(`the provider rejected the credential (HTTP ${res.status})`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  try {
    return (await res.json()) as T
  } catch {
    throw new Error('the provider did not return JSON')
  }
}

const sorted = (ids: (string | undefined)[]) =>
  [...new Set(ids.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b))

async function openaiCompatible(baseUrl: string, token: string | undefined): Promise<string[]> {
  const r = await getJson<{ data?: { id?: string }[] }>(
    `${baseUrl.replace(/\/+$/, '')}/models`,
    token ? { authorization: `Bearer ${token}` } : {},
  )
  return sorted((r.data ?? []).map((m) => m.id)).filter((id) => !/embed/i.test(id))
}

async function fetchModels(provider: string, baseUrl?: string, tokenKey?: string) {
  if (baseUrl) {
    const url = baseUrl.replace(/\$\{(\w+)\}/g, (_, n: string) => lookupSecret(n) ?? '')
    if (!/^https?:\/\//i.test(url)) throw new Unavailable('base_url is not an http(s) URL')
    return openaiCompatible(url, tokenKey ? need(tokenKey) : undefined)
  }
  switch (provider) {
    case 'anthropic': {
      const r = await getJson<{ data?: { id?: string }[] }>(
        'https://api.anthropic.com/v1/models?limit=1000',
        { 'x-api-key': need('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
      )
      return sorted((r.data ?? []).map((m) => m.id))
    }
    case 'google': {
      const r = await getJson<{
        models?: { name?: string; supportedGenerationMethods?: string[] }[]
      }>('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
        'x-goog-api-key': need('GOOGLE_API_KEY', 'GEMINI_API_KEY'),
      })
      return sorted(
        (r.models ?? [])
          .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m) => m.name?.replace(/^models\//, '')),
      )
    }
    case 'github-copilot': {
      // Same integration id docker-agent sends; the list reflects the plan and org policies.
      const r = await getJson<{
        data?: { id?: string; model_picker_enabled?: boolean; policy?: { state?: string } }[]
      }>('https://api.githubcopilot.com/models', {
        authorization: `Bearer ${need('GITHUB_TOKEN', 'GH_TOKEN')}`,
        'copilot-integration-id': 'copilot-developer-cli',
      })
      // model_picker_enabled is what Copilot's own clients offer; the rest are retired
      // snapshots, embeddings and internal helpers (still usable by typing the id).
      return sorted(
        (r.data ?? [])
          .filter((m) => m.model_picker_enabled && m.policy?.state !== 'disabled')
          .map((m) => m.id),
      )
    }
    case 'chatgpt': {
      // The Codex backend's model list (what the Codex CLI shows for a ChatGPT plan).
      const login = chatgptToken()
      if (!login) throw new Unavailable('not signed in to ChatGPT, or the login has expired')
      const r = await getJson<{
        models?: { slug?: string; id?: string; visibility?: string }[]
      }>('https://chatgpt.com/backend-api/codex/models?client_version=1.0.0', {
        authorization: `Bearer ${login.token}`,
        originator: 'codex_cli_rs',
        ...(login.accountId && { 'chatgpt-account-id': login.accountId }),
      })
      return sorted(
        (r.models ?? []).filter((m) => m.visibility !== 'hide').map((m) => m.slug ?? m.id),
      )
    }
  }
  const alias = OPENAI_COMPATIBLE[provider]
  if (!alias) throw new Unavailable(`${provider} has no model list Deckhand can query`)
  return openaiCompatible(alias.baseUrl, alias.tokenKey ? need(alias.tokenKey) : undefined)
}

const cache = ttlCache<string[]>(5 * 60_000)
export const clearLiveModels = () => cache.clear()

/** Never throws for provider trouble: the editor falls back to the catalog and shows why. */
export async function liveModels(
  provider: string,
  baseUrl?: string,
  tokenKey?: string,
): Promise<LiveModels> {
  if (tokenKey && !VAR_RE.test(tokenKey)) throw new HttpError(400, `invalid token_key: ${tokenKey}`)
  try {
    const key = JSON.stringify([provider, baseUrl ?? '', tokenKey ?? ''])
    return { models: await cache(key, () => fetchModels(provider, baseUrl, tokenKey)) }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return { models: [], error: e instanceof Unavailable ? reason : `${provider}: ${reason}` }
  }
}
