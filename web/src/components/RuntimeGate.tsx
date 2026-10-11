import { Play, PlugZap } from 'lucide-react'
import type { ReactNode } from 'react'
import { useRuntime } from '../runtime'
import { Button } from './ui/Button'
import { OutputBox, Spinner } from './ui/misc'

/** Renders children only when the managed runtime is running; otherwise offers to start it. */
export function RuntimeGate({ children, purpose }: { children: ReactNode; purpose: string }) {
  const { status, offline, control, busy } = useRuntime()
  if (status?.state === 'running') return <>{children}</>
  if (!status && !offline) return <Spinner className="m-auto" label="Checking runtime…" />

  const starting = status?.state === 'starting'
  return (
    <div className="m-auto w-full max-w-xl p-4 sm:p-6">
      <div className="rounded-xl border bg-surface p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
            <PlugZap className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-md font-semibold">
              {offline
                ? 'Studio server unreachable'
                : starting
                  ? 'Starting the runtime…'
                  : 'The agent runtime is not running'}
            </h2>
            <p className="mt-1 text-base text-muted">
              {offline
                ? 'Make sure the Studio server is running (bun run dev).'
                : `${purpose} needs the managed docker agent serve api process. It serves every agent in ${status?.agentsDir ?? 'the agents directory'}.`}
            </p>
            {status?.state === 'error' && status.error && (
              <p className="mt-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-sm text-danger">
                {status.error}
              </p>
            )}
            {!offline && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  icon={<Play />}
                  loading={busy || starting}
                  onClick={() => control('start')}
                >
                  {starting ? 'Starting' : status?.state === 'error' ? 'Retry' : 'Start runtime'}
                </Button>
                <span className="font-mono text-xs text-faint">{status?.listen}</span>
              </div>
            )}
          </div>
        </div>
        {status && status.logTail.length > 0 && (
          <div className="mt-5">
            <div className="mb-1.5 text-xs font-medium text-faint">Recent log</div>
            <OutputBox text={status.logTail.slice(-15).join('\n')} className="max-h-48" />
          </div>
        )}
      </div>
    </div>
  )
}
