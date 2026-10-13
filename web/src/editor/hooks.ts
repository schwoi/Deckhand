import type { DoctorReport, LiveModels, ModelInfo } from '@shared/api'
import { useEffect, useState } from 'react'
import { api, apiEnvironment, errorText } from '../api'

// Caches are per environment: each one is a different machine with its own CLI and credentials.
const catalogs = new Map<string, Promise<ModelInfo[]>>()

/** All known models (docker agent models --all), fetched once per page load and environment. */
export function useModelCatalog(): ModelInfo[] {
  const [models, setModels] = useState<ModelInfo[]>([])
  useEffect(() => {
    const env = apiEnvironment()
    let catalog = catalogs.get(env)
    if (!catalog) {
      catalog = api.system.models(true).catch(() => {
        catalogs.delete(env)
        return []
      })
      catalogs.set(env, catalog)
    }
    let live = true
    catalog.then((m) => live && setModels(m))
    return () => {
      live = false
    }
  }, [])
  return models
}

const doctors = new Map<string, { at: number; report: Promise<DoctorReport | null> }>()

/** Forget doctor reports, e.g. after credentials change. */
export function invalidateDoctor(): void {
  doctors.clear()
}

function doctorReport(): Promise<DoctorReport | null> {
  const env = apiEnvironment()
  const hit = doctors.get(env)
  if (hit && Date.now() - hit.at < 30_000) return hit.report
  const report = api.system.doctor().catch(() => null)
  doctors.set(env, { at: Date.now(), report })
  return report
}

/**
 * docker agent doctor: which providers have credentials and the auto model. Shared briefly so
 * every model entry doesn't run it; re-checked when the tab regains focus, so a key added on
 * the System page or in another tab shows up.
 */
export function useDoctor(): DoctorReport | null {
  const [report, setReport] = useState<DoctorReport | null>(null)
  useEffect(() => {
    let live = true
    const load = () => {
      if (document.visibilityState === 'visible') doctorReport().then((r) => live && setReport(r))
    }
    load()
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', load)
    return () => {
      live = false
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', load)
    }
  }, [])
  return report
}

export interface LiveQuery {
  provider: string
  base_url?: string
  token_key?: string
}

/**
 * The models `provider` itself lists for this account (the server caches them for a few
 * minutes). Debounced, since the provider is often being typed. `null` while loading.
 */
export function useLiveModels(q: LiveQuery | null): LiveModels | null {
  const key = q?.provider
    ? JSON.stringify([apiEnvironment(), q.provider, q.base_url, q.token_key])
    : ''
  const [result, setResult] = useState<{ key: string; value: LiveModels } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: key captures q
  useEffect(() => {
    if (!q?.provider) return
    let live = true
    const t = setTimeout(() => {
      api.system
        .liveModels(q)
        .catch((e): LiveModels => ({ models: [], error: errorText(e) }))
        .then((value) => live && setResult({ key, value }))
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [key])
  return result?.key === key ? result.value : null
}

export function strList(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
}

export function strRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val
  return out
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}
