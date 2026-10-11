import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
} from 'react'
import { cn } from '../../lib/util'

/** id of the control the enclosing Field's label points at; list editors reset it. */
export const FieldIdContext = createContext<string | undefined>(undefined)
export function useFieldId(id?: string): string | undefined {
  const ctx = useContext(FieldIdContext)
  return id ?? ctx
}

export function Input({
  className,
  mono,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      id={useFieldId(id)}
      className={cn(
        'control h-8 w-full min-w-0 px-2.5 text-base placeholder:text-faint',
        mono && 'font-mono text-sm',
        className,
      )}
      {...rest}
    />
  )
}

/** Number input that maps "" to undefined. */
export function NumberInput({
  value,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | undefined
  onChange: (v: number | undefined) => void
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      {...rest}
    />
  )
}

export function Textarea({
  className,
  mono,
  autoGrow,
  minRows = 3,
  id,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  mono?: boolean
  autoGrow?: boolean
  minRows?: number
}) {
  const fieldId = useFieldId(id)
  const ref = useRef<HTMLTextAreaElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize whenever the value changes
  useLayoutEffect(() => {
    const el = ref.current
    if (!autoGrow || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [autoGrow, rest.value])
  return (
    <textarea
      ref={ref}
      id={fieldId}
      rows={minRows}
      className={cn(
        'control block w-full px-2.5 py-1.5 text-base placeholder:text-faint',
        mono && 'font-mono text-sm leading-relaxed',
        autoGrow ? 'resize-none overflow-hidden' : 'resize-y',
        className,
      )}
      {...rest}
    />
  )
}

export function Select({
  className,
  children,
  id,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      id={useFieldId(id)}
      className={cn(
        'control select-chevron h-8 w-full min-w-0 appearance-none pr-7 pl-2.5 text-base',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  id?: string
}) {
  const sw = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full border transition-colors disabled:opacity-50',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-sunken',
      )}
    >
      <span
        className={cn(
          'block size-3 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[14px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
  if (!label) return sw
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: wraps the switch button, which is a labelable element
    <label className="flex cursor-pointer items-start gap-2.5">
      <span className="pt-px">{sw}</span>
      <span className="min-w-0 select-none">
        <span className="block text-base text-fg">{label}</span>
        {description && <span className="block text-xs text-faint">{description}</span>}
      </span>
    </label>
  )
}

/** Tri-state toggle for optional booleans: unset / true / false. */
export function OptionalBool({
  value,
  onChange,
  label,
  description,
  defaultLabel = 'default',
}: {
  value: boolean | undefined
  onChange: (v: boolean | undefined) => void
  label: ReactNode
  description?: ReactNode
  defaultLabel?: string
}) {
  const opts: [string, boolean | undefined][] = [
    [defaultLabel, undefined],
    ['on', true],
    ['off', false],
  ]
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-base">{label}</div>
        {description && <div className="text-xs text-faint">{description}</div>}
      </div>
      <div className="flex shrink-0 rounded-md border border-line-strong bg-sunken p-0.5">
        {opts.map(([text, v]) => (
          <button
            key={text}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={cn(
              'h-5 rounded-[4px] px-2 text-xs transition-colors',
              value === v ? 'bg-surface text-fg shadow-xs' : 'text-faint hover:text-fg',
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Field({
  label,
  help,
  error,
  htmlFor,
  path,
  children,
  className,
  aside,
}: {
  label: ReactNode
  help?: ReactNode
  error?: ReactNode
  htmlFor?: string
  /** config path, used as an anchor for jumping to validation issues */
  path?: string
  children: ReactNode
  className?: string
  aside?: ReactNode
}) {
  const autoId = useId()
  const id = htmlFor ?? autoId
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      id={path ? `f-${path}` : undefined}
    >
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        {aside}
      </div>
      <FieldIdContext.Provider value={id}>{children}</FieldIdContext.Provider>
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : help ? (
        <p className="text-xs text-faint">{help}</p>
      ) : null}
    </div>
  )
}
