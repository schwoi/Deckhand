import type { RuntimeSession, StreamEvent } from '../api'

export type ToolStatus = 'pending' | 'running' | 'confirm' | 'done' | 'rejected' | 'stopped'

export type ChatItem =
  | { kind: 'user'; id: string; content: string }
  | { kind: 'assistant'; id: string; agent?: string; content: string; reasoning: string }
  | {
      kind: 'tool'
      id: string
      agent?: string
      name: string
      args: string
      response?: string
      status: ToolStatus
    }
  | { kind: 'error'; id: string; message: string }
  | { kind: 'note'; id: string; message: string }

let seq = 0
export const newId = () => `i${++seq}`

const agentOf = (e: StreamEvent) => e.agent ?? e.agent_name

function upsertTool(
  items: ChatItem[],
  id: string,
  patch: (t: Extract<ChatItem, { kind: 'tool' }> | undefined) => ChatItem,
): ChatItem[] {
  const idx = items.findIndex((i) => i.kind === 'tool' && i.id === id)
  if (idx === -1) return [...items, patch(undefined)]
  const cur = items[idx] as Extract<ChatItem, { kind: 'tool' }>
  return items.map((it, i) => (i === idx ? patch(cur) : it))
}

/** Pure reducer folding one SSE event into the transcript. */
export function applyEvent(items: ChatItem[], e: StreamEvent): ChatItem[] {
  switch (e.type) {
    case 'agent_choice':
    case 'agent_choice_reasoning': {
      if (!e.content) return items
      const agent = agentOf(e)
      const last = items[items.length - 1]
      const isText = e.type === 'agent_choice'
      // reasoning that arrives after visible text starts a new bubble
      if (last?.kind === 'assistant' && last.agent === agent && (isText || !last.content)) {
        const next = isText
          ? { ...last, content: last.content + e.content }
          : { ...last, reasoning: last.reasoning + e.content }
        return [...items.slice(0, -1), next]
      }
      return [
        ...items,
        {
          kind: 'assistant',
          id: newId(),
          agent,
          content: isText ? e.content : '',
          reasoning: isText ? '' : e.content,
        },
      ]
    }
    case 'partial_tool_call':
    case 'tool_call':
    case 'tool_call_confirmation': {
      const tc = e.tool_call
      if (!tc?.id) return items
      const incoming = tc.function?.arguments ?? ''
      return upsertTool(items, tc.id, (cur) => {
        // partial arguments may arrive as deltas or as the accumulated string
        const args =
          e.type !== 'partial_tool_call' || !cur
            ? incoming || cur?.args || ''
            : incoming.startsWith(cur.args)
              ? incoming
              : cur.args + incoming
        const status: ToolStatus =
          e.type === 'tool_call_confirmation'
            ? 'confirm'
            : e.type === 'tool_call'
              ? cur?.status === 'confirm' || cur?.status === 'done'
                ? cur.status
                : 'running'
              : (cur?.status ?? 'pending')
        return {
          kind: 'tool',
          id: tc.id,
          agent: cur?.agent ?? agentOf(e),
          name: tc.function?.name || cur?.name || 'tool',
          args,
          response: cur?.response,
          status,
        }
      })
    }
    case 'tool_call_response':
      return upsertTool(items, e.tool_call_id, (cur) => ({
        kind: 'tool',
        id: e.tool_call_id,
        agent: cur?.agent ?? agentOf(e),
        name: cur?.name ?? 'tool',
        args: cur?.args ?? '',
        response: e.response ?? '',
        status: cur?.status === 'rejected' ? 'rejected' : 'done',
      }))
    case 'error':
      return [...items, { kind: 'error', id: newId(), message: e.error || 'Unknown error' }]
    case 'stream_stopped':
      return e.reason === 'max_iterations'
        ? [...items, { kind: 'note', id: newId(), message: 'Stopped: reached max iterations.' }]
        : items
    case 'budget_exceeded':
      return [...items, { kind: 'note', id: newId(), message: 'Stopped: budget exceeded.' }]
    default:
      return items
  }
}

/** Mark tools that never finished (stream ended or was aborted) as stopped. */
export function settleTools(items: ChatItem[]): ChatItem[] {
  return items.map((i) =>
    i.kind === 'tool' &&
    (i.status === 'pending' || i.status === 'running' || i.status === 'confirm')
      ? { ...i, status: 'stopped' }
      : i,
  )
}

export function setToolStatus(items: ChatItem[], id: string, status: ToolStatus): ChatItem[] {
  return items.map((i) => (i.kind === 'tool' && i.id === id ? { ...i, status } : i))
}

/** Convert a stored session's messages into transcript items. */
export function historyToItems(session: RuntimeSession): ChatItem[] {
  let items: ChatItem[] = []
  for (const { agent_name: agent, message: m } of session.messages ?? []) {
    if (m.role === 'user') items.push({ kind: 'user', id: newId(), content: m.content ?? '' })
    else if (m.role === 'assistant') {
      if (m.content || m.reasoning_content)
        items.push({
          kind: 'assistant',
          id: newId(),
          agent,
          content: m.content ?? '',
          reasoning: m.reasoning_content ?? '',
        })
      for (const tc of m.tool_calls ?? [])
        items.push({
          kind: 'tool',
          id: tc.id,
          agent,
          name: tc.function?.name ?? 'tool',
          args: tc.function?.arguments ?? '',
          status: 'done',
        })
    } else if (m.role === 'tool' && m.tool_call_id) {
      const id = m.tool_call_id
      items = upsertTool(items, id, (cur) => ({
        kind: 'tool',
        id,
        agent: cur?.agent ?? agent,
        name: cur?.name ?? 'tool',
        args: cur?.args ?? '',
        response: m.content ?? '',
        status: 'done',
      }))
    }
  }
  return items
}
