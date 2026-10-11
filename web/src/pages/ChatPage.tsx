import type { AgentSummary } from '@shared/api'
import { ArrowUp, Bot, ChevronDown, MessageSquarePlus, Pencil, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Confirmation, type StreamEvent, type Usage, api, errorText } from '../api'
import { MessageList } from '../chat/MessageList'
import {
  type ChatItem,
  applyEvent,
  historyToItems,
  newId,
  setToolStatus,
  settleTools,
} from '../chat/model'
import { RuntimeGate } from '../components/RuntimeGate'
import { Button } from '../components/ui/Button'
import { Switch } from '../components/ui/form'
import { EmptyState, PageHeader, Skeleton, Spinner } from '../components/ui/misc'
import { toast } from '../components/ui/toast'
import { cn, formatCost, formatTokens } from '../lib/util'
import { href, navigate } from '../router'

export function ChatPage({ name, session }: { name?: string; session?: string }) {
  const [nonce, setNonce] = useState(0)
  if (!name) return <AgentPicker session={session} />
  return (
    <RuntimeGate purpose="Chat">
      <ChatView
        key={nonce}
        name={name}
        initialSession={session}
        onNewSession={() => {
          if (session) navigate(href.chat(name))
          else setNonce((n) => n + 1)
        }}
      />
    </RuntimeGate>
  )
}

