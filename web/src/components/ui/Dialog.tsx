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
        'm-auto max-h-[85vh] w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line-strong bg-surface p-0 text-fg shadow-2xl shadow-black/20 open:flex open:animate-pop-in open:flex-col',
        { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[width],
      )}
    >
      {open && (
        <>
          <header className="flex items-start gap-3 border-b px-5 py-3.5">
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
          <div className="dialog-body min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="flex justify-end gap-2 border-t bg-sunken/60 px-5 py-3">
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
