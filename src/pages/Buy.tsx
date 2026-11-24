import { useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, Lock, Sparkles, Unlock } from 'lucide-react'
import { SiteBar } from '@/components/SiteBar'
import { BuyUsdcPanel } from '@/components/BuyUsdcPanel'
import { AppLink } from '@/components/AppLink'

const UNLOCK_STORAGE_KEY = 'onpeer-buy-dev-unlocked'

function readInitialUnlocked(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage?.getItem(UNLOCK_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export default function BuyPage() {
  const [unlocked, setUnlocked] = useState<boolean>(readInitialUnlocked)
  const [showPassPrompt, setShowPassPrompt] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = passcode.trim()
    if (!trimmed) {
      setError('Enter the developer passcode.')
      return
    }
    setChecking(true)
    setError(null)
    try {
      const res = await fetch('/api/onramp/dev-unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passcode: trimmed }),
      })
      if (res.ok) {
        try {
          window.sessionStorage?.setItem(UNLOCK_STORAGE_KEY, '1')
        } catch {
          /* ignore storage issues */
        }
        setUnlocked(true)
        setPasscode('')
        return
      }
      if (res.status === 429) {
        setError('Too many attempts. Please wait a minute and try again.')
        return
      }
      if (
        import.meta.env.DEV &&
        (res.status === 503 || res.status === 502 || res.status === 404) &&
        trimmed === (import.meta.env.VITE_ONRAMP_DEV_PASS || 'onpeer-dev')
      ) {
        try {
          window.sessionStorage?.setItem(UNLOCK_STORAGE_KEY, '1')
        } catch {
          /* ignore storage issues */
        }
        setUnlocked(true)
        setPasscode('')
        return
      }
      if (res.status === 503) {
        setError('Developer passcode is not configured on the server yet (ONRAMP_DEV_PASS).')
        return
      }
      setError('Invalid developer passcode.')
    } catch {
      if (import.meta.env.DEV && trimmed === (import.meta.env.VITE_ONRAMP_DEV_PASS || 'onpeer-dev')) {
        try {
          window.sessionStorage?.setItem(UNLOCK_STORAGE_KEY, '1')
        } catch {
          /* ignore storage issues */
        }
        setUnlocked(true)
        setPasscode('')
        return
      }
      setError('Could not reach verification endpoint.')
    } finally {
      setChecking(false)
    }
  }

  const handleLock = () => {
    try {
      window.sessionStorage?.removeItem(UNLOCK_STORAGE_KEY)
    } catch {
      /* ignore storage issues */
    }
    setUnlocked(false)
    setShowPassPrompt(false)
    setPasscode('')
    setError(null)
  }

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteBar />
      <div className="relative z-10 flex flex-1 w-full flex-col items-center justify-center overflow-hidden px-4 py-4 sm:py-6">
        {unlocked ? (
          <>
            <div
              className="relative z-30 mb-3 flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-semibold"
              style={{ background: 'var(--panel-solid)', borderColor: 'var(--border-strong)' }}
            >
              <Unlock className="size-3.5" style={{ color: 'var(--accent)' }} />
              <span>Developer preview unlocked</span>
              <button
                type="button"
                onClick={handleLock}
                className="ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold transition-colors hover:opacity-80"
                style={{ background: 'var(--fill-3)', color: 'var(--ink)' }}
              >
                Lock
              </button>
            </div>
            <div className="relative z-20 flex w-full justify-center">
              <BuyUsdcPanel />
            </div>
          </>
        ) : (
          /* Single self-contained rounded card — clipped cleanly so zero blur bleeds outside the border */
          <div
            className="relative z-30 w-full max-w-md overflow-hidden rounded-3xl"
            style={{
              backgroundColor: 'var(--panel-solid)',
              border: '1px solid var(--border-strong)',
              boxShadow: 'var(--panel-shadow)',
            }}
          >
            {/* Clipped, heavily frosted preview underneath */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 select-none overflow-hidden opacity-20 blur-xl"
            >
              <BuyUsdcPanel />
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 backdrop-blur-md"
              style={{ background: 'color-mix(in srgb, var(--panel-solid) 86%, transparent)' }}
            />

            {/* Crisp Coming Soon + Developer Access content */}
            <div className="relative z-10 p-6 text-center sm:p-8">
              <span
                className="mx-auto inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em]"
                style={{
                  background: 'rgba(255, 90, 0, 0.14)',
                  border: '1px solid rgba(255, 90, 0, 0.4)',
                  color: 'var(--accent)',
                }}
              >
                <Sparkles className="size-3.5" /> Coming Soon
              </span>

              <h1 className="display mt-4 text-3xl font-bold sm:text-4xl" style={{ color: 'var(--ink)' }}>
                Buy USDC is Coming Soon
              </h1>

              <p className="mt-2.5 text-pretty text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                Direct card, Apple Pay and bank-transfer USDC purchases are currently in private testing. You can buy
                and sell USDC anytime with local payment apps on the P2P market.
              </p>

              <div className="mt-6 flex flex-col items-center gap-3">
                <AppLink
                  to="/p2p"
                  className="btn-shine inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
                  style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}
                >
                  Open P2P Market <ArrowRight className="size-4" />
                </AppLink>

                {!showPassPrompt ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowPassPrompt(true)
                      setError(null)
                    }}
                    className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold transition-colors hover:opacity-80"
                    style={{ color: 'var(--subtle)' }}
                  >
                    <KeyRound className="size-3.5" /> Developer access
                  </button>
                ) : (
                  <form onSubmit={handleUnlock} className="mt-2 w-full space-y-2 text-left">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Lock
                          className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2"
                          style={{ color: 'var(--subtle)' }}
                        />
                        <input
                          type="password"
                          value={passcode}
                          onChange={(e) => setPasscode(e.target.value)}
                          placeholder="Enter developer passcode"
                          autoFocus
                          autoComplete="off"
                          className="inner h-10 w-full rounded-xl pl-8 pr-3 text-xs font-medium outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={checking}
                        className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl px-4 text-xs font-bold transition-opacity disabled:opacity-50"
                        style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}
                      >
                        {checking ? 'Checking…' : 'Unlock'}
                      </button>
                    </div>
                    {error && (
                      <p className="text-xs font-medium" style={{ color: 'var(--danger)' }}>
                        {error}
                      </p>
                    )}
                  </form>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
