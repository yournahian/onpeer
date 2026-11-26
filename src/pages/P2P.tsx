import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectWalletCustom } from '@/components/TelegramWalletModal'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { ESCROW_ADDRESS, SIDE_BUY, SIDE_SELL, sameAddr } from '@/lib/p2p'
import { useAllAds, useArbiter, useBackupArbiter } from '@/hooks/useEscrow'
import { replaceQuery, useSearch } from '@/lib/router'
import { unsubscribeEmailToken, useP2pAccount, verifyEmailToken } from '@/hooks/useAccount'
import { SiteBar } from '@/components/SiteBar'
import { Header, MobileBottomNav, type TabId, type UserCenterQuickTarget } from '@/components/Header'
import { Market } from '@/components/Market'
import { MyOrders, MyAds, ArbiterPanel } from '@/components/Lists'
import { ChatHub } from '@/components/ChatHub'
import { TraderProfileView } from '@/components/TraderProfileView'
import { PostAdSheet } from '@/components/PostAdSheet'
import { OrderRoom } from '@/components/OrderRoom'
import { AccountPanel } from '@/components/AccountPanel'
import { LegacyV21WithdrawCard } from '@/components/LegacyV21WithdrawCard'
import { AccountSetup, getOnboardingStage } from '@/components/AccountSetup'
import { useEligibility } from '@/hooks/useEligibility'

const parseId = (raw: string | null): bigint | null => (raw && /^\d+$/.test(raw) ? BigInt(raw) : null)
const parseWalletParam = (raw: string | null): string | null =>
  raw && /^0x[0-9a-fA-F]{40}$/.test(raw.trim()) ? raw.trim().toLowerCase() : null

