import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { Check, Copy, ExternalLink, Loader2, LogOut, X } from 'lucide-react'
import { toast } from 'sonner'
import WalletMetamask from '@web3icons/react/icons/wallets/WalletMetamask'
import WalletTrust from '@web3icons/react/icons/wallets/WalletTrust'
import WalletCoinbase from '@web3icons/react/icons/wallets/WalletCoinbase'
import WalletOkx from '@web3icons/react/icons/wallets/WalletOkx'
import WalletRainbow from '@web3icons/react/icons/wallets/WalletRainbow'
import WalletZerion from '@web3icons/react/icons/wallets/WalletZerion'
import WalletSafe from '@web3icons/react/icons/wallets/WalletSafe'
import WalletArgent from '@web3icons/react/icons/wallets/WalletArgent'
import WalletPhantom from '@web3icons/react/icons/wallets/WalletPhantom'
import WalletRabby from '@web3icons/react/icons/wallets/WalletRabby'
import WalletImtoken from '@web3icons/react/icons/wallets/WalletImtoken'
import WalletTokenPocket from '@web3icons/react/icons/wallets/WalletTokenPocket'
import WalletWalletConnect from '@web3icons/react/icons/wallets/WalletWalletConnect'
import { shortAddr } from '@/lib/p2p'
import { useTheme } from '@/lib/theme'
import { isTelegramMiniApp, openExternalUrl, triggerTelegramHaptic } from '@/lib/telegram'

const SAVED_WALLET_KEY = 'onpeer:tg:wallet_id'

type Web3WalletIcon = ComponentType<{
  variant?: 'branded' | 'mono' | 'background'
  size?: number | string
  className?: string
}>

interface TgWalletOption {
  id: string
  name: string
  Icon: Web3WalletIcon
  /**
   * Verified HTTPS Universal Link for WalletConnect v2 pairing.
   * Never uses raw custom URL schemes (`wc:`, `metamask://`) so Android/iOS Telegram WebView
   * never triggers `net::ERR_UNKNOWN_URL_SCHEME`.
   * If omitted, tapping copies the WalletConnect URI so the user can paste it inside that wallet.
   */
  buildWcUniversalLink?: (wcUri: string) => string
  /** HTTPS Universal Link to foreground the wallet app during transaction/signature prompts. */
  launchUrl?: string
}

