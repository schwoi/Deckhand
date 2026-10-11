import type { ModelInfo } from '@shared/api'
import { useEffect, useState } from 'react'
import { api } from '../api'

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
