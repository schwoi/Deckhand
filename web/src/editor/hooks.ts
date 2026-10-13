import type { DoctorReport, LiveModels, ModelInfo } from '@shared/api'
import { useEffect, useState } from 'react'
import { api, errorText } from '../api'

let catalog: Promise<ModelInfo[]> | null = null

/** All known models (docker agent models --all), fetched once per page load. */
export function useModelCatalog(): ModelInfo[] {
  const [models, setModels] = useState<ModelInfo[]>([])
  useEffect(() => {
    catalog ??= api.system.models(true).catch(() => {
      catalog = null
      return []
    })
    let live = true
    catalog.then((m) => live && setModels(m))
    return () => {
      live = false
    }
  }, [])
  return models
}

let doctor: { at: number; report: Promise<DoctorReport | null> } | null = null

/**
 * docker agent doctor: which providers have credentials and the auto model. Shared for 30s so
 * every model entry doesn't run it, yet a key added on the System page shows up soon after.
 */
export function useDoctor(): DoctorReport | null {
  const [report, setReport] = useState<DoctorReport | null>(null)
  useEffect(() => {
    if (!doctor || Date.now() - doctor.at > 30_000)
      doctor = { at: Date.now(), report: api.system.doctor().catch(() => null) }
    let live = true
    doctor.report.then((r) => live && setReport(r))
    return () => {
      live = false
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
  const key = q?.provider ? JSON.stringify([q.provider, q.base_url, q.token_key]) : ''
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
