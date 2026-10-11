import { WandSparkles } from 'lucide-react'
import { type KeyboardEvent, useLayoutEffect, useRef } from 'react'
import { Button } from '../components/ui/Button'
import { cn } from '../lib/util'

export interface ParseError {
  message: string
  line?: number
}

/** Plain textarea with a line-number gutter. Tab indents by two spaces (Esc, then Tab, to leave). */
export function YamlEditor({
  value,
  onChange,
  error,
  onFormat,
}: {
  value: string
  onChange: (v: string) => void
  error: ParseError | null
  onFormat: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const pendingSelection = useRef<[number, number] | null>(null)
  const escaped = useRef(false)
  const lines = value.split('\n').length

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 14}px`
    if (pendingSelection.current) {
      el.setSelectionRange(...pendingSelection.current)
      pendingSelection.current = null
    }
  }, [value])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      escaped.current = true
      return
    }
    if (e.key !== 'Tab' || escaped.current) {
      escaped.current = false
      return
    }
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart: s, selectionEnd: end } = el
    if (s === end && !e.shiftKey) {
      pendingSelection.current = [s + 2, s + 2]
      onChange(`${value.slice(0, s)}  ${value.slice(end)}`)
      return
    }
    const lineStart = value.lastIndexOf('\n', s - 1) + 1
    let blockEnd = end
    if (s === end) {
      // collapsed Shift+Tab: dedent the whole current line
      const nl = value.indexOf('\n', s)
      blockEnd = nl === -1 ? value.length : nl
    } else if (value[end - 1] === '\n') {
      // whole-line selections end at the start of the next line; leave that line alone
      blockEnd = end - 1
    }
    const block = value.slice(lineStart, blockEnd)
    const blockLines = block.split('\n')
    const changed = e.shiftKey
      ? blockLines.map((l) => l.replace(/^ {1,2}/, ''))
      : blockLines.map((l) => `  ${l}`)
    const next = changed.join('\n')
    if (next === block) return
    const firstDelta = (changed[0]?.length ?? 0) - (blockLines[0]?.length ?? 0)
    const start = Math.max(lineStart, s + firstDelta)
    pendingSelection.current = [start, s === end ? start : end + (next.length - block.length)]
    onChange(value.slice(0, lineStart) + next + value.slice(blockEnd))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b bg-surface px-4 py-2">
        <p className="flex-1 text-xs text-faint">
          Edits in the form rewrite this YAML (comments are not preserved).{' '}
          <span className="hidden xl:inline">Tab indents · Esc then Tab leaves the editor.</span>
        </p>
        <Button size="xs" icon={<WandSparkles />} onClick={onFormat} disabled={!!error}>
          Format
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="shrink-0 border-b border-danger/30 bg-danger-soft px-4 py-2 font-mono text-xs whitespace-pre-wrap text-danger"
        >
          {error.line ? `Line ${error.line}: ` : ''}
          {error.message}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-surface">
        <div className="flex min-h-full font-mono text-sm leading-[20px]">
          <div
            aria-hidden
            className="shrink-0 border-r bg-sunken py-3 pr-2 pl-3 text-right text-faint select-none"
          >
            {Array.from({ length: lines }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: line numbers
              <div key={i} className={cn(error?.line === i + 1 && 'font-semibold text-danger')}>
                {i + 1}
              </div>
            ))}
          </div>
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            wrap="off"
            aria-label="YAML source"
            className="min-w-0 flex-1 resize-none overflow-x-auto overflow-y-hidden bg-transparent px-4 py-3 outline-none"
          />
        </div>
      </div>
    </div>
  )
}
