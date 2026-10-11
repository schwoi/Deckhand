import type { RemoteConfig, Toolset } from '@shared/config'
import { Field, Input, Select } from '../components/ui/form'
import { KeyValueEditor, StringListEditor } from '../components/ui/lists'
import { Tabs } from '../components/ui/misc'
import { withField } from '../lib/util'

export type McpMode = 'catalog' | 'reference' | 'local' | 'remote'

export function mcpMode(ts: Toolset, allowReference: boolean): McpMode {
  if (ts.remote) return 'remote'
  if (ts.command !== undefined) return 'local'
  if (allowReference && ts.ref && !ts.ref.startsWith('docker:')) return 'reference'
  return 'catalog'
}

const MODE_KEYS = ['ref', 'command', 'args', 'env', 'remote', 'working_dir'] as const

function switchMode(ts: Toolset, mode: McpMode, mcpNames: string[]): Toolset {
  const next = { ...ts }
  for (const k of MODE_KEYS) delete next[k]
  if (mode === 'catalog') next.ref = 'docker:'
  if (mode === 'reference' && mcpNames[0]) next.ref = mcpNames[0]
  if (mode === 'local') next.command = ts.command ?? ''
  if (mode === 'remote') next.remote = { url: '', transport_type: 'streamable' }
  return next
}

/**
 * Edits the transport part of an MCP definition. Used for `type: mcp` toolsets and for
 * top-level `mcps` entries (where `reference` mode is not offered).
 */
export function McpForm({
  value: ts,
  onChange,
  mcpNames,
  path,
}: {
  value: Toolset
  onChange: (v: Toolset) => void
  /** keys of config.mcps; pass undefined to hide the Reference mode */
  mcpNames?: string[]
  path: string
}) {
  const allowRef = mcpNames !== undefined
  const mode = mcpMode(ts, allowRef)
  const tabs: { value: McpMode; label: string }[] = [
    { value: 'catalog', label: 'Catalog' },
    ...(allowRef && (mcpNames.length > 0 || mode === 'reference')
      ? [{ value: 'reference' as const, label: 'Reference' }]
      : []),
    { value: 'local', label: 'Local' },
    { value: 'remote', label: 'Remote' },
  ]
  const remote: RemoteConfig = ts.remote ?? { url: '' }
  const setRemote = <K extends keyof RemoteConfig>(k: K, v: RemoteConfig[K]) => {
    const next = withField(remote, k, v)
    onChange({ ...ts, remote: { ...next, url: next.url ?? '' } })
  }

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        value={mode}
        onChange={(m) => onChange(switchMode(ts, m, mcpNames ?? []))}
        tabs={tabs}
        className="self-start"
      />

      {mode === 'catalog' && (
        <Field
          label="Docker MCP Catalog server"
          path={`${path}.ref`}
          help={
            <>
              Runs a containerized server from the Docker MCP Catalog via the MCP Gateway, e.g.{' '}
              <span className="font-mono">docker:duckduckgo</span>,{' '}
              <span className="font-mono">docker:github-official</span>.
            </>
          }
        >
          <div className="control flex h-8 items-center max-lg:h-10">
            <span className="pl-2.5 font-mono text-sm text-faint">docker:</span>
            <input
              className="h-full w-full min-w-0 bg-transparent pr-2.5 font-mono text-sm outline-none placeholder:text-faint"
              value={(ts.ref ?? '').replace(/^docker:/, '')}
              placeholder="duckduckgo"
              spellCheck={false}
              onChange={(e) => onChange({ ...ts, ref: `docker:${e.target.value.trim()}` })}
            />
          </div>
        </Field>
      )}

      {mode === 'reference' && (
        <Field
          label="MCP server"
          path={`${path}.ref`}
          help="A reusable definition from the MCP servers section."
        >
          {mcpNames && mcpNames.length > 0 ? (
            <Select value={ts.ref ?? ''} onChange={(e) => onChange({ ...ts, ref: e.target.value })}>
              {!mcpNames.includes(ts.ref ?? '') && (
                <option value={ts.ref ?? ''}>{ts.ref || 'Choose…'}</option>
              )}
              {mcpNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          ) : (
            <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted">
              No MCP servers defined yet. Add one in the MCP servers section.
            </p>
          )}
        </Field>
      )}

      {mode === 'local' && (
        <>
          <Field
            label="Command"
            path={`${path}.command`}
            help="Executable that speaks MCP over stdio."
          >
            <Input
              mono
              value={ts.command ?? ''}
              placeholder="npx"
              onChange={(e) => onChange({ ...ts, command: e.target.value })}
            />
          </Field>
          <Field label="Arguments" path={`${path}.args`}>
            <StringListEditor
              value={ts.args}
              onChange={(v) => onChange(withField(ts, 'args', v))}
              placeholder="-y @modelcontextprotocol/server-everything"
              addLabel="Add argument"
            />
          </Field>
          <Field label="Environment" path={`${path}.env`} help="Supports ${env.VAR} interpolation.">
            <KeyValueEditor
              value={ts.env}
              onChange={(v) => onChange(withField(ts, 'env', v))}
              addLabel="Add variable"
            />
          </Field>
        </>
      )}

      {mode === 'remote' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
            <Field label="URL" path={`${path}.remote.url`}>
              <Input
                mono
                value={remote.url}
                placeholder="https://mcp.example.com/mcp"
                onChange={(e) => setRemote('url', e.target.value)}
              />
            </Field>
            <Field label="Transport">
              <Select
                value={remote.transport_type ?? ''}
                onChange={(e) => setRemote('transport_type', e.target.value)}
              >
                <option value="">auto</option>
                <option value="streamable">streamable</option>
                <option value="sse">sse</option>
              </Select>
            </Field>
          </div>
          <Field label="Headers" help="e.g. Authorization: Bearer ${env.API_TOKEN}">
            <KeyValueEditor
              value={remote.headers}
              onChange={(v) => setRemote('headers', v)}
              keyPlaceholder="Header"
              addLabel="Add header"
            />
          </Field>
        </>
      )}
    </div>
  )
}
