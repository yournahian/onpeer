import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useReadContract, useSignMessage } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import type {
  OnrampEventEnvelope,
  OnrampLifecycleOptions,
  OnrampSession,
  OnrampWidget,
  OnrampWindowBlockedReason,
} from '@circle-fin/app-kit'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { buildAddressExplorerUrl, getUsdc } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import {
  BackendApiError,
  clearBackendSession,
  signInWithWallet,
  useBackendSession,
} from '@/lib/api'
import { getSandboxOnrampKit, kitErrorMessage } from '@/lib/appkit'
import { shortAddr } from '@/lib/p2p'
import { AppLink } from '@/components/AppLink'
import { Button } from '@/components/ui'

type CheckoutPhase =
  | 'idle'
  | 'signing_in'
  | 'minting'
  | 'session_ready'
  | 'waiting_widget'
  | 'submitted_final'
  | 'settled'
  | 'not_completed'
  | 'error'

const USDC_ADDRESS = getUsdc(arcTestnet.id)?.address as Address | undefined

function isSessionFresh(session: OnrampSession | null, skewMs = 5_000): session is OnrampSession {
  if (!session?.expiresAt) return false
  const expMs = Date.parse(session.expiresAt)
  return Number.isFinite(expMs) && expMs > Date.now() + skewMs
}

export function BuyUsdcPanel() {
  const { address } = useAccount()
  return <BuyUsdcPanelInner key={address?.toLowerCase() ?? 'disconnected'} />
}

