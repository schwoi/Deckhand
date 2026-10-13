import { removeAgent, renameAgent } from '@shared/agent-refs'
import type { AgentConfig, AgentFile, Json } from '@shared/config'
import { SAFETY_MODES } from '@shared/config'
import { defaultEntry } from '@shared/topology'
import { Plus, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import type { Option } from '../components/ui/Combobox'
import { Combobox } from '../components/ui/Combobox'
import { confirmDialog } from '../components/ui/Dialog'
import { Field, Input, NumberInput, Select, Switch, Textarea } from '../components/ui/form'
import { KeyValueEditor, TagInput } from '../components/ui/lists'
import { Badge, Code, Disclosure } from '../components/ui/misc'
import { NAME_RE, cn, uniqueKey, withField } from '../lib/util'
import { ToolsetList } from './Toolsets'
import { SAFETY_INFO } from './catalog'
import { useDoctor } from './hooks'

export function orderedAgentNames(config: AgentFile): string[] {
  const names = Object.keys(config.agents ?? {})
  return names.includes('root') ? ['root', ...names.filter((n) => n !== 'root')] : names
}

/** Name and body for a new agent: `root` first, then `agent`, `agent2`…, with the entry's model. */
export function newAgentDefaults(config: AgentFile): { name: string; agent: AgentConfig } {
  const names = orderedAgentNames(config)
  const name = uniqueKey(names, names.length === 0 ? 'root' : 'agent')
  const model = config.agents?.[names[0] ?? '']?.model
  return { name, agent: model ? { model } : {} }
}

/** Why `name` can't be used for an agent, if it can't. */
export function agentNameError(config: AgentFile, name: string): string | undefined {
  if (!NAME_RE.test(name)) return 'Invalid name'
  if (Object.hasOwn(config.agents ?? {}, name)) return 'Name already used'
}

export function AgentsSection({
  config,
  onChange,
  selected,
  onSelect,
}: {
  config: AgentFile
  onChange: (c: AgentFile) => void
  selected: string
  onSelect: (name: string) => void
}) {
  const agents = config.agents ?? {}
  const names = orderedAgentNames(config)
  const current = names.includes(selected) ? selected : names[0]
  const entry = defaultEntry(Object.keys(agents))
  const tabs = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: keep the selected tab in view when it changes
  useEffect(() => {
    tabs.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  const add = () => {
    const { name, agent } = newAgentDefaults(config)
    onChange({ ...config, agents: { ...agents, [name]: agent } })
    onSelect(name)
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        ref={tabs}
        className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0"
        role="tablist"
        aria-label="Agents"
      >
        {names.map((n) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={n === current}
            onClick={() => onSelect(n)}
            className={cn(
              'flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-mono text-sm whitespace-nowrap transition-colors max-lg:h-9 max-lg:px-3',
              n === current
                ? 'border-accent bg-accent-soft text-accent-text'
                : 'bg-surface text-muted hover:text-fg',
            )}
          >
            {n}
            {n === entry && <span className="font-sans text-2xs opacity-70">entry</span>}
          </button>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={add}>
          Add agent
        </Button>
      </div>
      {current && agents[current] ? (
        <AgentForm
          key={current}
          name={current}
          config={config}
          onChange={onChange}
          onRenamed={onSelect}
          entry={current === entry}
        />
      ) : (
        <p className="text-muted">No agents defined.</p>
      )}
    </div>
  )
}

export function AgentForm({
  name,
  config,
  onChange,
  onRenamed,
  onRemoved,
  entry,
}: {
  name: string
  config: AgentFile
  onChange: (c: AgentFile) => void
  onRenamed: (n: string) => void
  /** called after removal; defaults to selecting the first remaining agent via onRenamed */
  onRemoved?: () => void
  entry?: boolean
}) {
  const agents = config.agents
  const agent: AgentConfig = agents[name] ?? {}
  const others = Object.keys(agents).filter((n) => n !== name)
  const path = `agents.${name}`
  const auto = useDoctor()?.auto_model

  const setAgent = (next: AgentConfig) =>
    onChange({ ...config, agents: { ...agents, [name]: next } })
  const set = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) =>
    setAgent(withField(agent, k, v))

  const [draftName, setDraftName] = useState(name)
  useEffect(() => setDraftName(name), [name])
  const nameErr = draftName === name ? undefined : agentNameError(config, draftName)
  const commitRename = () => {
    if (draftName === name || nameErr) {
      setDraftName(name)
      return
    }
    onChange(renameAgent(config, name, draftName))
    onRenamed(draftName)
  }

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Remove agent ${name}?`,
      message:
        'References to it in sub_agents, handoffs, force_handoff and routing are removed too.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    const next = removeAgent(config, name)
    onChange(next)
    if (onRemoved) onRemoved()
    else onRenamed(Object.keys(next.agents)[0] ?? '')
  }

  // Only what this file configures, plus `auto` (docker-agent picks at runtime). Inline
  // provider/model strings still work by typing them.
  const modelOptions = useMemo<Option[]>(
    () => [
      ...Object.entries(config.models ?? {}).map(([k, m]) => ({
        value: k,
        hint: [m.provider, m.model].filter(Boolean).join('/'),
        group: 'Models in this file',
      })),
      {
        value: 'auto',
        hint: auto ? `picks ${auto.provider}/${auto.model}` : 'docker agent picks one',
        group: 'Default',
      },
    ],
    [config.models, auto],
  )

  const agentOptions = others.map((n) => ({ value: n, hint: agents[n]?.description }))
  const instruction = Array.isArray(agent.instruction)
    ? agent.instruction.join('\n\n')
    : (agent.instruction ?? '')
  const [monoInstruction, setMonoInstruction] = useState(false)

  const commands = agent.commands ?? {}
  const simpleCommands: Record<string, string> = {}
  const complexCommands: Record<string, Json> = {}
  for (const [k, v] of Object.entries(commands)) {
    if (typeof v === 'string') simpleCommands[k] = v
    else complexCommands[k] = v
  }
  const commandsIsList = Array.isArray(agent.commands)

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Agent name" htmlFor="agent-name" error={nameErr} className="w-full sm:w-64">
            <Input
              id="agent-name"
              mono
              value={draftName}
              aria-invalid={!!nameErr}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setDraftName(name)
              }}
            />
          </Field>
          {entry && (
            <span className="pb-2 text-sm text-faint">
              <Badge tone="accent">entry point</Badge>
            </span>
          )}
          <div className="ml-auto pb-0.5">
            <Button
              variant="danger-ghost"
              size="sm"
              icon={<Trash2 />}
              onClick={remove}
              disabled={others.length === 0}
            >
              Remove agent
            </Button>
          </div>
        </div>
        <Field
          label="Model"
          path={`${path}.model`}
          help={
            <>
              A named model from the Models section, or inline <Code>provider/model</Code> such as{' '}
              <Code>anthropic/claude-sonnet-4-5</Code>. Comma-separate several to alternate between
              them.
            </>
          }
        >
          <Combobox
            mono
            value={agent.model ?? ''}
            onChange={(v) => set('model', v)}
            options={modelOptions}
            placeholder="openai/gpt-5-mini"
          />
        </Field>
        <Field
          label="Description"
          path={`${path}.description`}
          help="Shown to parent agents when they decide whom to delegate to."
        >
          <Input
            value={agent.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What this agent does"
          />
        </Field>
        <Field
          label="Instruction"
          path={`${path}.instruction`}
          help="The system prompt."
          aside={
            <button
              type="button"
              onClick={() => setMonoInstruction((m) => !m)}
              className="text-xs text-faint hover:text-fg max-lg:-my-2 max-lg:py-2"
            >
              {monoInstruction ? 'Proportional' : 'Monospace'}
            </button>
          }
        >
          <Textarea
            autoGrow
            minRows={5}
            mono={monoInstruction}
            value={instruction}
            onChange={(e) => set('instruction', e.target.value)}
            placeholder="You are a helpful assistant…"
          />
        </Field>
      </section>

      <section className="flex flex-col gap-2" id={`f-${path}.toolsets`}>
        <SectionTitle title="Toolsets" description="Tools this agent can call." />
        <ToolsetList
          value={agent.toolsets}
          onChange={(v) => set('toolsets', v)}
          mcpNames={Object.keys(config.mcps ?? {})}
          path={`${path}.toolsets`}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Sub-agents"
          path={`${path}.sub_agents`}
          help={
            <>
              Agents this one can delegate tasks to. External refs like <Code>org/agent:tag</Code>{' '}
              work too.
            </>
          }
        >
          <TagInput
            mono
            value={agent.sub_agents}
            onChange={(v) => set('sub_agents', v)}
            suggestions={agentOptions}
            placeholder="Add agent…"
          />
        </Field>
        <Field
          label="Handoffs"
          path={`${path}.handoffs`}
          help="Agents this one can hand the whole conversation to."
        >
          <TagInput
            mono
            value={agent.handoffs}
            onChange={(v) => set('handoffs', v)}
            suggestions={agentOptions}
            placeholder="Add agent…"
          />
        </Field>
        <Field
          label="Forced handoff"
          path={`${path}.force_handoff`}
          help="Always receives the conversation when this agent gives its final answer."
        >
          <Combobox
            mono
            value={agent.force_handoff ?? ''}
            onChange={(v) => set('force_handoff', v.trim() || undefined)}
            options={agentOptions}
            placeholder="none"
          />
        </Field>
      </section>

      <section className="flex flex-col gap-2" id={`f-${path}.commands`}>
        <SectionTitle title="Commands" description="Named prompts users can run with /name." />
        {commandsIsList ? (
          <p className="text-sm text-muted">
            Commands are defined as a list; edit them in the YAML tab.
          </p>
        ) : (
          <>
            <KeyValueEditor
              value={simpleCommands}
              onChange={(v) => set('commands', { ...v, ...complexCommands })}
              keyPlaceholder="name"
              valuePlaceholder="Prompt to send"
              addLabel="Add command"
              multilineValues
            />
            {Object.keys(complexCommands).length > 0 && (
              <p className="text-xs text-faint">
                {Object.keys(complexCommands).join(', ')} use the advanced form and are edited in
                YAML.
              </p>
            )}
          </>
        )}
      </section>

      <Disclosure title="Advanced" className="border-t pt-4">
        <AdvancedAgentFields agent={agent} set={set} path={path} />
      </Disclosure>
    </div>
  )
}

function AdvancedAgentFields({
  agent,
  set,
  path,
}: {
  agent: AgentConfig
  set: <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) => void
  path: string
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Safety"
          path={`${path}.safety`}
          help={
            agent.safety ? SAFETY_INFO[agent.safety] : 'Inherit from runtime.safety or the CLI.'
          }
        >
          <Select
            value={agent.safety ?? ''}
            onChange={(e) => set('safety', (e.target.value || undefined) as AgentConfig['safety'])}
          >
            <option value="">inherit</option>
            {SAFETY_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Welcome message"
          path={`${path}.welcome_message`}
          help="Shown when a session starts."
        >
          <Input
            value={agent.welcome_message ?? ''}
            onChange={(e) => set('welcome_message', e.target.value)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:gap-y-3">
        <Switch
          checked={!!agent.readonly}
          onChange={(v) => set('readonly', v || undefined)}
          label="Read-only"
          description="Only expose read-only tools."
        />
        <Switch
          checked={!!agent.add_date}
          onChange={(v) => set('add_date', v || undefined)}
          label="Add date"
          description="Put today's date in the prompt."
        />
        <Switch
          checked={!!agent.add_environment_info}
          onChange={(v) => set('add_environment_info', v || undefined)}
          label="Add environment info"
          description="Working directory, OS and git status."
        />
        <Switch
          checked={!!agent.code_mode_tools}
          onChange={(v) => set('code_mode_tools', v || undefined)}
          label="Code mode tools"
          description="Let the model call tools by writing code."
        />
        <Switch
          checked={agent.redact_secrets !== false}
          onChange={(v) => set('redact_secrets', v ? undefined : false)}
          label="Redact secrets"
          description="Scrub detected secrets from tool I/O. On by default."
        />
        <Switch
          checked={agent.session_compaction !== false}
          onChange={(v) => set('session_compaction', v ? undefined : false)}
          label="Session compaction"
          description="Summarize long sessions automatically. On by default."
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Max iterations" path={`${path}.max_iterations`}>
          <NumberInput
            value={agent.max_iterations}
            onChange={(v) => set('max_iterations', v)}
            placeholder="unlimited"
            min={0}
          />
        </Field>
        <Field label="Max repeated calls" path={`${path}.max_consecutive_tool_calls`}>
          <NumberInput
            value={agent.max_consecutive_tool_calls}
            onChange={(v) => set('max_consecutive_tool_calls', v)}
            placeholder="5"
            min={0}
          />
        </Field>
        <Field label="History items" path={`${path}.num_history_items`}>
          <NumberInput
            value={agent.num_history_items}
            onChange={(v) => set('num_history_items', v)}
            placeholder="all"
            min={0}
          />
        </Field>
        <Field label="Compaction at" path={`${path}.compaction_threshold`}>
          <NumberInput
            value={agent.compaction_threshold}
            onChange={(v) => set('compaction_threshold', v)}
            placeholder="0.9"
            step={0.05}
            min={0}
            max={1}
          />
        </Field>
      </div>
    </div>
  )
}

export function SectionTitle({
  title,
  description,
  actions,
}: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-md font-semibold">{title}</h3>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  )
}
