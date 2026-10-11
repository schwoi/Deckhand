import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { cn } from '../../lib/util'

type Kind = 'success' | 'error' | 'info'
interface Toast {
  id: number
  kind: Kind
  message: string
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

function push(kind: Kind, message: string) {
  const id = nextId++
  toasts = [...toasts.slice(-3), { id, kind, message }]
  emit()
  window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3500)
}

export const toast = {
  success: (m: string) => push('success', m),
  error: (m: string) => push('error', m),
  info: (m: string) => push('info', m),
}

const icons = { success: CircleCheck, error: CircleAlert, info: Info }
const tones = { success: 'text-success', error: 'text-danger', info: 'text-accent-text' }

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts)
  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-50 flex flex-col gap-2 sm:left-auto sm:w-[360px] lg:bottom-4"
      aria-live="polite"
    >
      {list.map((t) => {
        const Icon = icons[t.kind]
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex animate-pop-in items-start gap-2.5 rounded-lg border border-line-strong bg-surface px-3 py-2.5 shadow-lg shadow-black/5"
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', tones[t.kind])} />
            <p className="min-w-0 flex-1 break-words text-base">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="-mr-1 rounded p-0.5 text-faint hover:text-fg max-lg:-my-1.5 max-lg:p-1.5"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
