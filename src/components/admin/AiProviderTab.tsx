import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useAccount, useSignMessage } from 'wagmi'
import { CheckCircle2, KeyRound, Lock, Plug, Trash2, XCircle } from 'lucide-react'
import {
  AdminApiError,
  TEST_COPY,
  adminFetch,
  clearSession,
  setSession,
  useUnlocked,
  type AiStatus,
  type ProviderId,
  type ProviderStatus,
  type TestResult,
} from '@/components/admin/aiApi'
import { Button, Chip, Field, inputClass } from '@/components/ui'

const MODEL_HINT: Record<ProviderId, string> = {
  openrouter: 'openai/gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-flash',
  custom: 'your-model-name',
}

type FormValues = { apiKey: string; model: string; baseUrl: string; label: string; makeActive: boolean }

const SOURCE_COPY = { admin: 'Saved here', env: 'From .env', none: 'No key' } as const

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="glass rounded-3xl p-4 sm:p-5">{children}</section>
}

/** Pick the assistant's AI provider. The key is write-only: the server never sends it back. */
export function AiProviderTab() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const unlocked = useUnlocked()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [selected, setSelected] = useState<ProviderId>('custom')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'unlock' | 'save' | 'test' | 'clear' | null>(null)
  const [test, setTest] = useState<TestResult | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!unlocked) return
    let live = true
    adminFetch<AiStatus>('/admin/ai')
      .then((next) => {
        if (!live) return
        setStatus(next)
        setError(null)
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof AdminApiError ? e.message : 'Could not load the settings.')
      })
    return () => {
      live = false
    }
  }, [unlocked])

  const current: ProviderStatus | undefined = status?.providers.find((p) => p.id === selected)

  const unlock = async () => {
    if (!address) return
    setBusy('unlock')
    setError(null)
    try {
      const nonce = await adminFetch<{ nonce: string; message: string }>(
        `/admin/nonce?address=${encodeURIComponent(address)}`,
      )
      const signature = await signMessageAsync({ message: nonce.message })
      const res = await adminFetch<{ token: string; expiresInSeconds: number }>('/admin/login', {
        method: 'POST',
        body: { address, signature, nonce: nonce.nonce },
      })
      setSession(res.token, res.expiresInSeconds)
    } catch (e) {
      const rejected = (e as { name?: string; message?: string })?.message?.toLowerCase().includes('rejected')
      if (!rejected) setError(e instanceof AdminApiError ? e.message : 'Signing was cancelled.')
    } finally {
      setBusy(null)
    }
  }

  const run = async (kind: 'save' | 'test' | 'clear', fn: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  const save = (v: FormValues) =>
    run('save', async () => {
      const next = await adminFetch<AiStatus>('/admin/ai', {
        method: 'POST',
        body: {
          provider: selected,
          apiKey: v.apiKey.trim() || undefined,
          model: v.model.trim(),
          ...(selected === 'custom' ? { baseUrl: v.baseUrl.trim() || undefined, label: v.label.trim() } : {}),
          makeActive: v.makeActive,
        },
      })
      setTest(null)
      setStatus(next)
      setSaved(true)
    })

  const runTest = () =>
    run('test', async () => {
      setTest(null)
      setTest(await adminFetch<TestResult>('/admin/ai/test', { method: 'POST', body: { provider: selected } }))
    })

  const clear = () =>
    run('clear', async () => {
      setStatus(await adminFetch<AiStatus>('/admin/ai/clear', { method: 'POST', body: { provider: selected } }))
      setTest(null)
    })

  if (!unlocked) {
    return (
      <Panel>
        <span className="flex size-11 items-center justify-center rounded-2xl" style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}>
          <Lock className="size-5" />
        </span>
        <h3 className="display mt-4 text-xl font-bold">AI provider</h3>
        <p className="mt-1 max-w-xl text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          Choose which AI service answers in the assistant, and store its key on the server. To protect the key, sign a
          message with your admin wallet first. It is free and sends no transaction.
        </p>
        <Button className="mt-5" loading={busy === 'unlock'} onClick={() => void unlock()} disabled={!address}>
          <KeyRound className="size-4" /> Unlock with wallet
        </Button>
        {error && (
          <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }} role="alert">
            {error}
          </p>
        )}
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="display text-xl font-bold">AI provider</h3>
            <p className="mt-1 max-w-xl text-sm text-pretty" style={{ color: 'var(--muted)' }}>
              The assistant uses the active provider below. Keys saved here are kept on the server and are never shown
              again.
            </p>
          </div>
          <Button variant="ghost" className="min-h-10" onClick={clearSession}>
            Lock
          </Button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Provider">
          {(status?.providers ?? []).map((p, i) => {
            const active = status?.active === p.id
            const on = selected === p.id
            return (
              <motion.button
                key={p.id}
                role="radio"
                aria-checked={on}
                onClick={() => setSelected(p.id)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="inner relative rounded-2xl p-4 text-left transition-colors"
                style={on ? { borderColor: 'var(--accent)', background: 'var(--fill-3)' } : undefined}
              >
                <p className="flex items-center justify-between gap-2 font-semibold">
                  <span className="truncate">
                    {p.id === 'custom' ? `Custom${p.label && p.label !== 'Custom' ? ` (${p.label})` : ''}` : p.label}
                  </span>
                  {active && (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}>
                      Active
                    </span>
                  )}
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: p.configured ? 'var(--success)' : 'var(--subtle)' }}>
                  {p.configured ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                  {p.configured ? 'Ready' : 'Not set up'} · {SOURCE_COPY[p.source]}
                </p>
                <p className="mono mt-1 truncate text-[11px]" style={{ color: 'var(--subtle)' }}>
                  {p.model ?? 'no model'}
                </p>
              </motion.button>
            )
          })}
        </div>
        {error && !current && (
          <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }} role="alert">
            {error}
          </p>
        )}
      </Panel>

      {current && (
        <Panel>
          <ProviderForm
            key={`${current.id}|${current.model}|${current.baseUrl}|${current.label}|${current.hasKey}`}
            current={current}
            busy={busy}
            saved={saved}
            test={test}
            error={error}
            onSave={(v) => void save(v)}
            onTest={() => void runTest()}
            onClear={() => void clear()}
          />
        </Panel>
      )}
    </div>
  )
}

