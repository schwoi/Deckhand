import type { AgentFile, Toolset } from '@shared/config'
import { Plus } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Field, Textarea } from '../components/ui/form'
import { TagInput } from '../components/ui/lists'
import { Code, EmptyState } from '../components/ui/misc'
import { omitKey, renameKey, uniqueKey, withField } from '../lib/util'
import { SectionTitle } from './AgentsSection'
import { McpForm } from './McpForm'
import { NamedEntry } from './NamedEntry'

type McpMap = NonNullable<AgentFile['mcps']>

function referencedBy(config: AgentFile, name: string): string[] {
  return Object.entries(config.agents ?? {})
    .filter(([, a]) => a.toolsets?.some((t) => t.type === 'mcp' && t.ref === name))
    .map(([n]) => n)
}

export function McpsSection({
  config,
  onChange,
}: { config: AgentFile; onChange: (c: AgentFile) => void }) {
  const mcps: McpMap = config.mcps ?? {}
  const names = Object.keys(mcps)
  const setMcps = (m: McpMap) => onChange(withField(config, 'mcps', m))

  const rename = (from: string, to: string) => {
    const agents = { ...config.agents }
    for (const [k, a] of Object.entries(agents)) {
      if (a.toolsets?.some((t) => t.type === 'mcp' && t.ref === from))
        agents[k] = {
          ...a,
          toolsets: a.toolsets.map((t) =>
            t.type === 'mcp' && t.ref === from ? { ...t, ref: to } : t,
          ),
        }
    }
    onChange({ ...config, agents, mcps: renameKey(mcps, from, to) })
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle
        title="MCP servers"
        description="Reusable MCP server definitions. Reference them from an agent's toolsets with type: mcp, ref: <name>."
        actions={
          <Button
            size="sm"
            icon={<Plus />}
            onClick={() => setMcps({ ...mcps, [uniqueKey(names, 'server')]: { ref: 'docker:' } })}
          >
            Add MCP server
          </Button>
        }
      />
      {names.length === 0 && (
        <EmptyState
          className="rounded-lg border border-dashed py-8"
          title="No shared MCP servers"
          description="Define a server once here to share it between agents, or add MCP toolsets directly on an agent."
        />
      )}
      {names.map((name) => {
        // mcps entries are toolset definitions without `type`
        const def = { type: 'mcp', ...mcps[name] } as Toolset
        const update = (next: Toolset) => {
          const { type: _type, ...rest } = next
          setMcps({ ...mcps, [name]: rest })
        }
        const users = referencedBy(config, name)
        return (
          <NamedEntry
            key={name}
            name={name}
            path={`mcps.${name}`}
            taken={names.filter((n) => n !== name)}
            onRename={(to) => rename(name, to)}
            onRemove={() => setMcps(omitKey(mcps, name))}
            meta={users.length ? `used by ${users.join(', ')}` : 'not referenced by any agent'}
          >
            <McpForm value={def} onChange={update} path={`mcps.${name}`} />
            <Field label="Tools filter" help="Only expose these tools. Leave empty for all.">
              <TagInput
                mono
                value={def.tools}
                onChange={(v) => update(withField(def, 'tools', v))}
                placeholder="tool_name"
              />
            </Field>
            <Field
              label="Instruction"
              help={
                <>
                  Replaces the server's built-in instructions; include{' '}
                  <Code>{'{ORIGINAL_INSTRUCTIONS}'}</Code> to extend.
                </>
              }
            >
              <Textarea
                autoGrow
                minRows={2}
                value={def.instruction ?? ''}
                onChange={(e) => update(withField(def, 'instruction', e.target.value))}
              />
            </Field>
          </NamedEntry>
        )
      })}
    </div>
  )
}
