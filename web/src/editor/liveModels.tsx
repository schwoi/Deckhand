import type { ReactNode } from 'react'
import type { Option } from '../components/ui/Combobox'
import { type LiveQuery, useLiveModels } from './hooks'

/**
 * Suggestions from the provider's own model list, to put ahead of the catalog. `merge` appends
 * catalog options the live list does not already contain. The combobox stays free text.
 */
export function useLiveModelOptions(query: LiveQuery | null) {
  const live = useLiveModels(query)
  const p = query?.provider ?? ''
  const options: Option[] = (live?.models ?? []).map((id) => ({
    value: id,
    group: `Available from ${p}`,
  }))
  const values = new Set(options.map((o) => o.value))
  const merge = (catalog: Option[]) => [
    ...options,
    ...catalog
      .filter((o) => !values.has(o.value))
      .map((o) => (options.length && !o.group ? { ...o, group: 'Catalog' } : o)),
  ]

  let status: ReactNode = null
  if (query?.provider)
    status = !live
      ? `Checking ${p} for available models…`
      : live.error
        ? `Showing the catalog: ${live.error}.`
        : options.length === 0
          ? `${p} listed no models; showing the catalog.`
          : `${options.length} models available from ${p}. Pick one or type any name.`
  return { merge, status }
}
