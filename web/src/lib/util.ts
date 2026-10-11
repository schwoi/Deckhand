export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0) ||
    (isPlainObject(v) && Object.keys(v).length === 0)
  )
}

/** Copy of `obj` with `key` set, or removed when the value is empty. Key order is preserved. */
export function withField<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  value: T[K] | undefined,
): T {
  const next = { ...obj }
  if (isEmpty(value)) delete next[key]
  else next[key] = value as T[K]
  return next
}

/** Rename a key in a record, preserving order. */
export function renameKey<V>(rec: Record<string, V>, from: string, to: string): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [k, v] of Object.entries(rec)) out[k === from ? to : k] = v
  return out
}

export function omitKey<V>(rec: Record<string, V>, key: string): Record<string, V> {
  const { [key]: _, ...rest } = rec
  return rest
}

export function uniqueKey(existing: Iterable<string>, base: string): string {
  const set = new Set(existing)
  if (!set.has(base)) return base
  let i = 2
  while (set.has(`${base}${i}`)) i++
  return `${base}${i}`
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
export function relativeTime(iso: string | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.round((t - Date.now()) / 1000)
  const abs = Math.abs(s)
  if (abs < 45) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day')
  return new Date(iso).toLocaleDateString()
}

export function formatTokens(n: number | undefined): string {
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatCost(n: number | undefined): string {
  if (!n) return '$0.00'
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`
}

export function prettyJson(s: string | undefined): string {
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

export const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i
