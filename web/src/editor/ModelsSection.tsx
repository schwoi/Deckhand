import type { AgentFile, ModelConfig, ProviderConfig } from '@shared/config'
import { PROVIDERS } from '@shared/config'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '../components/ui/Button'
import { Combobox } from '../components/ui/Combobox'
import { confirmDialog } from '../components/ui/Dialog'
import { Field, Input, NumberInput, OptionalBool, Select } from '../components/ui/form'
import { Code, EmptyState } from '../components/ui/misc'
import { omitKey, renameKey, uniqueKey, withField } from '../lib/util'
import { SectionTitle } from './AgentsSection'
import { NamedEntry } from './NamedEntry'
import { str, useModelCatalog } from './hooks'

function usersOf(config: AgentFile, model: string): string[] {
  return Object.entries(config.agents ?? {})
    .filter(([, a]) =>
      (a.model ?? '')
        .split(',')
        .map((s) => s.trim())
        .includes(model),
    )
    .map(([n]) => n)
}

export function ModelsSection({
  config,
  onChange,
}: { config: AgentFile; onChange: (c: AgentFile) => void }) {
  const models = config.models ?? {}
  const providers = config.providers ?? {}
  const names = Object.keys(models)
  const catalog = useModelCatalog()
  const providerOptions = useMemo(
    () => [
      ...Object.keys(providers).map((p) => ({
        value: p,
        group: 'Custom providers',
        hint: providers[p]?.base_url,
      })),
      ...PROVIDERS.map((p) => ({ value: p, group: 'Built-in' })),
    ],
    [providers],
  )

  const setModels = (m: Record<string, ModelConfig>) => onChange(withField(config, 'models', m))
  const setProviders = (p: Record<string, ProviderConfig>) =>
    onChange(withField(config, 'providers', p))

  const renameModel = (from: string, to: string) => {
    const agents = { ...config.agents }
    for (const [k, a] of Object.entries(agents)) {
      if (!a.model) continue
      const parts = a.model.split(',').map((s) => s.trim())
      if (parts.includes(from))
        agents[k] = { ...a, model: parts.map((p) => (p === from ? to : p)).join(',') }
    }
    onChange({ ...config, agents, models: renameKey(models, from, to) })
  }
  const removeModel = async (name: string) => {
    const users = usersOf(config, name)
    if (
      users.length &&
      !(await confirmDialog({
        title: `Remove model ${name}?`,
        message: `It is used by ${users.join(', ')}. Those agents will fail validation until you pick another model.`,
        confirmLabel: 'Remove',
        danger: true,
      }))
    )
      return
    setModels(omitKey(models, name))
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionTitle
          title="Models"
          description="Named model configurations agents can reference by name."
          actions={
            <Button
              size="sm"
              icon={<Plus />}
              onClick={() =>
                setModels({ ...models, [uniqueKey(names, 'main')]: { provider: 'openai' } })
              }
            >
              Add model
            </Button>
          }
        />
        {names.length === 0 && (
          <EmptyState
            className="rounded-lg border border-dashed py-8"
            title="No named models"
            description="Agents can use inline provider/model strings. Define a named model to tune max_tokens, temperature or thinking."
          />
        )}
        {names.map((name) => {
          const m = models[name] ?? {}
          const users = usersOf(config, name)
          const set = <K extends keyof ModelConfig>(k: K, v: ModelConfig[K]) =>
            setModels({ ...models, [name]: withField(m, k, v) })
          const suggestions = catalog
            .filter((c) => !m.provider || c.provider === m.provider)
            .map((c) => ({ value: c.model, hint: m.provider ? undefined : c.provider }))
          return (
            <NamedEntry
              key={name}
              name={name}
              path={`models.${name}`}
              taken={names.filter((n) => n !== name)}
              onRename={(to) => renameModel(name, to)}
              onRemove={() => removeModel(name)}
              meta={users.length ? `used by ${users.join(', ')}` : 'unused'}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr]">
                <Field label="Provider" path={`models.${name}.provider`}>
                  <Combobox
                    mono
                    value={m.provider ?? ''}
                    onChange={(v) => set('provider', v)}
                    options={providerOptions}
                  />
                </Field>
                <Field label="Model" path={`models.${name}.model`}>
                  <Combobox
                    mono
                    value={m.model ?? ''}
                    onChange={(v) => set('model', v)}
                    options={suggestions}
                    placeholder="gpt-5"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Max tokens" help="Output budget, not context.">
                  <NumberInput
                    value={m.max_tokens}
                    onChange={(v) => set('max_tokens', v)}
                    min={1}
                  />
                </Field>
                <Field label="Temperature">
                  <NumberInput
                    value={m.temperature}
                    onChange={(v) => set('temperature', v)}
                    step={0.1}
                    min={0}
                    max={2}
                  />
                </Field>
                <Field label="Top p">
                  <NumberInput
                    value={m.top_p}
                    onChange={(v) => set('top_p', v)}
                    step={0.05}
                    min={0}
                    max={1}
                  />
                </Field>
                <Field label="Thinking" help="Tokens or low/medium/high">
                  <Input
                    mono
                    value={str(m.thinking_budget)}
                    placeholder="default"
                    onChange={(e) => {
                      const v = e.target.value.trim()
                      set('thinking_budget', /^\d+$/.test(v) ? Number(v) : v)
                    }}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Base URL" help="For OpenAI-compatible endpoints.">
                  <Input
                    mono
                    value={m.base_url ?? ''}
                    onChange={(e) => set('base_url', e.target.value)}
                    placeholder="https://…/v1"
                  />
                </Field>
                <Field label="Token env var" help="Environment variable holding the API key.">
                  <Input
                    mono
                    value={m.token_key ?? ''}
                    onChange={(e) => set('token_key', e.target.value)}
                    placeholder="OPENAI_API_KEY"
                  />
                </Field>
              </div>
              <Field label="Description">
                <Input
                  value={m.description ?? ''}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="fast and cheap, good for summaries"
                />
              </Field>
              <OptionalBool
                label="Parallel tool calls"
                value={m.parallel_tool_calls}
                onChange={(v) => set('parallel_tool_calls', v)}
              />
            </NamedEntry>
          )
        })}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle
          title="Custom providers"
          description="Reusable defaults (base URL, token, API type) a model's provider field can reference."
          actions={
            <Button
              size="sm"
              icon={<Plus />}
              onClick={() =>
                setProviders({
                  ...providers,
                  [uniqueKey(Object.keys(providers), 'custom')]: {
                    api_type: 'openai_chatcompletions',
                  },
                })
              }
            >
              Add provider
            </Button>
          }
        />
        {Object.keys(providers).length === 0 && (
          <p className="text-sm text-faint">
            None. Add one to use e.g. a self-hosted OpenAI-compatible server as{' '}
            <Code>provider: my-server</Code>.
          </p>
        )}
        {Object.entries(providers).map(([name, p]) => {
          const set = <K extends keyof ProviderConfig>(k: K, v: ProviderConfig[K]) =>
            setProviders({ ...providers, [name]: withField(p, k, v) })
          return (
            <NamedEntry
              key={name}
              name={name}
              path={`providers.${name}`}
              taken={Object.keys(providers).filter((n) => n !== name)}
              onRename={(to) => {
                const nextModels = Object.fromEntries(
                  Object.entries(models).map(([k, m]) => [
                    k,
                    m.provider === name ? { ...m, provider: to } : m,
                  ]),
                )
                onChange({
                  ...withField(config, 'models', nextModels),
                  providers: renameKey(providers, name, to),
                })
              }}
              onRemove={() => setProviders(omitKey(providers, name))}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Provider type" help="Defaults to openai.">
                  <Combobox
                    mono
                    value={p.provider ?? ''}
                    onChange={(v) => set('provider', v)}
                    options={PROVIDERS.map((x) => ({ value: x }))}
                    placeholder="openai"
                  />
                </Field>
                <Field label="API type" help="OpenAI-compatible providers only.">
                  <Select
                    value={p.api_type ?? ''}
                    onChange={(e) => set('api_type', e.target.value)}
                  >
                    <option value="">default</option>
                    <option value="openai_chatcompletions">openai_chatcompletions</option>
                    <option value="openai_responses">openai_responses</option>
                  </Select>
                </Field>
                <Field label="Base URL">
                  <Input
                    mono
                    value={p.base_url ?? ''}
                    onChange={(e) => set('base_url', e.target.value)}
                    placeholder="http://localhost:8000/v1"
                  />
                </Field>
                <Field label="Token env var">
                  <Input
                    mono
                    value={p.token_key ?? ''}
                    onChange={(e) => set('token_key', e.target.value)}
                    placeholder="MY_API_KEY"
                  />
                </Field>
              </div>
            </NamedEntry>
          )
        })}
      </section>
    </div>
  )
}