export default function P2PPage() {
  const { address, isConnected } = useAccount()
  const { isSignedIn, profile, isLoading: accountLoading, refetch: refetchAccount } = useP2pAccount()
  const arbiter = useArbiter()
  const backupArbiter = useBackupArbiter()
  const { blocked } = useEligibility()
  const VALID_P2P_TABS: readonly TabId[] = ['market', 'orders', 'ads', 'chat', 'account', 'arbiter']
  const [selectedTab, setSelectedTab] = useState<TabId>(() => {
    if (typeof window !== 'undefined') {
      const hp = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const sp = new URLSearchParams(window.location.search)
      if (hp.has('verify_email') || hp.has('unsubscribe') || hp.has('kyc_return') || sp.has('kyc_return')) {
        return 'account'
      }
      const qTab = sp.get('tab') as TabId | null
      if (qTab && VALID_P2P_TABS.includes(qTab)) return qTab
    }
    return 'market'
  })
  const setTab = (next: TabId) => {
    setSelectedTab(next)
    replaceQuery((p) => {
      if (next === 'market') p.delete('tab')
      else p.set('tab', next)
    })
  }
  const [postOpen, setPostOpen] = useState(false)
  const [chatOrderId, setChatOrderId] = useState<bigint | null>(null)
  const [chatSeed, setChatSeed] = useState(0)
  const [accountTarget, setAccountTarget] = useState<UserCenterQuickTarget | undefined>(undefined)
  const [accountSeed, setAccountSeed] = useState(0)

  const isArbiter = sameAddr(address, arbiter) || sameAddr(address, backupArbiter)
  const tab: TabId = selectedTab === 'arbiter' && !isArbiter ? 'market' : selectedTab

  const search = useSearch()
  const params = new URLSearchParams(search)
  const orderId = parseId(params.get('order'))
  const traderWallet = parseWalletParam(params.get('trader'))
  const deepTradeId = parseId(params.get('trade'))
  const deepAmount = params.get('amount') ?? undefined
  const rawMode = params.get('mode')
  const isCashoutAlias = typeof window !== 'undefined' && window.location.pathname.startsWith('/cashout')
  const deepMode: 'buy' | 'sell' | undefined =
    rawMode === 'sell' || rawMode === 'buy' ? rawMode : isCashoutAlias ? 'sell' : undefined
  const deepCurrency = (params.get('currency') ?? '').trim().toUpperCase() || undefined
  const rawPost = params.get('post')
  const deepPostSide = rawPost === 'sell' ? SIDE_SELL : rawPost === 'buy' ? SIDE_BUY : undefined
  const { ads } = useAllAds()
  const deepAssetParam = (params.get('asset') ?? '').trim().toLowerCase()
  const deepAd =
    deepTradeId !== null
      ? ads.find(
          (a) =>
            a.id === deepTradeId ||
            (deepAssetParam !== '' && a.asset.toLowerCase() === deepAssetParam && a.rawId === deepTradeId),
        )
      : undefined

  const openOrder = (id: bigint | null) =>
    replaceQuery((p) => {
      if (id === null) p.delete('order')
      else {
        p.delete('trade')
        p.delete('amount')
        p.delete('trader')
        p.set('order', id.toString())
      }
    })

  const openTrader = (wallet: string | null) =>
    replaceQuery((p) => {
      if (wallet === null) p.delete('trader')
      else {
        p.delete('order')
        p.delete('trade')
        p.delete('amount')
        p.set('trader', wallet.toLowerCase())
      }
    })

  const clearDeepTrade = () =>
    replaceQuery((p) => {
      p.delete('trade')
      p.delete('amount')
    })

  const clearSubOverlays = () => {
    if (orderId !== null || traderWallet !== null) {
      replaceQuery((p) => {
        p.delete('order')
        p.delete('trader')
      })
    }
  }

  const jumpToChatForOrder = (id: bigint) => {
    clearSubOverlays()
    setChatOrderId(id)
    setChatSeed((s) => s + 1)
    setTab('chat')
  }

  const jumpToUserCenterSection = (target: UserCenterQuickTarget) => {
    clearSubOverlays()
    setAccountTarget(target)
    setAccountSeed((s) => s + 1)
    setTab('account')
  }

  // Handle #verify_email=<token>, #unsubscribe=<token>, and ?kyc_return=1 without exposing bearer tokens in URL query
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    const sp = new URLSearchParams(window.location.search)
    const hp = new URLSearchParams(hash)
    const verifyTok = hp.get('verify_email')
    const unsubTok = hp.get('unsubscribe')
    const kycReturn = hp.get('kyc_return') ?? sp.get('kyc_return')
    if (!verifyTok && !unsubTok && !kycReturn) return

    // Strip bearer token from address bar immediately
    if (sp.has('kyc_return')) {
      sp.delete('kyc_return')
      sp.delete('verificationSessionId')
      sp.delete('status')
    }
    const nextSearch = sp.toString() ? `?${sp.toString()}` : ''
    window.history.replaceState(null, '', `${window.location.pathname}${nextSearch}`)

    if (verifyTok) {
      verifyEmailToken(verifyTok)
        .then(() => {
          toast.success('Email verified — P2P access and notifications are now active.')
          void refetchAccount()
        })
        .catch(() => toast.error('This email verification link is invalid or has expired.'))
    } else if (unsubTok) {
      unsubscribeEmailToken(unsubTok)
        .then(() => {
          toast.success('Unsubscribed from P2P email alerts.')
          void refetchAccount()
        })
        .catch(() => toast.error('This unsubscribe link is invalid or has expired.'))
    } else if (kycReturn) {
      toast.info('Returned from Didit — syncing your verification status.')
    }
  }, [refetchAccount])

  const [onboardTick, setOnboardTick] = useState(0)
  const pendingStep2 = onboardTick >= 0 && getOnboardingStage(address) === 'step2'
  const accountReady =
    isConnected && isSignedIn && !!profile?.exists && !!profile?.emailVerified && !pendingStep2
  // C-01: Never gate an active order URL (`?order=...`) behind offchain onboarding/API availability once wallet is connected
  const needsOnboarding = !accountReady && !(isConnected && orderId !== null)
  const postSheetOpen = postOpen || (!needsOnboarding && deepPostSide !== undefined)
  const closePostSheet = () => {
    setPostOpen(false)
    if (deepPostSide !== undefined) {
      replaceQuery((p) => p.delete('post'))
    }
  }

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <SiteBar />

      {/* RibbonBackdrop is rendered globally from App.tsx (persistent across routes) */}

      <div className="p2p-terminal relative z-10 pb-24 md:pb-12">
        {!needsOnboarding && (
          <Header
            tab={tab}
            onTab={(t) => {
              if (t === 'chat') setChatOrderId(null)
              setTab(t)
            }}
            showArbiter={isArbiter}
            onSelectTab={clearSubOverlays}
            onPostAd={() => setPostOpen(true)}
            onUserCenterJump={jumpToUserCenterSection}
          />
        )}

        <main
          className={`mx-auto w-full ${
            orderId !== null ? 'max-w-[1120px]' : 'max-w-[1440px]'
          } space-y-4 px-4 py-4 sm:px-8 sm:py-6 lg:px-10`}
        >
          {!needsOnboarding && blocked && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-surface-solid)] px-4 py-3 text-xs font-semibold text-[var(--p2p-warn-ink)] shadow-sm"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{blocked}</span>
            </div>
          )}

          {!ESCROW_ADDRESS ? (
            <div className="p2p-card rounded-xl px-6 py-14 text-center">
              <p className="text-base font-bold text-[var(--p2p-ink)]">Marketplace Contract Not Connected</p>
              <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--p2p-muted)]">
                The escrow contract address is not configured yet.
              </p>
            </div>
          ) : needsOnboarding ? (
            <div className="mx-auto max-w-xl py-8">
              {!isConnected ? (
                <section className="p2p-card rounded-2xl px-6 py-12 text-center">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] text-[#FF5A00]">
                    <ShieldCheck className="size-6" />
                  </div>
                  <h1 className="mt-4 text-lg font-bold text-[var(--p2p-ink)]">Connect Your Wallet</h1>
                  <p className="mx-auto mt-1.5 max-w-sm text-xs text-[var(--p2p-muted)]">
                    Connect your wallet to access OnPeer P2P trading and encrypted order chat.
                  </p>
                  <ConnectWalletCustom>
                    {({ show }) => (
                      <button
                        type="button"
                        onClick={show}
                        className="mt-5 inline-flex min-h-10 items-center rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
                      >
                        Connect Wallet
                      </button>
                    )}
                  </ConnectWalletCustom>
                </section>
              ) : isSignedIn && accountLoading && !profile ? (
                <div className="p2p-card h-52 animate-pulse rounded-2xl" />
              ) : (
                <AccountSetup onboarding onOnboardingComplete={() => setOnboardTick((n) => n + 1)} />
              )}
            </div>
          ) : orderId !== null ? (
            <OrderRoom orderId={orderId} onClose={() => openOrder(null)} />
          ) : traderWallet !== null ? (
            <TraderProfileView
              wallet={traderWallet}
              onBack={() => openTrader(null)}
              onOpenedOrder={(id) => openOrder(id)}
            />
          ) : (
            <>
              <LegacyV21WithdrawCard />
              {tab === 'market' && (
                <Market
                  key={`${deepMode ?? ''}:${deepCurrency ?? ''}`}
                  initialMode={deepMode}
                  initialCurrency={deepCurrency}
                  deepAd={deepAd}
                  deepAmount={deepAmount}
                  onClearDeepTrade={clearDeepTrade}
                  onOpenedOrder={(id) => openOrder(id)}
                  onPostAd={() => setPostOpen(true)}
                  onOpenTrader={openTrader}
                />
              )}
              {tab === 'orders' && (
                <MyOrders
                  onOpen={openOrder}
                  onOpenChat={jumpToChatForOrder}
                  onOpenTrader={openTrader}
                />
              )}
              {tab === 'ads' && <MyAds onPostAd={() => setPostOpen(true)} />}
              {tab === 'chat' && (
                <ChatHub
                  key={chatSeed}
                  initialOrderId={chatOrderId}
                  onOpen={openOrder}
                  onOpenTrader={openTrader}
                />
              )}
              {tab === 'account' && (
                <AccountPanel
                  key={accountSeed}
                  initialSection={accountTarget}
                  onOpenTrader={openTrader}
                  onBackToMarket={() => setTab('market')}
                />
              )}
              {tab === 'arbiter' && <ArbiterPanel onOpen={openOrder} />}
            </>
          )}
        </main>

        {/* Mobile Fixed 5-Tab Bottom Navigation Bar (P2P | Orders | Ads | Chat | Profile) */}
        {!needsOnboarding && orderId === null && (
          <MobileBottomNav
            tab={tab}
            onTab={(t) => {
              if (t === 'chat') setChatOrderId(null)
              setTab(t)
            }}
            showArbiter={isArbiter}
            onSelectTab={clearSubOverlays}
          />
        )}

        <PostAdSheet
          open={postSheetOpen}
          onClose={closePostSheet}
          initialSide={deepPostSide}
          initialCurrency={deepCurrency}
        />
      </div>
    </div>
  )
}
