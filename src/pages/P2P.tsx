import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { ESCROW_ADDRESS, SIDE_BUY, SIDE_SELL, sameAddr } from '@/lib/p2p'
import { useAds, useArbiter, useBackupArbiter } from '@/hooks/useEscrow'
import { replaceQuery, useSearch } from '@/lib/router'
import { unsubscribeEmailToken, useP2pAccount, verifyEmailToken } from '@/hooks/useAccount'
import { SiteBar } from '@/components/SiteBar'
import { Header, MobileBottomNav, type TabId } from '@/components/Header'
import { Market } from '@/components/Market'
import { MyOrders, MyAds, ArbiterPanel } from '@/components/Lists'
import { PostAdSheet } from '@/components/PostAdSheet'
import { OrderRoom } from '@/components/OrderRoom'
import { AccountPanel } from '@/components/AccountPanel'
import { AccountSetup } from '@/components/AccountSetup'
import { useEligibility } from '@/hooks/useEligibility'

const parseId = (raw: string | null): bigint | null => (raw && /^\d+$/.test(raw) ? BigInt(raw) : null)

export default function P2PPage() {
  const { address, isConnected } = useAccount()
  const { isSignedIn, profile, isLoading: accountLoading, refetch: refetchAccount } = useP2pAccount()
  const arbiter = useArbiter()
  const backupArbiter = useBackupArbiter()
  const { blocked } = useEligibility()
  const [selectedTab, setTab] = useState<TabId>(() => {
    if (typeof window !== 'undefined') {
      const hp = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const sp = new URLSearchParams(window.location.search)
      if (hp.has('verify_email') || hp.has('unsubscribe') || hp.has('kyc_return') || sp.has('kyc_return')) {
        return 'account'
      }
    }
    return 'market'
  })
  const [postOpen, setPostOpen] = useState(false)

  const isArbiter = sameAddr(address, arbiter) || sameAddr(address, backupArbiter)
  const tab: TabId = selectedTab === 'arbiter' && !isArbiter ? 'market' : selectedTab

  const search = useSearch()
  const params = new URLSearchParams(search)
  const orderId = parseId(params.get('order'))
  const deepTradeId = parseId(params.get('trade'))
  const deepAmount = params.get('amount') ?? undefined
  const rawMode = params.get('mode')
  const isCashoutAlias = typeof window !== 'undefined' && window.location.pathname.startsWith('/cashout')
  const deepMode: 'buy' | 'sell' | undefined =
    rawMode === 'sell' || rawMode === 'buy' ? rawMode : isCashoutAlias ? 'sell' : undefined
  const deepCurrency = (params.get('currency') ?? '').trim().toUpperCase() || undefined
  const rawPost = params.get('post')
  const deepPostSide = rawPost === 'sell' ? SIDE_SELL : rawPost === 'buy' ? SIDE_BUY : undefined
  const { ads } = useAds()
  const deepAd = deepTradeId !== null ? ads.find((a) => a.id === deepTradeId) : undefined

  const openOrder = (id: bigint | null) =>
    replaceQuery((p) => {
      if (id === null) p.delete('order')
      else {
        p.delete('trade')
        p.delete('amount')
        p.set('order', id.toString())
      }
    })

  const clearDeepTrade = () =>
    replaceQuery((p) => {
      p.delete('trade')
      p.delete('amount')
    })

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

  const accountReady = isConnected && isSignedIn && !!profile?.exists && !!profile?.emailVerified
  const needsOnboarding = !accountReady && !(isArbiter && orderId !== null)
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

      <div className="p2p-terminal relative z-10 pb-24 md:pb-20">
        {!needsOnboarding && (
          <Header
            tab={tab}
            onTab={setTab}
            showArbiter={isArbiter}
            onSelectTab={() => {
              if (orderId !== null) openOrder(null)
            }}
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
            <div className="mx-auto max-w-2xl space-y-4 py-6">
              {!isConnected ? (
                <section className="p2p-card rounded-xl px-6 py-12 text-center">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] text-[#FF5A00]">
                    <ShieldCheck className="size-6" />
                  </div>
                  <h1 className="mt-4 text-lg font-bold text-[var(--p2p-ink)]">Create Your P2P Account</h1>
                  <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-[var(--p2p-muted)]">
                    Connect your wallet and complete your P2P profile before accessing the marketplace, encrypted
                    payment vault, or order chat. Swap and Bridge remain open without an account.
                  </p>
                  <ConnectKitButton.Custom>
                    {({ show }) => (
                      <button
                        type="button"
                        onClick={show}
                        className="mt-5 inline-flex min-h-10 items-center rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
                      >
                        Connect Wallet
                      </button>
                    )}
                  </ConnectKitButton.Custom>
                </section>
              ) : isSignedIn && accountLoading && !profile ? (
                <div className="p2p-card h-52 animate-pulse rounded-xl" />
              ) : (
                <>
                  <div className="p2p-card rounded-xl px-5 py-4">
                    <h1 className="text-base font-bold text-[var(--p2p-ink)]">
                      {profile?.exists && !profile?.emailVerified
                        ? 'Verify Your Email to Unlock P2P'
                        : 'Complete P2P Account Setup to Continue'}
                    </h1>
                    <p className="mt-1 text-xs text-[var(--p2p-muted)]">
                      {profile?.exists && !profile?.emailVerified
                        ? 'Confirm the verification link sent to your email (check Spam/All Mail if missing) to unlock the P2P Trade marketplace, My Ads, My Orders, and encrypted order chat. If you entered the wrong email, you can edit and save it below before verifying.'
                        : 'Sign in with your wallet, save your P2P profile, and verify your email below to unlock the P2P Trade marketplace, My Ads, My Orders, and encrypted order chat.'}
                    </p>
                  </div>
                  <AccountSetup />
                </>
              )}
            </div>
          ) : orderId !== null ? (
            <OrderRoom orderId={orderId} onClose={() => openOrder(null)} />
          ) : (
            <>
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
                />
              )}
              {tab === 'orders' && <MyOrders onOpen={openOrder} />}
              {tab === 'ads' && <MyAds onPostAd={() => setPostOpen(true)} />}
              {tab === 'account' && <AccountPanel />}
              {tab === 'arbiter' && <ArbiterPanel onOpen={openOrder} />}
            </>
          )}

          <p className="pt-4 text-center text-[11px] text-[var(--p2p-muted)]">
            Arc Testnet Non-Custodial Escrow • Fiat transfers settle off-chain between peers • Verify local crypto regulations before trading.
          </p>
        </main>

        {/* Mobile 60px Fixed 4-Tab Bottom Navigation Bar (Marketplace / Tabs view) */}
        {!needsOnboarding && orderId === null && <MobileBottomNav tab={tab} onTab={setTab} showArbiter={isArbiter} />}

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
