import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/util'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
type Size = 'xs' | 'sm' | 'md'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover border border-transparent shadow-xs',
  secondary: 'bg-surface text-fg border border-line-strong hover:bg-hover',
  ghost: 'text-muted hover:text-fg hover:bg-hover border border-transparent',
  danger: 'bg-danger text-white border border-transparent hover:opacity-90',
  'danger-ghost': 'text-danger hover:bg-danger-soft border border-transparent',
}
const sizes: Record<Size, string> = {
  xs: 'h-6 px-1.5 text-xs gap-1 rounded-[5px]',
  sm: 'h-7 px-2.5 text-sm gap-1.5 rounded-md',
  md: 'h-8 px-3 text-base gap-2 rounded-md',
}
const iconSizes: Record<Size, string> = { xs: 'size-6', sm: 'size-7', md: 'size-8' }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
  /** square icon-only button; pass a `title`/`aria-label` */
  iconOnly?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'sm',
  icon,
  loading,
  iconOnly,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-label={iconOnly ? (rest.title ?? rest['aria-label']) : rest['aria-label']}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0',
        variants[variant],
        iconOnly ? cn(iconSizes[size], 'rounded-md p-0') : sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </button>
  )
}
