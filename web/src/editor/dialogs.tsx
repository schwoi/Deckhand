import type { CommandResult, DoctorReport } from '@shared/api'
import { CircleCheck, CircleX } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { api, errorText } from '../api'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { Field, Input } from '../components/ui/form'
import { Badge, OutputBox, Spinner } from '../components/ui/misc'
import { toast } from '../components/ui/toast'

export function DoctorDialog({
  name,
  open,
  onClose,
  dirty,
}: { name: string; open: boolean; onClose: () => void; dirty: boolean }) {
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setReport(null)
    setError(null)
    api.agents
      .doctor(name)
      .then(setReport)
      .catch((e) => setError(errorText(e)))
  }, [open, name])

  const envVars = report?.env_vars ?? []
  const missing = envVars.filter((v) => !v.found).length
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Doctor"
      description={`Checks what ${name} needs to run on this machine${dirty ? ' (uses the saved file)' : ''}.`}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {!report && !error && <Spinner label="Running docker agent doctor…" />}
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {report && (
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              Required environment variables
              {envVars.length > 0 && (
                <Badge tone={missing ? 'danger' : 'success'}>
                  {missing ? `${missing} missing` : 'all set'}
                </Badge>
              )}
            </h3>
            {envVars.length === 0 ? (
              <p className="text-sm text-muted">This agent needs no environment variables.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {envVars.map((v) => (
                  <li key={v.name} className="flex items-center gap-2.5 px-3 py-2">
                    {v.found ? (
                      <CircleCheck className="size-4 text-success" />
                    ) : (
                      <CircleX className="size-4 text-danger" />
                    )}
                    <span className="flex-1 font-mono text-sm">{v.name}</span>
                    <span className="text-xs text-faint">
                      {v.found ? (v.source ?? 'found') : 'missing'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-medium">Issues</h3>
            {(report.issues ?? []).length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <CircleCheck className="size-4" /> No issues found.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {(report.issues ?? []).map((i) => (
                  <li key={i} className="rounded-md bg-warning-soft px-3 py-2 text-sm text-fg">
                    {i}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  )
}

export function PushDialog({
  name,
  open,
  onClose,
  dirty,
}: { name: string; open: boolean; onClose: () => void; dirty: boolean }) {
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CommandResult | null>(null)
  useEffect(() => {
    if (open) setResult(null)
  }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ref.trim()) return
    setBusy(true)
    setResult(null)
    try {
      const res = await api.registry.push({ name, ref: ref.trim() })
      setResult(res)
      if (res.ok) toast.success(`Pushed ${name} to ${ref.trim()}`)
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Push to registry"
      description={`Publishes ${name} as an OCI artifact with docker agent share push${dirty ? '. Unsaved changes are not included.' : '.'}`}
      footer={
        <>
          <Button onClick={onClose}>{result?.ok ? 'Done' : 'Cancel'}</Button>
          <Button
            variant="primary"
            type="submit"
            form="push-form"
            loading={busy}
            disabled={!ref.trim()}
          >
            Push
          </Button>
        </>
      }
    >
      <form id="push-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Reference"
          htmlFor="push-ref"
          help="Requires docker login for the target registry."
        >
          <Input
            id="push-ref"
            mono
            autoFocus
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={`docker.io/you/${name}:latest`}
          />
        </Field>
        {result && (
          <div className="flex flex-col gap-1.5">
            <p
              className={
                result.ok ? 'text-sm font-medium text-success' : 'text-sm font-medium text-danger'
              }
            >
              {result.ok ? 'Pushed successfully' : `Push failed (exit code ${result.exitCode})`}
            </p>
            <OutputBox text={[result.stdout, result.stderr].filter(Boolean).join('\n')} />
          </div>
        )}
      </form>
    </Dialog>
  )
}
