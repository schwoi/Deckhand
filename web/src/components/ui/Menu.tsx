import { Check, MoreHorizontal } from 'lucide-react'
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { cn } from '../../lib/util'
import { Button, type ButtonProps } from './Button'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  /** shows a check mark; for pick-one menus */
  active?: boolean
  /** draws a divider above this item */
  separator?: boolean
}

/**
 * Dropdown of actions. By default a "more" icon button; pass `trigger` for a custom button.
 * Closes on outside press and Escape.
 */
export function Menu({
  items,
  label = 'More actions',
  className,
  trigger,
  align = 'right',
}: {
  items: MenuItem[]
  label?: string
  className?: string
  trigger?: ButtonProps
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const els = [
      ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
    ]
    const at = els.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? els.length - 1
          : (at + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length
    els[next]?.focus()
  }

  return (
    <div ref={root} className={cn('relative', className)} onKeyDown={onKeyDown}>
      <Button
        ref={triggerRef}
        variant="ghost"
        iconOnly={!trigger}
        icon={<MoreHorizontal />}
        title={label}
        className="max-lg:min-h-10 max-lg:min-w-10 [&_svg]:size-4!"
        {...trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={cn(
            'absolute top-full z-40 mt-1 w-56 max-w-[calc(100vw-1.5rem)] animate-pop-in rounded-lg border border-line-strong bg-surface p-1 shadow-xl shadow-black/15',
            align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left',
          )}
        >
          {items.map((item) => (
            <Fragment key={item.label}>
              {item.separator && <hr className="my-1 border-line" />}
              <button
                type="button"
                role="menuitem"
                aria-checked={item.active}
                disabled={item.disabled}
                onClick={() => {
                  close()
                  item.onSelect()
                }}
                className={cn(
                  'flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-md outline-none transition-colors disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
                  item.danger
                    ? 'text-danger hover:bg-danger-soft focus-visible:bg-danger-soft'
                    : 'text-fg hover:bg-hover focus-visible:bg-hover',
                )}
              >
                <span className={item.danger ? undefined : 'text-faint'}>{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.active && <Check className="text-accent-text" />}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
