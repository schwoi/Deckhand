import type { CredentialsStatus, DoctorProvider } from '@shared/api'
import { Check, Copy, ExternalLink, LogIn, LogOut, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { api, errorText } from '../api'
import { Button } from '../components/ui/Button'
import { Dialog, confirmDialog } from '../components/ui/Dialog'
import { Field, Input, Select } from '../components/ui/form'
import { Badge, Code, Disclosure, Spinner } from '../components/ui/misc'
import { toast } from '../components/ui/toast'
import { LOCAL, useEnvironments } from '../env'

/** Sources docker-agent consults before its env file: a key saved here would be shadowed. */
const OUTSIDE = new Set(['environment', 'run-secrets'])

const SIGN_IN: Record<string, 'chatgpt' | 'copilot'> = {
  chatgpt: 'chatgpt',
  'github-copilot': 'copilot',
}

export function CredentialBadge({
  p,
  creds,
}: { p: DoctorProvider; creds: CredentialsStatus | null }) {
  if (!p.found) return <Badge>missing</Badge>
  const account = p.source === 'chatgpt-login' ? creds?.chatgpt.account : undefined
  if (account)
    return (
      <Badge tone="success" title={[account.email, account.plan].filter(Boolean).join(' · ')}>
        signed in{account.plan ? ` · ${account.plan}` : ''}
      </Badge>
    )
  return (
    <Badge tone="success" title={p.env_var}>
      found{p.source ? ` · ${p.source}` : ''}
    </Badge>
  )
}

async function removeKey(name: string, envFile: string | undefined, onChanged: () => void) {
  const ok = await confirmDialog({
    title: `Remove ${name}?`,
    message: (
      <>
        It is deleted from <Code>{envFile ?? 'the env file'}</Code> and the runtime restarts.
      </>
    ),
    confirmLabel: 'Remove',
    danger: true,
  })
  if (!ok) return
  try {
    await api.credentials.removeEnv(name)
    toast.success(`Removed ${name}`)
    onChanged()
  } catch (e) {
    toast.error(errorText(e))
  }
}

export function ProviderActions({
  p,
  creds,
  onChanged,
}: { p: DoctorProvider; creds: CredentialsStatus | null; onChanged: () => void }) {
  const [dialog, setDialog] = useState<'key' | 'chatgpt' | 'copilot' | null>(null)
  const close = () => setDialog(null)

  if (p.found && p.source && OUTSIDE.has(p.source))
    return (
      <span
        className="text-xs text-faint"
        title={`${p.env_var ?? 'This credential'} comes from Deckhand's ${p.source === 'environment' ? 'environment variables' : 'run secrets'}, which take precedence over keys saved here. Change it there.`}
      >
        set outside Deckhand
      </span>
    )

  const signIn = SIGN_IN[p.provider]
  const signOut = async () => {
    const ok = await confirmDialog({
      title: 'Sign out of ChatGPT?',
      message: 'Agents using the chatgpt provider stop working until you sign in again.',
      confirmLabel: 'Sign out',
      danger: true,
    })
    if (!ok) return
    try {
      await api.credentials.chatgptSignOut()
      toast.success('Signed out of ChatGPT')
      onChanged()
    } catch (e) {
      toast.error(errorText(e))
    }
  }
  const done = (message: string) => {
    toast.success(message)
    close()
    onChanged()
  }

  return (
    <>
      <span className="inline-flex items-center justify-end gap-1">
        {p.source === 'chatgpt-login' ? (
          <Button size="xs" icon={<LogOut />} onClick={signOut}>
            Sign out
          </Button>
        ) : signIn && !p.found ? (
          <Button size="xs" icon={<LogIn />} onClick={() => setDialog(signIn)}>
            Sign in
          </Button>
        ) : (
          <Button
            size="xs"
            icon={p.found ? <Pencil /> : <Plus />}
            onClick={() => setDialog(signIn === 'copilot' ? 'copilot' : 'key')}
            title={
              p.found && p.source !== 'config-env-file'
                ? `A key saved here takes precedence over the one from ${p.source}`
                : undefined
            }
          >
            {p.found ? 'Replace' : 'Add key'}
          </Button>
        )}
        {p.source === 'config-env-file' && p.env_var && (
          <Button
            size="xs"
            variant="danger-ghost"
            iconOnly
            icon={<Trash2 />}
            title={`Remove ${p.env_var}`}
            onClick={() => removeKey(p.env_var as string, creds?.envFile, onChanged)}
          />
        )}
      </span>
      <KeyDialog
        open={dialog === 'key'}
        onClose={close}
        title={`${p.provider} key`}
        names={p.env_vars}
        envFile={creds?.envFile}
        hint={
          p.provider === 'github-copilot'
            ? 'A fine-grained token with the Copilot Requests permission, or an OAuth token. Classic ghp_ tokens are not accepted.'
            : undefined
        }
        onSaved={onChanged}
      />
      {/* Mounted per attempt: see useSignIn. */}
      {dialog === 'chatgpt' && (
        <ChatgptDialog onClose={close} onSignedIn={() => done('Signed in to ChatGPT')} />
      )}
      {dialog === 'copilot' && (
        <CopilotDialog
          onClose={close}
          onSignedIn={() => done('Signed in to GitHub Copilot')}
          onUseToken={() => setDialog('key')}
        />
      )}
    </>
  )
}

/** Keys saved in the env file that no known provider claims, e.g. custom providers' token_key. */
export function OtherKeys({
  names,
  creds,
  onChanged,
}: { names: string[]; creds: CredentialsStatus | null; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  if (names.length === 0) return null
  return (
    <div className="border-t px-4 py-3">
      <h4 className="pb-1.5 text-xs text-faint">Other saved keys</h4>
      <ul className="flex flex-col gap-1">
        {names.map((n) => (
          <li key={n} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-mono text-sm">{n}</span>
            <span className="inline-flex items-center gap-1">
              <Button size="xs" icon={<Pencil />} onClick={() => setEditing(n)}>
                Replace
              </Button>
              <Button
                size="xs"
                variant="danger-ghost"
                iconOnly
                icon={<Trash2 />}
                title={`Remove ${n}`}
                onClick={() => removeKey(n, creds?.envFile, onChanged)}
              />
            </span>
          </li>
        ))}
      </ul>
      <KeyDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Replace ${editing ?? ''}`}
        names={editing ? [editing] : []}
        envFile={creds?.envFile}
        onSaved={onChanged}
      />
    </div>
  )
}

/** Save NAME=value to docker-agent's env file. `names` empty means the user types the name. */
export function KeyDialog({
  open,
  onClose,
  title,
  names,
  envFile,
  hint,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  title: string
  names: string[]
  envFile?: string
  hint?: ReactNode
  onSaved: () => void
}) {
  const formId = useId()
  const { current } = useEnvironments()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when (re)opened
  useEffect(() => {
    if (!open) return
    setName(names[0] ?? '')
    setValue('')
    setError(null)
  }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.credentials.setEnv(name.trim(), value)
      toast.success(`Saved ${name.trim()}`)
      onSaved()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={saving}
            disabled={!name.trim() || !value.trim()}
          >
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Variable">
          {names.length > 1 ? (
            <Select value={name} onChange={(e) => setName(e.target.value)}>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              mono
              value={name}
              readOnly={names.length === 1}
              onChange={(e) => setName(e.target.value)}
              placeholder="MY_API_KEY"
            />
          )}
        </Field>
        <Field label="Value" help={hint} error={error}>
          <Input
            mono
            type="password"
            autoComplete="off"
            data-1p-ignore
            data-autofocus={names.length > 0 || undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <p className="text-xs text-faint">
          Saved to <Code>{envFile ?? '~/.config/cagent/.env'}</Code>
          {current.id === LOCAL.id ? ' on this machine' : ` on ${current.name}`}, readable only by
          its owner. The runtime restarts to pick it up.
        </p>
      </form>
    </Dialog>
  )
}

/** `signedIn`: the credential the flow produces exists (a flow can also vanish when cancelled). */
type FlowPart = { flow?: unknown; error?: string; signedIn: boolean }

/**
 * Start a server-side sign-in on mount, poll until it finishes, and cancel it when dismissed or
 * unmounted mid-flow. Dialogs using this are mounted per attempt, so no earlier result can count
 * as this one's success. `gen` drops responses from an attempt that was already abandoned.
 */
function useSignIn(
  start: () => Promise<CredentialsStatus>,
  cancel: () => Promise<unknown>,
  pick: (s: CredentialsStatus) => FlowPart,
  onDone: () => void,
) {
  const [status, setStatus] = useState<CredentialsStatus | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const gen = useRef(0)
  const accept = useCallback((p: Promise<CredentialsStatus>) => {
    const g = gen.current
    return p.then((s) => {
      if (g === gen.current) setStatus(s)
    })
  }, [])
  const begin = useCallback(() => {
    const g = ++gen.current
    setStatus(null)
    setStartError(null)
    accept(start()).catch((e) => {
      if (g === gen.current) setStartError(errorText(e))
    })
  }, [start, accept])
  useEffect(() => {
    begin()
  }, [begin])

  const part = status ? pick(status) : null
  const pending = !!part?.flow
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => accept(api.credentials.status()).catch(() => {}), 2000)
    return () => clearInterval(t)
  }, [pending, accept])

  const pendingRef = useRef(false)
  pendingRef.current = pending
  useEffect(
    () => () => {
      if (pendingRef.current) cancel().catch(() => {})
    },
    [cancel],
  )

  const done = !!part && !part.flow && !part.error && part.signedIn
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once per completed attempt
  useEffect(() => {
    if (done) onDone()
  }, [done])

  // Always cancel: the start may still be in flight. The server ignores it when nothing is pending.
  const abandon = () => {
    gen.current++
    cancel().catch(() => {})
    setStatus(null)
  }
  return { status, error: startError ?? part?.error ?? null, begin, accept, abandon }
}

function FlowError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

function ChatgptDialog({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: () => void }) {
  const { current } = useEnvironments()
  const signIn = useSignIn(
    api.credentials.chatgptLogin,
    api.credentials.chatgptCancel,
    (s) => ({ ...s.chatgpt, signedIn: !!s.chatgpt.account }),
    onSignedIn,
  )
  const [url, setUrl] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [pasteError, setPasteError] = useState<string | null>(null)

  const flow = signIn.status?.chatgpt.flow
  // The redirect to localhost:1455 reaches Deckhand only when the browser runs on its machine.
  const mustPaste = current.id !== LOCAL.id || flow?.listening === false
  const dismiss = () => {
    signIn.abandon()
    onClose()
  }
  const finish = async (e: FormEvent) => {
    e.preventDefault()
    setFinishing(true)
    setPasteError(null)
    try {
      await signIn.accept(api.credentials.chatgptComplete(url))
    } catch (err) {
      setPasteError(errorText(err))
    } finally {
      setFinishing(false)
    }
  }

  const paste = (
    <form onSubmit={finish} className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        After you approve, the browser lands on a <Code>localhost:1455</Code> address
        {mustPaste ? ' that will not load here' : ''}. Copy that whole address from the address bar
        and paste it below.
      </p>
      <div className="flex gap-2">
        <Input
          mono
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:1455/auth/callback?code=…"
          aria-label="Address from the browser"
        />
        <Button type="submit" loading={finishing} disabled={!url.trim()}>
          Finish
        </Button>
      </div>
      {pasteError && <p className="text-xs text-danger">{pasteError}</p>}
    </form>
  )

  return (
    <Dialog
      open
      onClose={dismiss}
      title="Sign in with ChatGPT"
      description="Use a ChatGPT Plus, Pro or Business plan instead of an API key."
      footer={<Button onClick={dismiss}>Cancel</Button>}
    >
      {signIn.error ? (
        <FlowError error={signIn.error} onRetry={signIn.begin} />
      ) : !flow ? (
        <Spinner label="Preparing sign-in…" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="md"
              icon={<ExternalLink />}
              onClick={() => window.open(flow.authUrl, '_blank', 'noopener')}
            >
              Open ChatGPT sign-in
            </Button>
            <Spinner label="Waiting for you to finish…" />
          </div>
          {mustPaste ? (
            <div className="border-t pt-4">{paste}</div>
          ) : (
            <Disclosure title="The page after signing in did not load?">{paste}</Disclosure>
          )}
        </div>
      )}
    </Dialog>
  )
}

function CopilotDialog({
  onClose,
  onSignedIn,
  onUseToken,
}: { onClose: () => void; onSignedIn: () => void; onUseToken: () => void }) {
  const signIn = useSignIn(
    api.credentials.copilotLogin,
    api.credentials.copilotCancel,
    (s) => ({ ...s.githubCopilot, signedIn: s.envVars.includes('GITHUB_TOKEN') }),
    onSignedIn,
  )
  const [copied, setCopied] = useState(false)
  const flow = signIn.status?.githubCopilot.flow
  const copy = () => {
    if (!flow) return
    navigator.clipboard?.writeText(flow.userCode).then(
      () => setCopied(true),
      () => {},
    )
  }

  return (
    <Dialog
      open
      onClose={() => {
        signIn.abandon()
        onClose()
      }}
      title="Sign in to GitHub Copilot"
      description="Use your Copilot subscription's models. The token is saved as GITHUB_TOKEN."
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              signIn.abandon()
              onUseToken()
            }}
          >
            Use a token instead
          </Button>
          <Button
            onClick={() => {
              signIn.abandon()
              onClose()
            }}
          >
            Cancel
          </Button>
        </>
      }
    >
      {signIn.error ? (
        <FlowError error={signIn.error} onRetry={signIn.begin} />
      ) : !flow ? (
        <Spinner label="Asking GitHub for a code…" />
      ) : (
        <div className="flex flex-col items-start gap-4">
          <p className="text-base text-muted">Enter this code on GitHub:</p>
          <div className="flex items-center gap-2">
            <span className="rounded-md border bg-sunken px-3 py-1.5 font-mono text-xl tracking-[0.2em] select-all">
              {flow.userCode}
            </span>
            <Button
              iconOnly
              icon={copied ? <Check /> : <Copy />}
              title={copied ? 'Copied' : 'Copy code'}
              onClick={copy}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="md"
              icon={<ExternalLink />}
              onClick={() => {
                copy()
                window.open(flow.verificationUri, '_blank', 'noopener')
              }}
            >
              Copy code and open GitHub
            </Button>
            <Spinner label="Waiting for GitHub…" />
          </div>
        </div>
      )}
    </Dialog>
  )
}
