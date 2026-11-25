import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { Check, Copy, ExternalLink, Loader2, LogOut, Smartphone, Wallet, X } from 'lucide-react'
import { toast } from 'sonner'
import { shortAddr } from '@/lib/p2p'
import { isTelegramMiniApp, openExternalUrl, triggerTelegramHaptic } from '@/lib/telegram'

const SAVED_WALLET_KEY = 'onpeer:tg:wallet_id'

interface TgWalletOption {
  id: string
  name: string
  badge: string
  accent: string
  /** HTTPS Universal Link for WalletConnect v2 pairing (never a raw custom scheme, avoiding ERR_UNKNOWN_URL_SCHEME in Telegram WebView). */
  buildWcUniversalLink: (wcUri: string) => string
  /** HTTPS Universal Link to open the wallet app when confirming a transaction/signature. */
  launchUrl: string
  /** Optional HTTPS Universal Link to open OnPeer directly inside the wallet's built-in dApp browser. */
  dappBrowserUrl?: (targetHttpsUrl: string) => string
}

const TG_WALLETS: TgWalletOption[] = [
  {
    id: 'metamask',
    name: 'MetaMask',
    badge: 'MM',
    accent: '#F6851B',
    buildWcUniversalLink: (uri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://metamask.app.link/wc',
    dappBrowserUrl: (url) => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//i, '')}`,
  },
  {
    id: 'trust',
    name: 'Trust Wallet',
    badge: 'TW',
    accent: '#0500FF',
    buildWcUniversalLink: (uri) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://link.trustwallet.com/wc',
    dappBrowserUrl: (url) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}`,
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    badge: 'CB',
    accent: '#0052FF',
    buildWcUniversalLink: (uri) => `https://go.cb-w.com/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://go.cb-w.com/wc',
    dappBrowserUrl: (url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    badge: 'RB',
    accent: '#174299',
    buildWcUniversalLink: (uri) => `https://rnbwapp.com/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://rnbwapp.com/wc',
  },
  {
    id: 'zerion',
    name: 'Zerion',
    badge: 'ZR',
    accent: '#2962EF',
    buildWcUniversalLink: (uri) => `https://wallet.zerion.io/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://wallet.zerion.io/wc',
  },
]

// Tiny external store so any button anywhere in the app can open the Telegram Wallet Modal
let modalOpen = false
const modalListeners = new Set<() => void>()

function setModalOpen(next: boolean) {
  if (modalOpen === next) return
  modalOpen = next
  modalListeners.forEach((fn) => fn())
}

export function openTelegramWalletModal() {
  setModalOpen(true)
}

function useModalOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      modalListeners.add(cb)
      return () => modalListeners.delete(cb)
    },
    () => modalOpen,
    () => false,
  )
}

export function getSavedTelegramWalletLaunchUrl(): string | null {
  try {
    const id = window.sessionStorage.getItem(SAVED_WALLET_KEY)
    const found = TG_WALLETS.find((w) => w.id === id)
    return found?.launchUrl ?? null
  } catch {
    return null
  }
}

interface CustomRenderProps {
  show?: () => void
  isConnected: boolean
  address?: `0x${string}`
}

/**
 * Drop-in replacement for `<ConnectKitButton.Custom>`:
 * - In standard browsers: delegates directly to ConnectKit's modal.
 * - Inside Telegram Mini App: opens `TelegramWalletModal`, which uses HTTPS Universal Links via
 *   `Telegram.WebApp.openLink(...)` so Android/iOS WebView never hits `net::ERR_UNKNOWN_URL_SCHEME`.
 */
export function ConnectWalletCustom({
  children,
}: {
  children: (props: CustomRenderProps) => ReactNode
}) {
  return (
    <ConnectKitButton.Custom>
      {({ show, isConnected, address }) =>
        children({
          isConnected,
          address,
          show: () => {
            if (isTelegramMiniApp()) {
              openTelegramWalletModal()
            } else {
              show?.()
            }
          },
        })
      }
    </ConnectKitButton.Custom>
  )
}

interface EventfulProvider {
  on?: (event: string, listener: (uri: string) => void) => void
  removeListener?: (event: string, listener: (uri: string) => void) => void
}

