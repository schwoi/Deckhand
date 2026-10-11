import { Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '../components/ui/Button'
import { cn } from '../lib/util'

const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

/** Card for one entry of a named map (models, providers, mcps) with an inline rename. */
export function NamedEntry({
  name,
  taken,
  onRename,
  onRemove,
  meta,
  children,
  path,
}: {
  name: string
  taken: string[]
  onRename: (to: string) => void
  onRemove: () => void
  meta?: ReactNode
  children: ReactNode
  path: string
}) {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const invalid = draft !== name && (!KEY_RE.test(draft) || taken.includes(draft))
  const commit = () => {
    if (draft !== name && !invalid) onRename(draft)
    else setDraft(name)
  }
  return (
    <div id={`f-${path}`} className="rounded-lg border bg-surface">
      <div className="flex items-center gap-3 border-b px-3 py-2">
        <input
          value={draft}
          aria-label="Name"
          aria-invalid={invalid}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setDraft(name)
          }}
          className={cn(
            'h-7 w-56 rounded-md border border-transparent bg-transparent px-2 font-mono text-base font-semibold hover:border-line focus:border-accent focus:bg-surface focus:outline-none',
            invalid && 'border-danger text-danger',
          )}
        />
        <div className="min-w-0 flex-1 truncate text-xs text-faint">{meta}</div>
        <Button
          size="xs"
          variant="danger-ghost"
          iconOnly
          icon={<Trash2 />}
          title="Remove"
          onClick={onRemove}
        />
      </div>
      <div className="flex flex-col gap-3 p-3.5">{children}</div>
    </div>
  )
}
