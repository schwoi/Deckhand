import { KeyRound } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { UNAUTHORIZED_EVENT, api, authToken } from '../api'
import { Button } from './ui/Button'
import { Field, Input } from './ui/form'
import { Spinner } from './ui/misc'

type State = 'checking' | 'ok' | 'locked'

/** Asks for the DECKHAND_TOKEN when the server requires one; remounts the app once it works. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('checking')
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    api
      .auth()
      .then((a) => setState(a.required && !authToken.get() ? 'locked' : 'ok'))
      .catch(() => setState('ok')) // the app shows its own "server unreachable" state
    const lock = () => setState('locked')
    window.addEventListener(UNAUTHORIZED_EVENT, lock)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, lock)
  }, [])

  if (state === 'checking') return <Spinner className="m-auto" label="Connecting…" />
  if (state === 'locked')
    return (
      <TokenPrompt
        onUnlocked={() => {
          setGeneration((g) => g + 1)
          setState('ok')
        }}
      />
    )
  return (
    <div key={generation} className="contents">
      {children}
    </div>
  )
}

function TokenPrompt({ onUnlocked }: { onUnlocked: () => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hadToken = !!authToken.get()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    authToken.set(token)
    try {
      await api.environments.list() // any protected call; 401 fires the event again
      onUnlocked()
    } catch {
      setError('That token was not accepted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="m-auto w-full max-w-sm p-4">
      <form onSubmit={submit} className="rounded-xl border bg-surface p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
            <KeyRound className="size-[18px]" />
          </div>
          <div>
            <h1 className="text-md font-semibold">Deckhand is locked</h1>
            <p className="text-sm text-muted">
              {hadToken
                ? 'The saved token was rejected. Enter the current one.'
                : 'This server was started with DECKHAND_TOKEN.'}
            </p>
          </div>
        </div>
        <Field label="Token" error={error}>
          <Input
            mono
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            data-autofocus
            autoFocus
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="md"
          className="mt-4 w-full"
          loading={busy}
          disabled={!token}
        >
          Unlock
        </Button>
      </form>
    </div>
  )
}
