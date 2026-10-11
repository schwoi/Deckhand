import type { AgentFile, BudgetConfig, PermissionsConfig, RuntimeDefaults } from '@shared/config'
import { SAFETY_MODES } from '@shared/config'
import { Field, NumberInput, Switch } from '../components/ui/form'
import { StringListEditor, TagInput } from '../components/ui/lists'
import { Code } from '../components/ui/misc'
import { cn, withField } from '../lib/util'
import { SectionTitle } from './AgentsSection'
import { SAFETY_INFO } from './catalog'

export function PermissionsSection({
  config,
  onChange,
}: { config: AgentFile; onChange: (c: AgentFile) => void }) {
  const perms: PermissionsConfig = config.permissions ?? {}
  const runtime: RuntimeDefaults = config.runtime ?? {}
  const budget: BudgetConfig = config.budget ?? {}
  const setPerm = (k: keyof PermissionsConfig, v: string[]) =>
    onChange(withField(config, 'permissions', withField(perms, k, v)))
  const setRuntime = <K extends keyof RuntimeDefaults>(k: K, v: RuntimeDefaults[K]) =>
    onChange(withField(config, 'runtime', withField(runtime, k, v)))
  const setBudget = (k: 'max_cost' | 'max_tokens', v: number | undefined) =>
    onChange(withField(config, 'budget', withField(budget, k, v)))

  const lists = [
    {
      key: 'allow',
      label: 'Allow',
      help: 'Auto-approved without asking.',
      placeholder: 'shell:cmd=git status*',
    },
    {
      key: 'ask',
      label: 'Ask',
      help: 'Always ask, even for normally auto-approved tools.',
      placeholder: 'mcp:github:create_*',
    },
    {
      key: 'deny',
      label: 'Deny',
      help: 'Always rejected. Wins over allow.',
      placeholder: 'shell:cmd=rm -rf*',
    },
  ] as const

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionTitle
          title="Tool permissions"
          description="Patterns that decide which tool calls need approval."
        />
        <div className="rounded-md bg-sunken px-3 py-2.5 text-sm text-muted">
          Match tool names with globs (<Code>read_*</Code>), MCP tools by server (
          <Code>mcp:github:get_*</Code>), or arguments with <Code>tool:arg=glob</Code> (
          <Code>shell:cmd=git status*</Code>).
        </div>
        <div className="grid grid-cols-3 gap-4">
          {lists.map((l) => (
            <Field key={l.key} label={l.label} help={l.help} path={`permissions.${l.key}`}>
              <StringListEditor
                value={perms[l.key]}
                onChange={(v) => setPerm(l.key, v)}
                placeholder={l.placeholder}
                addLabel="Add pattern"
              />
            </Field>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle
          title="Runtime defaults"
          description="Defaults only: CLI flags and user settings still take precedence."
        />
        <Field label="Safety mode" path="runtime.safety">
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup">
            {[undefined, ...SAFETY_MODES].map((m) => {
              const active = runtime.safety === m
              return (
                <button
                  key={m ?? 'default'}
                  type="button"
                  // biome-ignore lint/a11y/useSemanticElements: custom-styled ARIA widget
                  role="radio"
                  aria-checked={active}
                  onClick={() => setRuntime('safety', m)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left transition-colors',
                    active ? 'border-accent bg-accent-soft/60' : 'hover:bg-hover',
                    m === 'autonomous' && active && 'border-warning bg-warning-soft',
                  )}
                >
                  <div className="text-base font-medium">{m ?? 'Not set'}</div>
                  <div className="text-sm text-muted">
                    {m ? SAFETY_INFO[m] : 'Use the CLI or user-config default.'}
                  </div>
                </button>
              )
            })}
          </div>
        </Field>
        <Switch
          checked={!!runtime.sandbox}
          onChange={(v) => setRuntime('sandbox', v || undefined)}
          label="Run in a Docker sandbox"
          description="Same as passing --sandbox. Network is default-deny inside the sandbox."
        />
        <Field
          label="Sandbox network allowlist"
          path="runtime.network_allowlist"
          help="Extra hosts the sandbox may reach, with optional :port (api.example.com, registry.npmjs.org:443)."
        >
          <TagInput
            mono
            value={runtime.network_allowlist}
            onChange={(v) => setRuntime('network_allowlist', v)}
            placeholder="api.example.com"
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle
          title="Budget"
          description="Per-run ceilings shared by all sub-agents. Exceeding one stops the run."
        />
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Max cost (USD)"
            path="budget.max_cost"
            help="Only priced models count toward this."
          >
            <NumberInput
              value={budget.max_cost}
              onChange={(v) => setBudget('max_cost', v)}
              step={0.5}
              min={0}
              placeholder="unlimited"
            />
          </Field>
          <Field
            label="Max tokens"
            path="budget.max_tokens"
            help="Cumulative input + output tokens."
          >
            <NumberInput
              value={budget.max_tokens}
              onChange={(v) => setBudget('max_tokens', v)}
              step={1000}
              min={0}
              placeholder="unlimited"
            />
          </Field>
        </div>
      </section>
    </div>
  )
}
