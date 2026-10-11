import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from 'react'
import { cn } from '../../lib/util'
import { Button } from './Button'

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      // React's autoFocus runs before showModal, so focus the intended control explicitly.
      el.querySelector<HTMLElement>(
        '[data-autofocus], [autofocus], .dialog-body input, .dialog-body textarea',
      )?.focus()
    }
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className={cn(
        'overflow-hidden border border-line-strong bg-surface p-0 text-fg shadow-2xl shadow-black/20 open:flex open:flex-col',
        // phone: bottom sheet
        'mx-0 mt-auto mb-0 max-h-[90dvh] w-full max-w-none rounded-t-2xl border-b-0 pb-[env(safe-area-inset-bottom)] max-sm:pr-[env(safe-area-inset-right)] max-sm:pl-[env(safe-area-inset-left)] max-sm:open:animate-sheet-in',
        // tablet and up: centered card
        'sm:m-auto sm:max-h-[85dvh] sm:w-[calc(100vw-2rem)] sm:rounded-xl sm:border-b sm:pb-0 sm:open:animate-pop-in',
        { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }[width],
      )}
    >
      {open && (
        <>
          <div
            aria-hidden
            className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden"
          />
          <header className="flex items-start gap-3 border-b px-4 py-3 sm:px-5 sm:py-3.5">
            <div className="min-w-0 flex-1">
              <h2 className="text-md font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
            </div>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<X />}
              title="Close"
              onClick={onClose}
              className="-mr-2"
            />
          </header>
          <div className="dialog-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            {children}
          </div>
          {footer && (
            <footer className="flex flex-col-reverse gap-2 border-t bg-sunken/60 px-4 py-3 sm:flex-row sm:justify-end sm:px-5 max-sm:*:min-h-11 max-sm:*:w-full">
              {footer}
            </footer>
          )}
        </>
      )}
    </dialog>
  )
}

// ---- Imperative confirm dialog ----

interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
}
interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}
let pending: Pending | null = null
const listeners = new Set<() => void>()

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  pending?.resolve(false)
  return new Promise((resolve) => {
    pending = { ...opts, resolve }
    for (const l of listeners) l()
  })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function ConfirmHost() {
  const shown = useSyncExternalStore(subscribe, () => pending)
  const done = (ok: boolean) => {
    shown?.resolve(ok)
    pending = null
    for (const l of listeners) l()
  }
  return (
    <Dialog
      open={!!shown}
      onClose={() => done(false)}
      title={shown?.title ?? ''}
      width="sm"
      footer={
        <>
          <Button onClick={() => done(false)}>Cancel</Button>
          <Button
            variant={shown?.danger ? 'danger' : 'primary'}
            onClick={() => done(true)}
            data-autofocus
          >
            {shown?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {shown?.message && <div className="text-base text-muted">{shown.message}</div>}
    </Dialog>
  )
}
