import { Plus, X } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

const nonEmpty = (s: string) => s.trim() !== ''
import { cn } from '../../lib/util'
import { Button } from './Button'
import { Combobox, type Option } from './Combobox'
import { FieldIdContext, Input } from './form'

/** Rows of single-line strings. Empty rows are kept locally but not emitted. */
export function StringListEditor({
  value,
  onChange,
  placeholder,
  addLabel = 'Add',
  mono = true,
}: {
  value: string[] | undefined
  onChange: (v: string[]) => void
  placeholder?: string
  addLabel?: string
  mono?: boolean
}) {
  const external = value ?? []
  const [rows, setRows] = useState<string[]>(external)
  const focusIndex = useRef<number | null>(null)
  const container = useRef<HTMLDivElement>(null)

  const key = JSON.stringify(external)
  // biome-ignore lint/correctness/useExhaustiveDependencies: resync only when the external value really changes
  useEffect(() => {
    setRows((r) => (JSON.stringify(r.filter(nonEmpty)) === key ? r : external))
  }, [key])

  useEffect(() => {
    if (focusIndex.current === null) return
    const inputs = container.current?.querySelectorAll('input')
    inputs?.[focusIndex.current]?.focus()
    focusIndex.current = null
  })

  const update = (next: string[]) => {
    setRows(next)
    onChange(next.filter(nonEmpty))
  }
  const insertAt = (i: number) => {
    focusIndex.current = i
    update([...rows.slice(0, i), '', ...rows.slice(i)])
  }

  return (
    <FieldIdContext.Provider value={undefined}>
      <div ref={container} className="flex flex-col gap-1.5">
        {rows.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <div key={i} className="group flex items-center gap-1.5">
            <Input
              mono={mono}
              value={row}
              placeholder={placeholder}
              onChange={(e) => update(rows.map((r, j) => (j === i ? e.target.value : r)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  insertAt(i + 1)
                } else if (e.key === 'Backspace' && row === '' && rows.length > 0) {
                  e.preventDefault()
                  focusIndex.current = Math.max(0, i - 1)
                  update(rows.filter((_, j) => j !== i))
                }
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<X />}
              title="Remove"
              onClick={() => update(rows.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <div>
          <Button
            size="xs"
            variant="ghost"
            icon={<Plus />}
            onClick={() => insertAt(rows.length)}
            className="-ml-1.5"
          >
            {addLabel}
          </Button>
        </div>
      </div>
    </FieldIdContext.Provider>
  )
}

/** Record<string, string> editor with key/value rows. */
export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = 'KEY',
  valuePlaceholder = 'value',
  addLabel = 'Add',
  multilineValues,
}: {
  value: Record<string, string> | undefined
  onChange: (v: Record<string, string>) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  addLabel?: string
  multilineValues?: boolean
}) {
  const external = value ?? {}
  const toRecord = (rows: [string, string][]) => {
    const out: Record<string, string> = {}
    for (const [k, v] of rows) if (k.trim()) out[k.trim()] = v
    return out
  }
  const [rows, setRows] = useState<[string, string][]>(Object.entries(external))
  const key = JSON.stringify(external)
  // biome-ignore lint/correctness/useExhaustiveDependencies: resync only when the external value really changes
  useEffect(() => {
    setRows((r) => (JSON.stringify(toRecord(r)) === key ? r : Object.entries(external)))
  }, [key])

  const update = (next: [string, string][]) => {
    setRows(next)
    onChange(toRecord(next))
  }
  const dupes = new Set(rows.map(([k]) => k.trim()).filter((k, i, a) => k && a.indexOf(k) !== i))

  return (
    <FieldIdContext.Provider value={undefined}>
      <div className="flex flex-col gap-1.5">
        {rows.map(([k, v], i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
            key={i}
            className={cn('flex gap-1.5', multilineValues ? 'items-start' : 'items-center')}
          >
            <Input
              mono
              className="w-2/5 shrink-0"
              value={k}
              placeholder={keyPlaceholder}
              aria-invalid={dupes.has(k.trim())}
              onChange={(e) => update(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
            />
            {multilineValues ? (
              <textarea
                rows={1}
                className="control min-h-8 w-full resize-y px-2.5 py-1.5 text-base placeholder:text-faint max-lg:min-h-10 max-lg:py-2"
                value={v}
                placeholder={valuePlaceholder}
                onChange={(e) => update(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
              />
            ) : (
              <Input
                mono
                value={v}
                placeholder={valuePlaceholder}
                onChange={(e) => update(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<X />}
              title="Remove"
              onClick={() => update(rows.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <div>
          <Button
            size="xs"
            variant="ghost"
            icon={<Plus />}
            onClick={() => setRows([...rows, ['', '']])}
            className="-ml-1.5"
          >
            {addLabel}
          </Button>
        </div>
      </div>
    </FieldIdContext.Provider>
  )
}

/** Chips with an inline input; optional suggestions. Enter or comma adds. */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Add…',
  mono,
}: {
  value: string[] | undefined
  onChange: (v: string[]) => void
  suggestions?: Option[]
  placeholder?: string
  mono?: boolean
}) {
  const tags = value ?? []
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const items = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !tags.includes(s))
    if (items.length) onChange([...tags, ...items])
    setDraft('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1))
    }
  }
  const remaining = suggestions.filter((s) => !tags.includes(s.value))
  return (
    <div className="flex flex-col gap-1.5">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md border bg-sunken pr-0.5 pl-2 text-sm max-lg:h-8',
                mono && 'font-mono text-xs',
              )}
            >
              {t}
              <button
                type="button"
                onClick={() => onChange(tags.filter((x) => x !== t))}
                className="rounded p-0.5 text-faint hover:bg-hover hover:text-fg max-lg:p-1.5"
                aria-label={`Remove ${t}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Combobox
        value={draft}
        onChange={setDraft}
        onSelect={add}
        options={remaining}
        placeholder={placeholder}
        mono={mono}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