/** The editable fields. Remounted (via key) whenever the server reports new values, so no sync effect is needed. */
function ProviderForm({
  current,
  busy,
  saved,
  test,
  error,
  onSave,
  onTest,
  onClear,
}: {
  current: ProviderStatus
  busy: string | null
  saved: boolean
  test: TestResult | null
  error: string | null
  onSave: (v: FormValues) => void
  onTest: () => void
  onClear: () => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(current.model ?? '')
  const [baseUrl, setBaseUrl] = useState(current.baseUrl ?? '')
  const [label, setLabel] = useState(current.id === 'custom' ? current.label : '')
  const [makeActive, setMakeActive] = useState(true)
  const selected = current.id

  return (
    <>
      <h4 className="display text-lg font-bold">{current.label} settings</h4>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Model" hint={`Example: ${MODEL_HINT[selected]}`}>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={MODEL_HINT[selected]} maxLength={160} className={inputClass} />
        </Field>
        <Field
          label="API key"
          hint={current.hasKey ? `A key is already set (${SOURCE_COPY[current.source].toLowerCase()}). Leave empty to keep it.` : 'Stored on the server. Never shown again.'}
        >
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={current.hasKey ? '••••••••••••' : 'Paste the key'}
            maxLength={600}
            className={inputClass}
          />
        </Field>
        {selected === 'custom' && (
          <>
            <Field label="Base URL" hint="An OpenAI-compatible endpoint, for example https://your-host/v1">
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-host/v1" maxLength={300} className={inputClass} />
            </Field>
            <Field label="Display name">
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Local model" maxLength={40} className={inputClass} />
            </Field>
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Chip active={makeActive} onClick={() => setMakeActive((v) => !v)}>
          Use as the active provider
        </Chip>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button loading={busy === 'save'} onClick={() => onSave({ apiKey, model, baseUrl, label, makeActive })}>
          Save
        </Button>
        <Button variant="ghost" loading={busy === 'test'} disabled={!current.configured} onClick={onTest}>
          <Plug className="size-4" /> Test connection
        </Button>
        {current.hasSavedSettings && (
          <Button variant="danger" loading={busy === 'clear'} onClick={onClear}>
            <Trash2 className="size-4" /> Remove saved settings
          </Button>
        )}
      </div>

      <div aria-live="polite" className="mt-3 space-y-1 text-sm">
        {saved && !error && <p style={{ color: 'var(--success)' }}>Saved. The assistant now uses these settings.</p>}
        {test && (
          <p style={{ color: test.ok ? 'var(--success)' : 'var(--danger)' }}>
            {test.ok
              ? `Connected in ${test.ms} ms.`
              : `${TEST_COPY[test.reason ?? ''] ?? 'The test failed.'}${'detail' in test && test.detail ? ` (${test.detail})` : ''}`}
          </p>
        )}
        {error && (
          <p style={{ color: 'var(--danger)' }} role="alert">
            {error}
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
        Settings are saved in <span className="mono">server/ai-settings.json</span> on the machine running the assistant
        backend, and take priority over <span className="mono">.env</span>. Environment variables remain the safest choice
        for a public deployment.
      </p>
    </>
  )
}
