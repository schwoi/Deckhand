import {
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  Info,
  Loader2,
  ShieldQuestion,
  Wrench,
  X,
} from 'lucide-react'
import { useState } from 'react'
import type { Confirmation } from '../api'
import { Button } from '../components/ui/Button'
import { cn, prettyJson } from '../lib/util'
import { Markdown } from './Markdown'
import type { ChatItem } from './model'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

export function MessageList({
  items,
  rootAgent,
  streaming,
  onConfirm,
}: {
  items: ChatItem[]
  /** agent name of the top-level agent; other agents get a label */
  rootAgent?: string
  streaming?: boolean
  onConfirm?: (tool: ToolItem, decision: Confirmation) => void
}) {
  const last = items[items.length - 1]
  const waiting =
    streaming && (!last || last.kind === 'user' || (last.kind === 'tool' && last.status === 'done'))
  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => {
        const label =
          'agent' in item && item.agent && rootAgent && item.agent !== rootAgent ? item.agent : null
        switch (item.kind) {
          case 'user':
            return (
              <div key={item.id} className="flex justify-end">
                <div className="max-w-[90%] min-w-0 rounded-xl rounded-br-sm border sm:max-w-[85%] bg-sunken px-3.5 py-2 text-md whitespace-pre-wrap break-words">
                  {item.content}
                </div>
              </div>
            )
          case 'assistant':
            return (
              <div
                key={item.id}
                className={cn(
                  'flex min-w-0 flex-col gap-1.5',
                  label && 'border-l-2 border-accent/40 pl-3',
                )}
              >
                {label && <AgentLabel name={label} />}
                {item.reasoning && (
                  <Reasoning
                    text={item.reasoning}
                    live={streaming && item === last && !item.content}
                  />
                )}
                {item.content && <Markdown text={item.content} />}
              </div>
            )
          case 'tool':
            return (
              <div
                key={item.id}
                className={cn('min-w-0', label && 'border-l-2 border-accent/40 pl-3')}
              >
                {label && <AgentLabel name={label} />}
                <ToolCard tool={item} onConfirm={onConfirm} />
              </div>
            )
          case 'error':
            return (
              <div
                key={item.id}
                role="alert"
                className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span className="break-words">{item.message}</span>
              </div>
            )
          case 'note':
            return (
              <div key={item.id} className="flex items-center gap-2 text-xs text-faint">
                <Info className="size-3.5" />
                {item.message}
              </div>
            )
        }
      })}
      {waiting && (
        <div className="flex items-center gap-1 py-1" aria-label="Agent is working">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-1.5 animate-pulse rounded-full bg-faint"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AgentLabel({ name }: { name: string }) {
  return (
    <div className="mb-1 font-mono text-2xs font-medium tracking-wide text-accent-text">{name}</div>
  )
}

function Reasoning({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs text-faint hover:text-fg max-lg:min-h-8"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        <Brain className="size-3.5" />
        {live ? 'Thinking…' : 'Thought process'}
      </button>
      {open && (
        <div className="mt-1.5 border-l-2 pl-3 text-sm whitespace-pre-wrap text-muted italic">
          {text}
        </div>
      )}
    </div>
  )
}

const statusIcon = {
  pending: <Loader2 className="size-3.5 animate-spin text-faint" />,
  running: <Loader2 className="size-3.5 animate-spin text-accent-text" />,
  confirm: <ShieldQuestion className="size-3.5 text-warning" />,
  done: <Check className="size-3.5 text-success" />,
  rejected: <X className="size-3.5 text-danger" />,
  stopped: <X className="size-3.5 text-faint" />,
}
const statusText = {
  pending: 'preparing',
  running: 'running',
  confirm: 'needs approval',
  done: 'done',
  rejected: 'rejected',
  stopped: 'stopped',
}

function ToolCard({
  tool,
  onConfirm,
}: { tool: ToolItem; onConfirm?: (t: ToolItem, d: Confirmation) => void }) {
  const [showResponse, setShowResponse] = useState(false)
  const args = prettyJson(tool.args)
  const confirming = tool.status === 'confirm'
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-surface',
        confirming && 'border-warning/60 ring-3 ring-warning/15',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 max-lg:py-2">
        <Wrench className="size-3.5 shrink-0 text-faint" />
        <span className="min-w-0 truncate font-mono text-sm font-medium" title={tool.name}>
          {tool.name}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-faint">
          {statusIcon[tool.status]}
          {statusText[tool.status]}
        </span>
      </div>
      {args && args !== '{}' && (
        <pre className="max-h-48 overflow-auto border-t bg-sunken/60 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-muted">
          {args}
        </pre>
      )}
      {confirming && onConfirm && (
        <div className="flex flex-col gap-2 border-t bg-warning-soft/50 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-1.5 sm:py-2 max-sm:*:min-h-10">
          <span className="text-sm font-medium sm:mr-auto">Allow this tool call?</span>
          <Button size="xs" variant="primary" onClick={() => onConfirm(tool, 'approve')}>
            Approve
          </Button>
          <Button
            size="xs"
            onClick={() => onConfirm(tool, 'approve-tool')}
            title={`Approve every ${tool.name} call in this session`}
            className="min-w-0"
          >
            <span className="truncate">Approve all {tool.name}</span>
          </Button>
          <Button
            size="xs"
            onClick={() => onConfirm(tool, 'approve-autonomous')}
            title="Approve every tool call for the rest of this session"
          >
            Always approve
          </Button>
          <Button size="xs" variant="danger-ghost" onClick={() => onConfirm(tool, 'reject')}>
            Reject
          </Button>
        </div>
      )}
      {tool.response !== undefined && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => setShowResponse((s) => !s)}
            aria-expanded={showResponse}
            className="flex w-full min-w-0 items-center gap-1.5 px-3 py-1 text-left text-xs text-faint hover:text-fg max-lg:py-2.5"
          >
            <ChevronRight
              className={cn('size-3 shrink-0 transition-transform', showResponse && 'rotate-90')}
            />
            Response
            <span className="min-w-0 truncate font-mono text-2xs opacity-70">
              {showResponse ? '' : tool.response.slice(0, 120)}
            </span>
          </button>
          {showResponse && (
            <pre className="max-h-72 overflow-auto px-3 pb-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-muted">
              {prettyJson(tool.response) || '(empty)'}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
