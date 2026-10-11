import { ChevronRight, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/util'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
const tones: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted border-line',
  accent: 'bg-accent-soft text-accent-text border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  title,
}: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-2xs font-medium [&_svg]:size-3',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Dot({ tone }: { tone: Tone }) {
  const c = {
    neutral: 'bg-faint',
    accent: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  }[tone]
  return <span className={cn('inline-block size-1.5 shrink-0 rounded-full', c)} />
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border bg-surface', className)}>{children}</div>
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
}: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b px-4 py-3">
      {icon && <div className="text-faint [&_svg]:size-4">{icon}</div>}
      <div className="min-w-0 flex-1">
        <h3 className="text-md font-semibold">{title}</h3>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
  )
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-muted', className)}>
      <Loader2 className="size-4 animate-spin" />
      {label && <span className="text-sm">{label}</span>}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}
    >
      {icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-surface text-faint [&_svg]:size-5">
          {icon}
        </div>
      )}
      <h3 className="text-md font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-base text-muted">{description}</p>}
      {action && <div className="mt-4 flex gap-2">{action}</div>}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T
  onChange: (v: T) => void
  tabs: { value: T; label: ReactNode }[]
  className?: string
}) {
  return (
    <div role="tablist" className={cn('inline-flex rounded-md border bg-sunken p-0.5', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'h-6 rounded-[5px] px-2.5 text-sm font-medium transition-colors',
            value === t.value ? 'bg-surface text-fg shadow-xs' : 'text-muted hover:text-fg',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Disclosure({
  title,
  children,
  defaultOpen,
  className,
}: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  return (
    <details open={defaultOpen} className={cn('group', className)}>
      <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 rounded text-sm font-medium text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-line-strong bg-sunken px-1 font-sans text-2xs text-faint">
      {children}
    </kbd>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-sunken px-1 py-px font-mono text-[0.92em] text-fg">{children}</code>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-surface px-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-md font-semibold">{title}</h1>
        {description && <p className="truncate text-xs text-muted">{description}</p>}
      </div>
      {children}
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function OutputBox({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={cn(
        'max-h-72 overflow-auto rounded-md border bg-sunken p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-muted',
        className,
      )}
    >
      {text || '(no output)'}
    </pre>
  )
}