const TG_WALLETS: TgWalletOption[] = [
  {
    id: 'metamask',
    name: 'MetaMask',
    Icon: WalletMetamask,
    buildWcUniversalLink: (uri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://metamask.app.link/wc',
  },
  {
    id: 'trust',
    name: 'Trust',
    Icon: WalletTrust,
    buildWcUniversalLink: (uri) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://link.trustwallet.com/wc',
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    Icon: WalletCoinbase,
    buildWcUniversalLink: (uri) => `https://go.cb-w.com/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://go.cb-w.com/wc',
  },
  {
    id: 'okx',
    name: 'OKX',
    Icon: WalletOkx,
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    Icon: WalletRainbow,
    buildWcUniversalLink: (uri) => `https://rnbwapp.com/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://rnbwapp.com/wc',
  },
  {
    id: 'zerion',
    name: 'Zerion',
    Icon: WalletZerion,
    buildWcUniversalLink: (uri) => `https://app.zerion.io/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://app.zerion.io/wc',
  },
  {
    id: 'safe',
    name: 'Safe',
    Icon: WalletSafe,
    buildWcUniversalLink: (uri) => `https://gnosis-safe.io/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://gnosis-safe.io/wc',
  },
  {
    id: 'argent',
    name: 'Argent',
    Icon: WalletArgent,
    buildWcUniversalLink: (uri) => `https://argent.link/app/wc?uri=${encodeURIComponent(uri)}`,
    launchUrl: 'https://argent.link/app/wc',
  },
  {
    id: 'phantom',
    name: 'Phantom',
    Icon: WalletPhantom,
  },
  {
    id: 'rabby',
    name: 'Rabby',
    Icon: WalletRabby,
  },
  {
    id: 'imtoken',
    name: 'imToken',
    Icon: WalletImtoken,
  },
  {
    id: 'tokenpocket',
    name: 'TokenPocket',
    Icon: WalletTokenPocket,
  },
]

// Tiny external store so any Connect button in the app can open the Telegram Wallet Modal
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

export function useTelegramWalletModalOpen(): boolean {
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
 * - Inside Telegram Mini App: opens `TelegramWalletModal` (ConnectKit-style Choose Wallet grid
 *   backed by HTTPS Universal Links via `Telegram.WebApp.openLink` so Android/iOS WebView never
 *   crashes with `net::ERR_UNKNOWN_URL_SCHEME`).
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
  const open = useTelegramWalletModalOpen()
  const { resolved } = useTheme()
  const isDark = resolved === 'dark'
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

  const deliverWalletAction = useCallback(async (wallet: TgWalletOption, uri: string) => {
    if (wallet.buildWcUniversalLink) {
      try {
        window.sessionStorage.setItem(SAVED_WALLET_KEY, wallet.id)
      } catch {
        /* ignore */
      }
      triggerTelegramHaptic('light')
      openExternalUrl(wallet.buildWcUniversalLink(uri))
      return
    }

    try {
      await navigator.clipboard.writeText(uri)
      setCopied(true)
      triggerTelegramHaptic('success')
      toast.success(`Link copied! Open ${wallet.name} and paste in WalletConnect.`)
      window.setTimeout(() => setCopied(false), 2_500)
    } catch {
      toast.error('Could not copy WalletConnect link.')
    }
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
        void deliverWalletAction(w, uri)
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
        toast.error('Connection interrupted. Tap a wallet to try again.')
      }
    } finally {
      provider?.removeListener?.('display_uri', onDisplayUri)
      pairingStartedRef.current = false
      setInitializing(false)
      setSelectedWalletId(null)
    }
  }, [wcConnector, connectAsync, deliverWalletAction])

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
      void deliverWalletAction(wallet, wcUri)
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
      toast.success('Copied to clipboard')
      window.setTimeout(() => setCopied(false), 2_500)
    } catch {
      toast.error('Could not copy link.')
    }
  }

  const currentUrl =
    typeof window !== 'undefined'
      ? `https://app.onpeer.xyz${window.location.pathname}${window.location.search}`
      : 'https://app.onpeer.xyz/p2p'

  const sheetBg = isDark ? '#1f2023' : '#ffffff'
  const sheetBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'
  const subtleBg = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.045)'
  const subtleHoverBg = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)'
  const textPrimary = isDark ? '#f5f5f7' : '#111827'
  const textSecondary = isDark ? '#9ca3af' : '#6b7280'

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={closeModal}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isConnected ? 'Connected Wallet' : 'Choose Wallet'}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[380px] rounded-t-[28px] px-5 pt-5 sm:rounded-[28px]"
        style={{
          backgroundColor: sheetBg,
          border: `1px solid ${sheetBorder}`,
          boxShadow: '0 -12px 48px rgba(0, 0, 0, 0.5)',
          color: textPrimary,
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 1.5rem))',
        }}
      >
        {/* ConnectKit-style clean centered header */}
        <div className="relative flex items-center justify-between">
          <span className="flex size-8 items-center justify-center">
            <WalletWalletConnect variant="branded" size={22} />
          </span>
          <h2 className="text-[17px] font-semibold tracking-tight">
            {isConnected ? 'Connected' : 'Choose Wallet'}
          </h2>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close modal"
            className="inline-flex size-8 items-center justify-center rounded-full transition-colors"
            style={{ color: textSecondary, backgroundColor: subtleBg }}
          >
            <X className="size-4" />
          </button>
        </div>

        {isConnected && address ? (
          <div className="mt-5 space-y-3">
            <div
              className="flex items-center justify-between rounded-2xl px-4 py-3.5"
              style={{ backgroundColor: subtleBg }}
            >
              <div>
                <span className="mono block text-sm font-semibold">{shortAddr(address)}</span>
                <span className="text-xs" style={{ color: textSecondary }}>
                  {activeConnector?.name ?? 'WalletConnect'}
                </span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(address)
                    toast.success('Address copied')
                  } catch {
                    /* ignore */
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{ backgroundColor: subtleHoverBg, color: textPrimary }}
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
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition-colors"
                style={{ backgroundColor: subtleBg, color: textPrimary }}
              >
                Open Wallet <ExternalLink className="size-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                disconnect()
                setModalOpen(false)
                toast.info('Wallet disconnected')
              }}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-red-500/12 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/20"
            >
              <LogOut className="size-4" /> Disconnect
            </button>
          </div>
        ) : !wcConnector ? (
          <div className="mt-5 space-y-2.5">
            <button
              type="button"
              onClick={() => openExternalUrl(`https://metamask.app.link/dapp/${currentUrl.replace(/^https?:\/\//i, '')}`)}
              className="flex h-12 w-full items-center justify-between rounded-2xl px-4 text-sm font-semibold"
              style={{ backgroundColor: subtleBg, color: textPrimary }}
            >
              <span className="flex items-center gap-3">
                <WalletMetamask variant="background" size={28} className="rounded-lg" />
                <span>MetaMask</span>
              </span>
              <ExternalLink className="size-4" style={{ color: textSecondary }} />
            </button>
            <button
              type="button"
              onClick={() =>
                openExternalUrl(`https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(currentUrl)}`)
              }
              className="flex h-12 w-full items-center justify-between rounded-2xl px-4 text-sm font-semibold"
              style={{ backgroundColor: subtleBg, color: textPrimary }}
            >
              <span className="flex items-center gap-3">
                <WalletTrust variant="background" size={28} className="rounded-lg" />
                <span>Trust Wallet</span>
              </span>
              <ExternalLink className="size-4" style={{ color: textSecondary }} />
            </button>
          </div>
        ) : (
          <div className="mt-5">
            {/* Standard 4-column Web3 wallet icon grid matching ConnectKit / WalletConnect */}
            <div className="grid grid-cols-4 gap-x-2.5 gap-y-4">
              {TG_WALLETS.map((w) => {
                const waiting = selectedWalletId === w.id && !wcUri
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => handlePickWallet(w)}
                    className="group flex flex-col items-center gap-1.5 rounded-2xl py-1 text-center transition-transform active:scale-95"
                  >
                    <span
                      className="relative flex size-14 items-center justify-center overflow-hidden rounded-[16px] shadow-sm transition-transform group-hover:scale-105"
                      style={{ border: `1px solid ${sheetBorder}` }}
                    >
                      <w.Icon variant="background" size={56} className="size-14" />
                      {waiting && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/55">
                          <Loader2 className="size-5 animate-spin text-white" />
                        </span>
                      )}
                    </span>
                    <span
                      className="w-full truncate text-[12px] font-medium leading-tight"
                      style={{ color: selectedWalletId === w.id ? textPrimary : textSecondary }}
                    >
                      {w.name}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Standard Copy to Clipboard bar */}
            <button
              type="button"
              disabled={!wcUri}
              onClick={() => void handleCopyUri()}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14px] font-medium transition-opacity disabled:opacity-50"
              style={{ backgroundColor: subtleBg, color: textPrimary }}
            >
              {initializing && !wcUri ? (
                <>
                  <Loader2 className="size-4 animate-spin" style={{ color: textSecondary }} />
                  <span style={{ color: textSecondary }}>Connecting…</span>
                </>
              ) : copied ? (
                <>
                  <Check className="size-4 text-emerald-400" />
                  <span>Copied to Clipboard</span>
                </>
              ) : (
                <>
                  <Copy className="size-4" style={{ color: textSecondary }} />
                  <span>Copy to Clipboard</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