export function TelegramWalletModal() {
  const open = useModalOpen()
  const { address, isConnected, connector: activeConnector } = useAccount()
  const { connectors, connectAsync } = useConnect()
  const { disconnect } = useDisconnect()

  const [wcUri, setWcUri] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const pendingWalletRef = useRef<TgWalletOption | null>(null)
  const pairingStartedRef = useRef(false)

  const wcConnector = connectors.find((c) => c.id === 'walletConnect')

  const launchWalletWithUri = useCallback((wallet: TgWalletOption, uri: string) => {
    try {
      window.sessionStorage.setItem(SAVED_WALLET_KEY, wallet.id)
    } catch {
      /* ignore */
    }
    triggerTelegramHaptic('light')
    openExternalUrl(wallet.buildWcUniversalLink(uri))
  }, [])

  const startPairing = useCallback(async () => {
    if (!wcConnector || pairingStartedRef.current) return
    pairingStartedRef.current = true
    setInitializing(true)
    setWcUri(null)

    let provider: EventfulProvider | null = null
    const onDisplayUri = (uri: string) => {
      setWcUri(uri)
      setInitializing(false)
      if (pendingWalletRef.current) {
        const w = pendingWalletRef.current
        pendingWalletRef.current = null
        launchWalletWithUri(w, uri)
      }
    }

    try {
      provider = (await wcConnector.getProvider()) as EventfulProvider
      provider?.on?.('display_uri', onDisplayUri)
      await connectAsync({ connector: wcConnector })
      triggerTelegramHaptic('success')
      toast.success('Wallet connected!')
      setModalOpen(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg && !/rejected|reset|closed/i.test(msg)) {
        toast.error('Could not complete WalletConnect session. Try again or copy pairing link.')
      }
    } finally {
      provider?.removeListener?.('display_uri', onDisplayUri)
      pairingStartedRef.current = false
      setInitializing(false)
      setSelectedWalletId(null)
    }
  }, [wcConnector, connectAsync, launchWalletWithUri])

  const closeModal = () => {
    pendingWalletRef.current = null
    setSelectedWalletId(null)
    setModalOpen(false)
  }

  useEffect(() => {
    if (!open) {
      pendingWalletRef.current = null
      return
    }
    if (!isConnected && wcConnector && !wcUri && !pairingStartedRef.current) {
      void startPairing()
    }
  }, [open, isConnected, wcConnector, wcUri, startPairing])

  if (!open || typeof document === 'undefined') return null

  const handlePickWallet = (wallet: TgWalletOption) => {
    setSelectedWalletId(wallet.id)
    if (wcUri) {
      launchWalletWithUri(wallet, wcUri)
      return
    }
    pendingWalletRef.current = wallet
    if (!pairingStartedRef.current) {
      void startPairing()
    }
  }

  const handleCopyUri = async () => {
    if (!wcUri) return
    try {
      await navigator.clipboard.writeText(wcUri)
      setCopied(true)
      triggerTelegramHaptic('success')
      toast.success('WalletConnect pairing link copied! Paste it inside your wallet app.')
      window.setTimeout(() => setCopied(false), 2_500)
    } catch {
      toast.error('Could not copy link.')
    }
  }

  const currentUrl =
    typeof window !== 'undefined'
      ? `https://app.onpeer.xyz${window.location.pathname}${window.location.search}`
      : 'https://app.onpeer.xyz/p2p'

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={closeModal}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect Wallet"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl p-5 pb-7 sm:rounded-3xl sm:pb-6"
        style={{
          backgroundColor: 'var(--panel-solid)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--panel-shadow)',
          color: 'var(--ink)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="flex size-9 items-center justify-center rounded-xl text-white"
              style={{ background: 'var(--accent-bg)' }}
            >
              <Wallet className="size-4" />
            </span>
            <div>
              <h2 className="display text-base font-bold">
                {isConnected ? 'Connected Wallet' : 'Connect Mobile Wallet'}
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>
                {isConnected
                  ? activeConnector?.name ?? 'Active session'
                  : 'Opens your wallet app safely & returns to Telegram'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close wallet modal"
            className="inline-flex size-8 items-center justify-center rounded-full"
            style={{ background: 'var(--fill-2)', color: 'var(--muted)' }}
          >
            <X className="size-4" />
          </button>
        </div>

        {isConnected && address ? (
          <div className="mt-5 space-y-3">
            <div
              className="flex items-center justify-between rounded-2xl px-4 py-3"
              style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
            >
              <span className="mono text-sm font-bold">{shortAddr(address)}</span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(address)
                    toast.success('Wallet address copied')
                  } catch {
                    /* ignore */
                  }
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                <Copy className="size-3.5" /> Copy
              </button>
            </div>

            {getSavedTelegramWalletLaunchUrl() && (
              <button
                type="button"
                onClick={() => {
                  const u = getSavedTelegramWalletLaunchUrl()
                  if (u) openExternalUrl(u)
                }}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-xs font-bold"
                style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--ink)' }}
              >
                Open Wallet App <ExternalLink className="size-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                disconnect()
                setModalOpen(false)
                toast.info('Wallet disconnected')
              }}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 text-xs font-bold text-red-400"
            >
              <LogOut className="size-3.5" /> Disconnect Wallet
            </button>
          </div>
        ) : !wcConnector ? (
          <div className="mt-5 space-y-3">
            <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
              Open OnPeer directly inside your mobile wallet&apos;s built-in browser for instant one-tap signing:
            </p>
            <button
              type="button"
              onClick={() => openExternalUrl(`https://metamask.app.link/dapp/${currentUrl.replace(/^https?:\/\//i, '')}`)}
              className="flex min-h-11 w-full items-center justify-between rounded-xl px-4 text-xs font-bold text-white"
              style={{ background: 'var(--accent-bg)' }}
            >
              <span>Open in MetaMask Browser</span>
              <ExternalLink className="size-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                openExternalUrl(`https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(currentUrl)}`)
              }
              className="flex min-h-11 w-full items-center justify-between rounded-xl px-4 text-xs font-bold"
              style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--ink)' }}
            >
              <span>Open in Trust Wallet Browser</span>
              <ExternalLink className="size-4" />
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-1 gap-2">
              {TG_WALLETS.map((w) => {
                const waiting = selectedWalletId === w.id && !wcUri
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => handlePickWallet(w)}
                    className="flex min-h-12 w-full items-center justify-between rounded-2xl px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--fill-3)]"
                    style={{
                      background: selectedWalletId === w.id ? 'var(--fill-3)' : 'var(--fill-2)',
                      border: `1px solid ${selectedWalletId === w.id ? 'var(--border-strong)' : 'var(--border)'}`,
                    }}
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-xl text-[11px] font-extrabold text-white"
                        style={{ backgroundColor: w.accent }}
                      >
                        {w.badge}
                      </span>
                      <span>
                        <span className="block text-sm font-bold">{w.name}</span>
                        <span className="block text-[11px]" style={{ color: 'var(--subtle)' }}>
                          {selectedWalletId === w.id && wcUri
                            ? 'Approve in wallet, then switch back to Telegram'
                            : 'Tap to connect via WalletConnect'}
                        </span>
                      </span>
                    </span>
                    {waiting ? (
                      <Loader2 className="size-4 animate-spin" style={{ color: 'var(--accent)' }} />
                    ) : (
                      <ExternalLink className="size-4" style={{ color: 'var(--subtle)' }} />
                    )}
                  </button>
                )
              })}
            </div>

            {/* Copy Pairing URI for OKX, Bybit, Bitget, Rabby, SafePal, etc. */}
            <button
              type="button"
              disabled={!wcUri}
              onClick={() => void handleCopyUri()}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--ink)' }}
            >
              {initializing && !wcUri ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" style={{ color: 'var(--accent)' }} />
                  <span>Preparing secure pairing link…</span>
                </>
              ) : copied ? (
                <>
                  <Check className="size-3.5" style={{ color: 'var(--success)' }} />
                  <span>Copied! Paste in OKX / Bitget / Bybit / Rabby</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5" style={{ color: 'var(--accent)' }} />
                  <span>Copy link (OKX, Bybit, Bitget, Rabby, SafePal)</span>
                </>
              )}
            </button>

            {/* Fallback: Open directly inside MetaMask / Trust in-app dApp browser */}
            <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--subtle)' }}>
                <Smartphone className="size-3.5" style={{ color: 'var(--accent)' }} />
                Prefer zero app-switching? Open inside wallet browser:
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    openExternalUrl(`https://metamask.app.link/dapp/${currentUrl.replace(/^https?:\/\//i, '')}`)
                  }
                  className="flex min-h-9 items-center justify-center gap-1.5 rounded-xl text-[11px] font-bold"
                  style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--muted)' }}
                >
                  MetaMask Browser <ExternalLink className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openExternalUrl(
                      `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(currentUrl)}`,
                    )
                  }
                  className="flex min-h-9 items-center justify-center gap-1.5 rounded-xl text-[11px] font-bold"
                  style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--muted)' }}
                >
                  Trust Browser <ExternalLink className="size-3" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
