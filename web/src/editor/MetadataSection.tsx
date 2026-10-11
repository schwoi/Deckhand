import type { AgentFile, Metadata } from '@shared/config'
import { CURRENT_CONFIG_VERSION } from '@shared/config'
import { Field, Input, Textarea } from '../components/ui/form'
import { TagInput } from '../components/ui/lists'
import { withField } from '../lib/util'
import { str } from './hooks'

export function MetadataSection({
  config,
  onChange,
}: { config: AgentFile; onChange: (c: AgentFile) => void }) {
  const meta: Metadata = config.metadata ?? {}
  const set = <K extends keyof Metadata>(k: K, v: Metadata[K]) =>
    onChange(withField(config, 'metadata', withField(meta, k, v)))
  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Description"
        path="metadata.description"
        help="Shown in the agent list and in registries."
      >
        <Input
          value={meta.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Author" path="metadata.author">
          <Input value={meta.author ?? ''} onChange={(e) => set('author', e.target.value)} />
        </Field>
        <Field label="License" path="metadata.license">
          <Input
            value={meta.license ?? ''}
            onChange={(e) => set('license', e.target.value)}
            placeholder="Apache-2.0"
          />
        </Field>
        <Field label="Version" path="metadata.version" help="Used when publishing.">
          <Input
            mono
            value={meta.version ?? ''}
            onChange={(e) => set('version', e.target.value)}
            placeholder="1.0.0"
          />
        </Field>
      </div>
      <Field label="Tags" path="metadata.tags">
        <TagInput value={meta.tags} onChange={(v) => set('tags', v)} placeholder="Add tag…" />
      </Field>
      <Field label="README" path="metadata.readme" help="Markdown shown on the registry page.">
        <Textarea
          autoGrow
          minRows={6}
          mono
          value={meta.readme ?? ''}
          onChange={(e) => set('readme', e.target.value)}
        />
      </Field>
      <Field
        label="Config version"
        path="version"
        help="Schema version of this file."
        className="w-40"
      >
        <Input
          mono
          value={str(config.version)}
          placeholder={CURRENT_CONFIG_VERSION}
          onChange={(e) => {
            const v = e.target.value.trim()
            onChange(withField(config, 'version', /^\d+$/.test(v) ? Number(v) : v))
          }}
        />
      </Field>
    </div>
  )
}