function AgentPicker({ session }: { session?: string }) {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null)
  useEffect(() => {
    api.agents
      .list()
      .then(setAgents)
      .catch((e) => {
        toast.error(errorText(e))
        setAgents([])
      })
  }, [])
  const valid = agents?.filter((a) => a.valid) ?? []
  return (
    <>
      <PageHeader
        title="Chat"
        description={
          session ? 'Pick the agent to continue this session with.' : 'Pick an agent to talk to.'
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-xl flex-col gap-1.5">
          {!agents && [0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}
          {agents && valid.length === 0 && (
            <EmptyState
              icon={<Bot />}
              title="No runnable agents"
              description={
                agents.length
                  ? 'All agents have validation issues. Fix them in the editor first.'
                  : 'Create an agent first.'
              }
              action={<Button onClick={() => navigate(href.agents())}>Go to agents</Button>}
            />
          )}
          {valid.map((a) => (
            <a
              key={a.name}
              href={href.chat(a.name, session)}
              className="flex items-center gap-3 rounded-lg border bg-surface px-4 py-3 transition-colors hover:border-line-strong hover:bg-hover"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-text">
                <Bot className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-base font-medium">{a.name}</div>
                <div className="truncate text-sm text-muted">{a.description || a.rootModel}</div>
              </div>
              <span className="shrink-0 font-mono text-xs text-faint">{a.rootModel}</span>
            </a>
          ))}
          {agents && agents.length > valid.length && valid.length > 0 && (
            <p className="mt-2 text-center text-xs text-faint">
              {agents.length - valid.length} agent
              {agents.length - valid.length === 1 ? ' is' : 's are'} hidden because of validation
              issues.
            </p>
          )}
        </div>
      </div>
    </>
  )
}

interface Command {
  name: string
  prompt: string
}

function normalizeCommands(raw: unknown): Command[] {
  const fromEntry = (k: string, v: unknown): Command => ({
    name: k,
    prompt:
      typeof v === 'string'
        ? v
        : v && typeof v === 'object' && 'instruction' in v && typeof v.instruction === 'string'
          ? v.instruction
          : '',
  })
  if (Array.isArray(raw))
    return raw.flatMap((c) =>
      typeof c === 'string'
        ? [{ name: c, prompt: '' }]
        : c && typeof c === 'object'
          ? 'name' in c && typeof c.name === 'string'
            ? [fromEntry(c.name, c)]
            : Object.entries(c).map(([k, v]) => fromEntry(k, v))
          : [],
    )
  if (raw && typeof raw === 'object') return Object.entries(raw).map(([k, v]) => fromEntry(k, v))
  return []
}

function ChatView({
  name,
  initialSession,
  onNewSession,
}: { name: string; initialSession?: string; onNewSession: () => void }) {
  const [items, setItems] = useState<ChatItem[]>([])
  const [sessionId, setSessionId] = useState<string | undefined>(initialSession)
  const [title, setTitle] = useState('')
  const [loadingHistory, setLoadingHistory] = useState(!!initialSession)
  const [streaming, setStreaming] = useState(false)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [autoApprove, setAutoApprove] = useState(false)
  const [commands, setCommands] = useState<Command[]>([])
  const [description, setDescription] = useState('')
  const [draft, setDraft] = useState('')
  const [rootAgent, setRootAgent] = useState<string | undefined>()
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let live = true
    api.rt
      .agents()
      .then((list) => {
        if (!live) return
        const entry = list.find((a) => a.name === name)
        if (!entry) toast.error(`The runtime does not know an agent named ${name}`)
        setCommands(normalizeCommands(entry?.commands))
        setDescription(entry?.description ?? '')
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [name])

  useEffect(() => {
    if (!initialSession) return
    let live = true
    api.rt
      .session(initialSession)
      .then((s) => {
        if (!live) return
        const hist = historyToItems(s)
        setItems(hist)
        setTitle(s.title)
        setAutoApprove(!!s.tools_approved)
        setUsage({ input_tokens: s.input_tokens, output_tokens: s.output_tokens, cost: s.cost })
        const first = hist.find((i) => i.kind === 'assistant' || i.kind === 'tool')
        if (first && 'agent' in first) setRootAgent(first.agent)
      })
      .catch((e) => live && toast.error(`Could not load session: ${errorText(e)}`))
      .finally(() => live && setLoadingHistory(false))
    return () => {
      live = false
    }
  }, [initialSession])

  useEffect(() => () => abortRef.current?.abort(), [])

  // the composer is disabled while streaming; focus it once it is enabled again
  useEffect(() => {
    if (!streaming) inputRef.current?.focus()
  }, [streaming])

  // biome-ignore lint/correctness/useExhaustiveDependencies: resize the composer as the draft changes
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [draft])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the transcript changes
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [items])

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || streaming) return
    setDraft('')
    setItems((prev) => [...prev, { kind: 'user', id: newId(), content }])
    setStreaming(true)
    stickToBottom.current = true
    const ctl = new AbortController()
    abortRef.current = ctl
    try {
      let id = sessionId
      if (!id) {
        const s = await api.rt.createSession(content.slice(0, 60))
        id = s.id
        setSessionId(id)
        setTitle(s.title)
        if (autoApprove) await api.rt.toggleTools(id)
      }
      const root = id
      const onEvent = (e: StreamEvent) => {
        const mine = !e.session_id || e.session_id === root
        const agent = e.agent ?? e.agent_name
        if (
          mine &&
          agent &&
          (e.type === 'agent_choice' ||
            e.type === 'tool_call' ||
            e.type === 'agent_choice_reasoning')
        )
          setRootAgent((r) => r ?? agent)
        if (e.type === 'session_title' && mine) setTitle(e.title)
        if (e.type === 'token_usage' && mine) setUsage(e.usage)
        setItems((prev) => applyEvent(prev, e))
      }
      await api.rt.stream(id, name, content, onEvent, ctl.signal)
    } catch (e) {
      if (ctl.signal.aborted)
        setItems((prev) => [...prev, { kind: 'note', id: newId(), message: 'Stopped.' }])
      else setItems((prev) => [...prev, { kind: 'error', id: newId(), message: errorText(e) }])
    } finally {
      setItems(settleTools)
      setStreaming(false)
      abortRef.current = null
    }
  }

  const confirm = async (tool: Extract<ChatItem, { kind: 'tool' }>, decision: Confirmation) => {
    if (!sessionId) return
    setItems((prev) => setToolStatus(prev, tool.id, decision === 'reject' ? 'rejected' : 'running'))
    try {
      await api.rt.resume(sessionId, decision, decision === 'approve-tool' ? tool.name : undefined)
      if (decision === 'approve-autonomous') setAutoApprove(true)
    } catch (e) {
      setItems((prev) => setToolStatus(prev, tool.id, 'confirm'))
      toast.error(`Could not resume: ${errorText(e)}`)
    }
  }

  const toggleAuto = async (v: boolean) => {
    if (!sessionId) {
      setAutoApprove(v)
      return
    }
    try {
      await api.rt.toggleTools(sessionId)
      setAutoApprove(v)
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  const empty = items.length === 0 && !loadingHistory

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-surface px-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <a
              href={href.chat()}
              className="flex items-center gap-1 rounded font-mono text-md font-semibold hover:text-accent-text"
              title="Switch agent"
            >
              {name}
              <ChevronDown className="size-3.5 text-faint" />
            </a>
            <a href={href.editor(name)} className="text-faint hover:text-fg" title="Edit agent">
              <Pencil className="size-3.5" />
            </a>
          </div>
          <p className="truncate text-xs text-muted">
            {title || (sessionId ? 'Untitled session' : 'New session')}
          </p>
        </div>
        <Switch
          checked={autoApprove}
          onChange={toggleAuto}
          label="Auto-approve tools"
          description={autoApprove ? 'Tool calls run without asking' : undefined}
        />
        <Button
          icon={<MessageSquarePlus />}
          onClick={onNewSession}
          disabled={streaming && !sessionId}
        >
          New session
        </Button>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl px-6 py-6">
          {loadingHistory && <Spinner label="Loading session…" />}
          {empty && (
            <div className="flex flex-col items-center py-16 text-center">
              <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                <Bot className="size-5" />
              </div>
              <h2 className="text-md font-semibold">Chat with {name}</h2>
              {description && <p className="mt-1 max-w-md text-base text-muted">{description}</p>}
            </div>
          )}
          <MessageList
            items={items}
            rootAgent={rootAgent ?? 'root'}
            streaming={streaming}
            onConfirm={confirm}
          />
        </div>
      </div>

      <div className="shrink-0 border-t bg-surface">
        <div className="mx-auto max-w-3xl px-6 pt-3 pb-2">
          {commands.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {commands.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  title={c.prompt || c.name}
                  onClick={() => {
                    setDraft(c.prompt || c.name)
                    inputRef.current?.focus()
                  }}
                  className="h-6 rounded-full border bg-sunken px-2.5 font-mono text-xs text-muted hover:border-line-strong hover:text-fg"
                >
                  /{c.name}
                </button>
              ))}
            </div>
          )}
          <div className="control flex items-end gap-2 p-1.5 pl-3">
            <textarea
              ref={inputRef}
              // biome-ignore lint/a11y/noAutofocus: primary input of this view
              autoFocus
              rows={1}
              value={draft}
              disabled={streaming}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  send(draft)
                }
              }}
              placeholder={streaming ? 'Waiting for the agent…' : `Message ${name}`}
              aria-label="Message"
              className="max-h-[220px] min-h-7 flex-1 resize-none bg-transparent py-1 text-md outline-none placeholder:text-faint disabled:opacity-60"
            />
            {streaming ? (
              <Button
                variant="secondary"
                iconOnly
                icon={<Square />}
                title="Stop"
                onClick={() => abortRef.current?.abort()}
              />
            ) : (
              <Button
                variant="primary"
                iconOnly
                icon={<ArrowUp />}
                title="Send"
                disabled={!draft.trim()}
                onClick={() => send(draft)}
              />
            )}
          </div>
          <div className="flex items-center justify-between px-1 pt-1.5 text-2xs text-faint">
            <span>Enter to send · Shift+Enter for a new line</span>
            <UsageLine usage={usage} />
          </div>
        </div>
      </div>
    </>
  )
}

function UsageLine({ usage }: { usage: Usage | null }) {
  if (!usage) return null
  const ctx =
    usage.context_length && usage.context_limit ? usage.context_length / usage.context_limit : null
  return (
    <span className="flex items-center gap-2.5 font-mono tabular-nums">
      <span title="Input tokens">in {formatTokens(usage.input_tokens)}</span>
      <span title="Output tokens">out {formatTokens(usage.output_tokens)}</span>
      {ctx !== null && (
        <span
          title={`Context ${usage.context_length} / ${usage.context_limit}`}
          className={cn(ctx > 0.8 && 'text-warning')}
        >
          ctx {Math.round(ctx * 100)}%
        </span>
      )}
      <span title="Cost">{formatCost(usage.cost)}</span>
    </span>
  )
}