function BuyUsdcPanelInner() {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const backendSession = useBackendSession()

  const usdcBalance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: !!address && !!USDC_ADDRESS, refetchInterval: 10_000 },
  })

  const kitStatus = getSandboxOnrampKit()

  const [phase, setPhase] = useState<CheckoutPhase>('idle')
  const [mintedSession, setMintedSession] = useState<OnrampSession | null>(null)
  const [blockedReason, setBlockedReason] = useState<OnrampWindowBlockedReason | null>(null)
  const [inlineMode, setInlineMode] = useState(false)
  const [statusNote, setStatusNote] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [lastEvent, setLastEvent] = useState<{ event: string; code: string } | null>(null)
  const [baselineBalance, setBaselineBalance] = useState<bigint | null>(null)

  const widgetRef = useRef<OnrampWidget | null>(null)
  const iframeContainerRef = useRef<HTMLDivElement | null>(null)
  const expiredRetryCountRef = useRef(0)

  const closeActiveWidget = useCallback(() => {
    if (widgetRef.current) {
      widgetRef.current.close()
      widgetRef.current = null
    }
  }, [])

  // Tear down widget on unmount
  useEffect(() => {
    return () => {
      closeActiveWidget()
    }
  }, [closeActiveWidget])

  const signedInForWallet =
    !!address && !!backendSession && backendSession.wallet.toLowerCase() === address.toLowerCase()

  const refreshOnchainBalance = useCallback(() => {
    void usdcBalance.refetch()
    window.setTimeout(() => {
      void usdcBalance.refetch()
    }, 3_000)
  }, [usdcBalance])

  const mintSessionForWallet = useCallback(
    async (isAutoRetry = false): Promise<OnrampSession | null> => {
      if (!address) return null
      if (!kitStatus.ok) {
        setErrorMsg(kitStatus.error)
        setPhase('error')
        return null
      }

      if (!isAutoRetry) {
        expiredRetryCountRef.current = 0
      }
      setErrorMsg(null)
      setBlockedReason(null)

      try {
        let activeSession = backendSession
        const walletLower = address.toLowerCase()
        if (!activeSession || activeSession.wallet.toLowerCase() !== walletLower) {
          setPhase('signing_in')
          setStatusNote('Confirm the gasless wallet sign-in message in your wallet...')
          activeSession = await signInWithWallet(address, signMessageAsync)
        }

        setPhase('minting')
        setStatusNote(
          isAutoRetry ? 'Session expired — minting 1 fresh sandbox session...' : 'Minting sandbox session...',
        )

        const session = await kitStatus.kit.onramp.fetchSession({
          url: '/api/onramp/session',
          headers: {
            authorization: `Bearer ${activeSession.token}`,
          },
          body: {
            // Ignored on the server — forced to auth.session.wallet, wallet:<lowercase>, and server-side USDC filter
            appUserId: `wallet:${walletLower}`,
            destinationAddress: walletLower,
          },
          fetch: async (input, init) => {
            const res = await globalThis.fetch(input, init)
            if (!res.ok) {
              const payload = (await res.clone().json().catch(() => ({}))) as { error?: string }
              if (res.status === 401) clearBackendSession()
              throw new BackendApiError(payload.error ?? 'onramp_provider_error', res.status)
            }
            return res
          },
        })

        if (usdcBalance.data !== undefined) {
          setBaselineBalance(usdcBalance.data)
        }
        setMintedSession(session)
        setPhase('session_ready')
        setStatusNote('Sandbox session ready. Click "Open checkout" to launch the Circle sandbox widget.')
        return session
      } catch (err) {
        if (err instanceof BackendApiError) {
          setErrorMsg(err.message)
        } else {
          const msg = kitErrorMessage(err)
          if (msg) setErrorMsg(msg)
        }
        setPhase('error')
        setStatusNote(null)
        return null
      }
    },
    [address, backendSession, kitStatus, signMessageAsync, usdcBalance.data],
  )

  const handleWidgetEnvelope = useCallback(
    (envelope: OnrampEventEnvelope) => {
      setLastEvent({ event: envelope.event, code: envelope.code })

      switch (envelope.event) {
        case 'INITIALIZATION_SUCCESS': {
          setPhase('waiting_widget')
          setStatusNote('Sandbox checkout loaded. Use dummy test data only — never real card or bank details.')
          break
        }
        case 'INITIALIZATION_ERROR': {
          const msg =
            typeof envelope.payload?.errorMessage === 'string' && envelope.payload.errorMessage
              ? envelope.payload.errorMessage
              : `Widget could not initialize (${envelope.code}).`
          setErrorMsg(msg)
          setPhase('error')
          break
        }
        case 'DEPOSIT_SUBMITTED': {
          // In sandbox, settlementExpected is false and DEPOSIT_SUBMITTED is the final event.
          if (envelope.payload.settlementExpected === false) {
            setPhase('submitted_final')
            setStatusNote(
              'Sandbox checkout submitted (settlementExpected: false — final sandbox event). Checking Arc Testnet USDC balance onchain...',
            )
            refreshOnchainBalance()
          } else {
            setPhase('waiting_widget')
            setStatusNote('Deposit submitted — waiting for onchain settlement confirmation...')
            refreshOnchainBalance()
          }
          break
        }
        case 'DEPOSIT_SETTLED': {
          setPhase('settled')
          setStatusNote('Deposit event received. Verifying USDC balance directly on Arc Testnet...')
          refreshOnchainBalance()
          break
        }
        case 'DEPOSIT_NOT_COMPLETED': {
          setPhase('not_completed')
          if (envelope.code === 'CANCELED_BY_CUSTOMER') {
            setStatusNote('Checkout closed without completing a sandbox purchase.')
          } else if (envelope.code === 'NO_PAYMENT_OPTIONS') {
            setStatusNote(
              'No payment options were available for the selected country/currency in Circle Sandbox. Try OnPeer P2P for local South Asian payment methods.',
            )
          } else {
            setStatusNote(`Checkout ended without completion (${envelope.code}).`)
          }
          break
        }
      }
    },
    [refreshOnchainBalance],
  )

  const buildLifecycleOptions = useCallback(
    (session: OnrampSession): OnrampLifecycleOptions => ({
      session,
      onAnyEvent: handleWidgetEnvelope,
      onSessionExpired: () => {
        closeActiveWidget()
        setMintedSession(null)
        if (expiredRetryCountRef.current < 1) {
          expiredRetryCountRef.current += 1
          void mintSessionForWallet(true)
        } else {
          setPhase('error')
          setErrorMsg('The sandbox checkout session expired. Click "Continue" to mint a new session.')
        }
      },
    }),
    [closeActiveWidget, handleWidgetEnvelope, mintSessionForWallet],
  )

  // Synchronize external DOM iframe mount when inline fallback mode is active
  useEffect(() => {
    if (!inlineMode || !mintedSession || !kitStatus.ok || !iframeContainerRef.current) return
    if (!isSessionFresh(mintedSession)) return

    closeActiveWidget()
    try {
      const widget = kitStatus.kit.onramp.mountIframe({
        ...buildLifecycleOptions(mintedSession),
        container: iframeContainerRef.current,
        title: 'Circle Onramp Sandbox',
      })
      widgetRef.current = widget
    } catch {
      /* handled via widget onInitializationError / session freshness guard */
    }

    return () => {
      closeActiveWidget()
    }
  }, [buildLifecycleOptions, closeActiveWidget, inlineMode, kitStatus, mintedSession])

  const activateInlineFallback = (reasonNote: string) => {
    if (!isSessionFresh(mintedSession)) {
      setMintedSession(null)
      setInlineMode(false)
      setPhase('idle')
      setErrorMsg('Session expired before mounting inline checkout. Click "Continue" to mint a new one.')
      return
    }
    setInlineMode(true)
    setPhase('waiting_widget')
    setStatusNote(reasonNote)
  }

  // Step 2: MUST be synchronous inside click handler — zero awaits before kit.onramp.openWindow!
  const handleOpenPopupSynchronously = () => {
    if (!kitStatus.ok) {
      setErrorMsg(kitStatus.error)
      setPhase('error')
      return
    }
    if (!isSessionFresh(mintedSession)) {
      setMintedSession(null)
      setPhase('idle')
      setErrorMsg('Your checkout session expired. Click "Continue" to mint a fresh session.')
      return
    }

    setErrorMsg(null)
    setBlockedReason(null)
    closeActiveWidget()

    try {
      const result = kitStatus.kit.onramp.openWindow({
        ...buildLifecycleOptions(mintedSession),
      })

      if (result.status === 'blocked') {
        setBlockedReason(result.reason)
        if (result.reason === 'in_app_browser' || result.reason === 'pwa_standalone') {
          activateInlineFallback('In-app browser detected — switched to inline sandbox checkout.')
        } else {
          setPhase('session_ready')
          setStatusNote(
            'Popup was blocked by your browser. Allow popups for this site and click "Open checkout" again, or switch to inline mode below.',
          )
        }
        return
      }

      widgetRef.current = result.widget
      setPhase('waiting_widget')
      setStatusNote('Sandbox popup opened. Complete the dummy checkout in the Circle window.')
    } catch (err) {
      setMintedSession(null)
      setPhase('error')
      setErrorMsg(kitErrorMessage(err) ?? 'Failed to open sandbox checkout window.')
    }
  }

  const formattedBalance = usdcBalance.data !== undefined ? formatUsdc(usdcBalance.data) : '...'
  const balanceDelta =
    baselineBalance !== null && usdcBalance.data !== undefined ? usdcBalance.data - baselineBalance : null

  return (
    <div className="w-full max-w-[490px] space-y-2.5">
      {/* Compact Mandatory Sandbox Warning Strip */}
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-2xl px-3.5 py-2.5 text-xs shadow-sm"
        style={{
          background: 'color-mix(in srgb, var(--warn) 16%, var(--panel-solid))',
          border: '1px solid color-mix(in srgb, var(--warn) 48%, var(--border))',
          color: 'var(--ink)',
        }}
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warn)' }} />
        <p className="leading-snug">
          <strong>Sandbox. No real money. Use dummy data.</strong>{' '}
          <span style={{ color: 'var(--muted)' }}>
            Connects exclusively to <code className="mono">onramp-sandbox.arc.io</code>—never enter real card, bank, or
            ID details.
          </span>
        </p>
      </div>

      {/* Main Compact Checkout Card */}
      <section
        className="rounded-[24px] p-4 backdrop-blur-2xl sm:rounded-[26px] sm:p-5"
        style={{
          background: 'color-mix(in srgb, var(--panel-solid) 95%, transparent)',
          border: '1px solid var(--border-strong)',
          boxShadow: '0 24px 80px -20px var(--accent-glow), 0 12px 40px -12px rgba(0,0,0,0.28)',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
              Circle Onramp • Sandbox
            </p>
            <h1 className="display mt-0.5 text-xl font-bold sm:text-2xl">Buy USDC with fiat</h1>
          </div>
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--warn)' }}
          >
            Testnet Sandbox
          </span>
        </div>

        {/* Destination Wallet & Onchain Balance Box */}
        <div
          className="mt-3 rounded-xl px-3.5 py-2.5"
          style={{ background: 'var(--fill-1)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--muted)' }}>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Wallet className="size-3.5" style={{ color: 'var(--accent)' }} /> Destination wallet (server-locked)
            </span>
            {address && (
              <a
                href={buildAddressExplorerUrl(arcTestnet.id, address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                Explorer <ExternalLink className="size-3" />
              </a>
            )}
          </div>

          {isConnected && address ? (
            <div className="mt-1.5 space-y-1">
              <p className="mono break-all text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                {address}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span style={{ color: 'var(--muted)' }}>
                  Arc Testnet balance:{' '}
                  <strong className="mono" style={{ color: 'var(--ink)' }}>
                    {formattedBalance} USDC
                  </strong>
                  {balanceDelta !== null && balanceDelta > 0n && (
                    <span className="ml-1.5 font-semibold" style={{ color: 'var(--success)' }}>
                      (+{formatUsdc(balanceDelta)} USDC)
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void usdcBalance.refetch()}
                  className="inline-flex items-center gap-1 font-semibold hover:opacity-80"
                  style={{ color: 'var(--accent)' }}
                >
                  <RefreshCw className={`size-3 ${usdcBalance.isFetching ? 'animate-spin' : ''}`} /> Refresh
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
              Connect your wallet below. Checkout delivery is locked on the server to your signed-in wallet.
            </p>
          )}
        </div>

        {/* Combined Compact Partner KYC & South Asia Disclosures */}
        <div
          className="mt-2.5 space-y-1.5 rounded-xl px-3.5 py-2.5 text-[11px] leading-snug"
          style={{ background: 'var(--fill-1)', border: '1px solid var(--border)', color: 'var(--muted)' }}
        >
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>
              <strong style={{ color: 'var(--ink)' }}>Separate partner verification:</strong> Checks inside the widget
              are run by Circle&apos;s partner (separate from OnPeer Didit KYC). OnPeer never sees card or bank data.
            </span>
          </p>
          <p className="flex items-start gap-2">
            <Globe className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>
              <strong style={{ color: 'var(--ink)' }}>Regional availability:</strong> South Asia (India, Pakistan,
              Bangladesh, Sri Lanka, Nepal, Bhutan, Maldives, Afghanistan) is{' '}
              <strong style={{ color: 'var(--ink)' }}>not guaranteed</strong>—use{' '}
              <AppLink to="/p2p" className="font-semibold underline" style={{ color: 'var(--accent)' }}>
                OnPeer P2P
              </AppLink>{' '}
              for UPI, bKash, Nagad, Raast, or eSewa.
            </span>
          </p>
        </div>

        {/* Client Env Guard Error (only checked inside /buy) */}
        {!kitStatus.ok && (
          <div
            role="alert"
            className="mt-2.5 rounded-xl px-3.5 py-2.5 text-xs"
            style={{
              background: 'rgba(232,109,122,0.12)',
              border: '1px solid rgba(232,109,122,0.35)',
              color: 'var(--danger)',
            }}
          >
            {kitStatus.error}
          </div>
        )}

        {/* Runtime Error Alert */}
        {errorMsg && (
          <div
            role="alert"
            className="mt-2.5 rounded-xl px-3.5 py-2.5 text-xs"
            style={{
              background: 'rgba(232,109,122,0.12)',
              border: '1px solid rgba(232,109,122,0.35)',
              color: 'var(--danger)',
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Popup Blocked Recovery */}
        {blockedReason === 'popup_blocked' && !inlineMode && isSessionFresh(mintedSession) && (
          <div
            className="mt-2.5 space-y-1.5 rounded-xl px-3.5 py-2.5 text-xs"
            style={{
              background: 'color-mix(in srgb, var(--warn) 14%, var(--fill-1))',
              border: '1px solid color-mix(in srgb, var(--warn) 40%, var(--border))',
              color: 'var(--ink)',
            }}
          >
            <p className="font-semibold">Popup blocked by your browser</p>
            <p style={{ color: 'var(--muted)' }}>
              Allow popups for this site and click <strong>Open checkout</strong> again, or switch to inline mode.
            </p>
            <button
              type="button"
              onClick={() => activateInlineFallback('Mounted inline sandbox checkout. Use dummy test data only.')}
              className="font-semibold underline"
              style={{ color: 'var(--accent)' }}
            >
              Switch to inline checkout on this page
            </button>
          </div>
        )}

        {/* Lifecycle Status Note */}
        {statusNote && (
          <div
            aria-live="polite"
            className="mt-2.5 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs"
            style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--ink)' }}
          >
            {phase === 'signing_in' || phase === 'minting' || phase === 'waiting_widget' ? (
              <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" style={{ color: 'var(--accent)' }} />
            ) : (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--success)' }} />
            )}
            <div className="space-y-0.5">
              <p className="leading-snug">{statusNote}</p>
              {lastEvent && (
                <p className="mono text-[10px]" style={{ color: 'var(--subtle)' }}>
                  Last widget event: {lastEvent.event} ({lastEvent.code})
                </p>
              )}
              {phase === 'submitted_final' && (
                <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  Dummy card submissions in Circle Sandbox simulate checkout without minting real onchain tokens.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Two-step Popup Action Bar */}
        <div className="mt-3.5 space-y-2">
          {!isConnected || !address ? (
            <ConnectKitButton.Custom>
              {({ show }) => (
                <Button className="w-full rounded-full py-3 text-sm font-bold" onClick={show}>
                  Connect wallet to continue
                </Button>
              )}
            </ConnectKitButton.Custom>
          ) : !isSessionFresh(mintedSession) ? (
            <Button
              className="w-full rounded-full py-3 text-sm font-bold"
              loading={phase === 'signing_in' || phase === 'minting'}
              disabled={!kitStatus.ok || phase === 'signing_in' || phase === 'minting'}
              onClick={() => {
                expiredRetryCountRef.current = 0
                void mintSessionForWallet(false)
              }}
            >
              {phase === 'signing_in'
                ? 'Sign message in wallet...'
                : phase === 'minting'
                  ? 'Minting sandbox session...'
                  : signedInForWallet
                    ? `Continue (${shortAddr(address)})`
                    : `Sign in & Continue (${shortAddr(address)})`}
            </Button>
          ) : !inlineMode ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Button className="w-full rounded-full py-3 text-sm font-bold" onClick={handleOpenPopupSynchronously}>
                Open checkout <ExternalLink className="size-4" />
              </Button>
              <Button
                variant="ghost"
                className="rounded-full px-4 py-3 text-xs font-semibold"
                onClick={() => {
                  closeActiveWidget()
                  setMintedSession(null)
                  setPhase('idle')
                  setStatusNote(null)
                }}
              >
                Reset session
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                Inline sandbox widget active
              </span>
              <Button
                variant="ghost"
                className="px-3 py-2 text-xs"
                onClick={() => {
                  closeActiveWidget()
                  setInlineMode(false)
                  setMintedSession(null)
                  setPhase('idle')
                  setStatusNote(null)
                }}
              >
                Close inline checkout
              </Button>
            </div>
          )}
        </div>

        {/* Inline Iframe Fallback Container (explicit height 720px per Circle Onramp spec) */}
        {inlineMode && (
          <div
            ref={iframeContainerRef}
            className="mt-3 w-full overflow-hidden rounded-2xl"
            style={{
              height: '720px',
              minHeight: '720px',
              background: 'var(--fill-1)',
              border: '1px solid var(--border)',
            }}
          />
        )}

        {/* Secondary Cross-Links */}
        <div
          className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
        >
          <AppLink
            to="/p2p"
            className="inline-flex items-center gap-1 font-semibold hover:underline"
            style={{ color: 'var(--ink)' }}
          >
            Buy via P2P local methods <ArrowRight className="size-3.5" />
          </AppLink>
          <AppLink
            to="/p2p?mode=sell"
            className="inline-flex items-center gap-1 font-semibold hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Need to cash out USDC? <ArrowRight className="size-3.5" />
          </AppLink>
        </div>
      </section>
    </div>
  )
}
