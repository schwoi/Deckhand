import { type KeyboardEvent, type ReactNode, useId, useMemo, useState } from 'react'
import { cn } from '../../lib/util'
import { useFieldId } from './form'

export interface Option {
  value: string
  label?: string
  hint?: string
  group?: string
}

/** Free-text input with a filtered suggestion list. Arrow keys + Enter pick a suggestion. */
export function Combobox({
  value,
  onChange,
  onSelect,
  options,
  placeholder,
  mono,
  className,
  onKeyDown,
  id,
  leading,
  'aria-invalid': invalid,
}: {
  value: string
  onChange: (v: string) => void
  /** called when a suggestion is picked; defaults to onChange */
  onSelect?: (v: string) => void
  options: Option[]
  placeholder?: string
  mono?: boolean
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  id?: string
  leading?: ReactNode
  'aria-invalid'?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const inputId = useFieldId(id)

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    const exact = options.some((o) => o.value === value)
    const list =
      !q || exact
        ? options
        : options.filter((o) =>
            `${o.value} ${o.label ?? ''} ${o.hint ?? ''}`.toLowerCase().includes(q),
          )
    return list.slice(0, 80)
  }, [options, value])

  const pick = (v: string) => {
    ;(onSelect ?? onChange)(v)
    setOpen(false)
    setActive(-1)
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (a + 1) % filtered.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a <= 0 ? filtered.length - 1 : a - 1))
        return
      }
      if (e.key === 'Enter' && active >= 0 && filtered[active]) {
        e.preventDefault()
        pick(filtered[active].value)
        return
      }
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') setOpen(true)
    onKeyDown?.(e)
  }

  let lastGroup: string | undefined
  return (
    <div className={cn('relative min-w-0', className)}>
      <div className="control flex h-8 items-center max-lg:h-10">
        {leading}
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false)
            setActive(-1)
          }}
          onKeyDown={handleKey}
          className={cn(
            'h-full w-full min-w-0 bg-transparent px-2.5 text-base outline-none placeholder:text-faint',
            mono && 'font-mono text-sm',
          )}
        />
      </div>
      {open && filtered.length > 0 && (
        <div
          id={listId}
          // biome-ignore lint/a11y/useSemanticElements: custom-styled ARIA widget
          role="listbox"
          tabIndex={-1}
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 animate-fade-in overscroll-contain overflow-y-auto rounded-md border border-line-strong bg-surface p-1 shadow-lg shadow-black/10"
        >
          {filtered.map((o, i) => {
            const header = o.group && o.group !== lastGroup ? o.group : null
            lastGroup = o.group
            return (
              <div key={`${o.group ?? ''}:${o.value}`}>
                {header && (
                  <div className="px-2 pt-2 pb-1 text-2xs font-semibold tracking-wide text-faint uppercase">
                    {header}
                  </div>
                )}
                {/* biome-ignore lint/a11y/useSemanticElements: ARIA combobox pattern */}
                <div
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(o.value)
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex min-w-0 cursor-pointer items-baseline gap-2 rounded px-2 py-1 text-base max-lg:py-2.5',
                    i === active && 'bg-hover',
                    o.value === value && 'text-accent-text',
                  )}
                >
                  <span className={cn('truncate', mono && 'font-mono text-sm')}>
                    {o.label ?? o.value}
                  </span>
                  {o.hint && (
                    <span className="ml-auto min-w-0 shrink truncate text-xs text-faint">
                      {o.hint}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
