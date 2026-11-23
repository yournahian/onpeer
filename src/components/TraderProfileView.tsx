import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import {
  ArrowLeft,
  Ban,
  Check,
  FileX2,
  Loader2,
  Share2,
  ShieldCheck,
  Star,
  ThumbsDown,
  ThumbsUp,
  UserCheck,
  UserPlus,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import type { Address } from 'viem'
import {
  SIDE_BUY,
  SIDE_SELL,
  TIER_TABLE,
  countryByCurrency,
  fiatFor,
  formatFiat,
  formatPrice,
  formatUsdcAmount,
  hexToCurrency,
  isAdExpired,
  maskToMethods,
  sameAddr,
  shortAddr,
} from '@/lib/p2p'
import { buildShareLink } from '@/lib/share'
import { BackendApiError } from '@/lib/api'
import { useP2pAccount } from '@/hooks/useAccount'
import {
  useAccounts,
  useAds,
  useNow,
  useOrders,
  useVerification,
  type AdWithId,
} from '@/hooks/useEscrow'
import {
  computeTraderOrderMetrics,
  recordRecentlyViewed,
  traderInitial,
  traderLabel,
  useTraderDetail,
  type FeedbackItem,
} from '@/hooks/useSocial'
import { TradePopupModal } from '@/components/TradeSheet'

function FeedbackListSection({
  feedback,
  positivePct,
  positiveCount,
  negativeCount,
  avgRating,
}: {
  feedback: FeedbackItem[]
  positivePct: number | null
  positiveCount: number
  negativeCount: number
  avgRating: number | null
}) {
  const [filter, setFilter] = useState<'all' | 'pos' | 'neg'>('all')
  const shown = useMemo(() => {
    if (filter === 'pos') return feedback.filter((f) => f.positive)
    if (filter === 'neg') return feedback.filter((f) => !f.positive)
    return feedback
  }, [feedback, filter])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-4">
        <div className="flex items-center gap-4">
          <div>
            <span className="block text-[11px] text-[var(--p2p-muted)]">Positive Feedback</span>
            <p className="p2p-mono mt-0.5 flex items-center gap-1.5 text-2xl font-bold text-[var(--p2p-ink)]">
              <ThumbsUp className="size-5 text-emerald-400" />
              {positivePct !== null ? `${positivePct.toFixed(2)}%` : '100.00%'}
            </p>
          </div>
          {avgRating !== null && (
            <div className="border-l border-[var(--p2p-border)] pl-4">
              <span className="block text-[11px] text-[var(--p2p-muted)]">Avg. Rating</span>
              <p className="p2p-mono mt-0.5 flex items-center gap-1 text-lg font-bold text-[#FF5A00]">
                <Star className="size-4 fill-[#FF5A00] text-[#FF5A00]" /> {avgRating.toFixed(1)} / 5
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'all' as const, label: `All (${feedback.length})` },
            { id: 'pos' as const, label: `Positive (${positiveCount})` },
            { id: 'neg' as const, label: `Negative (${negativeCount})` },
          ].map((t) => {
            const active = filter === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                  active
                    ? 'border-[#FF5A00] bg-[#FF5A00] text-white'
                    : 'border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] py-12 text-center">
          <FileX2 className="size-8 text-[var(--p2p-muted)] opacity-60" />
          <p className="mt-2 text-sm font-semibold text-[var(--p2p-muted)]">No reviews in this category yet</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--p2p-border)] rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
          {shown.map((item) => {
            const authorLabel = item.fromDisplayName ?? shortAddr(item.fromWallet)
            const init = (authorLabel.replace(/[^A-Za-z0-9]/g, '')[0] ?? 'T').toUpperCase()
            return (
              <li key={item.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="p2p-mono flex size-7 items-center justify-center rounded-full bg-[var(--p2p-tint)] text-xs font-bold text-[#FF5A00]">
                      {init}
                    </span>
                    <div>
                      <p className="text-xs font-bold text-[var(--p2p-ink)]">{authorLabel}</p>
                      <p className="p2p-mono text-[10px] text-[var(--p2p-muted)]">
                        {new Date(item.createdAt).toLocaleDateString()} • Order #{item.orderId}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        item.positive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                      }`}
                    >
                      {item.positive ? <ThumbsUp className="size-3" /> : <ThumbsDown className="size-3" />}
                      {item.positive ? 'Positive' : 'Negative'}
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, idx) => (
                        <Star
                          key={idx}
                          className={`size-3 ${
                            idx < item.rating ? 'fill-[#FF5A00] text-[#FF5A00]' : 'text-[var(--p2p-muted)] opacity-30'
                          }`}
                        />
                      ))}
                    </span>
                  </div>
                </div>

                {item.comment ? (
                  <p className="text-xs leading-relaxed text-[var(--p2p-ink)]">{item.comment}</p>
                ) : (
                  <p className="text-xs italic text-[var(--p2p-muted)]">No written comment left.</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function TraderProfileView({
  wallet,
  onBack,
  onOpenedOrder,
}: {
  wallet: string
  onBack: () => void
  onOpenedOrder: (orderId: bigint) => void
}) {
  const { address } = useAccount()
  const { isSignedIn, signIn } = useP2pAccount()
  const { ads } = useAds()
  const { orders } = useOrders()
  const now = useNow()

  const normWallet = wallet.toLowerCase() as Address
  const accountsMap = useAccounts([normWallet])
  const chainAcc = accountsMap.get(normWallet)
  const kyc = useVerification(normWallet)
  const { data: detail, isLoading, setRelation, updatingRelation } = useTraderDetail(normWallet)

  const [mobileTab, setMobileTab] = useState<'info' | 'ads' | 'feedback'>('info')
  const [desktopTab, setDesktopTab] = useState<'ads' | 'feedback'>('ads')
  const [selectedAd, setSelectedAd] = useState<AdWithId | null>(null)

  const summary = detail?.profile ?? null
  const displayName = traderLabel(normWallet, summary)
  const initial = traderInitial(normWallet, summary)
  const isSelf = sameAddr(address, normWallet)

  useEffect(() => {
    recordRecentlyViewed({
      wallet: normWallet,
      displayName: summary?.displayName ?? null,
    })
  }, [normWallet, summary?.displayName])

  const liveAds = useMemo(
    () =>
      ads.filter(
        (a) =>
          sameAddr(a.maker, normWallet) &&
          !a.paused &&
          !a.closed &&
          a.available > 0n &&
          !isAdExpired(a.expiresAt, now),
      ),
    [ads, normWallet, now],
  )

  // "Online Buy Ads" = ads where the viewer can BUY USDC from this advertiser (ad.side === SIDE_SELL)
  const onlineBuyAds = useMemo(() => liveAds.filter((a) => a.side === SIDE_SELL), [liveAds])
  // "Online Sell Ads" = ads where the viewer can SELL USDC to this advertiser (ad.side === SIDE_BUY)
  const onlineSellAds = useMemo(() => liveAds.filter((a) => a.side === SIDE_BUY), [liveAds])

  const metrics = useMemo(
    () =>
      computeTraderOrderMetrics(
        normWallet,
        orders,
        now,
        chainAcc?.ordersCompleted,
        chainAcc?.ordersCreated,
      ),
    [normWallet, orders, now, chainAcc?.ordersCompleted, chainAcc?.ordersCreated],
  )

  const joinedAtIso = summary?.joinedAt ?? null
  const registeredDays = joinedAtIso
    ? Math.max(0, Math.floor((now - Math.floor(new Date(joinedAtIso).getTime() / 1000)) / 86_400))
    : null

  const tierInfo = TIER_TABLE[chainAcc ? chainAcc.tier : 0] ?? TIER_TABLE[0]
  const idVerified = kyc.verified || summary?.kycApproved === true

  const handleShare = async () => {
    try {
      const url = await buildShareLink(`/p2p?trader=${normWallet}`)
      await navigator.clipboard.writeText(url)
      toast.success('Trader profile link copied!')
    } catch {
      toast.error('Could not copy link.')
    }
  }

  const handleRelation = async (kind: 'follow' | 'block', nextActive: boolean) => {
    if (!isSignedIn) {
      try {
        await signIn()
      } catch {
        toast.error('Sign in with your wallet first.')
        return
      }
    }
    try {
      await setRelation({ target: normWallet, kind, active: nextActive })
      if (kind === 'follow') {
        toast.success(nextActive ? `Following ${displayName}` : `Unfollowed ${displayName}`)
      } else {
        toast.success(nextActive ? `Blocked ${displayName}` : `Unblocked ${displayName}`)
      }
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not update preference.')
    }
  }

  const renderDesktopAdTable = (list: AdWithId[], viewerMode: 'buy' | 'sell') => {
    if (list.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-12 text-center">
          <FileX2 className="size-8 text-[var(--p2p-muted)] opacity-55" />
          <p className="mt-2 text-xs font-semibold text-[var(--p2p-muted)]">No Ads</p>
        </div>
      )
    }

    return (
      <div className="overflow-hidden rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
        <div className="grid border-b border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-5 py-2.5 text-xs text-[var(--p2p-muted)] md:grid-cols-[150px_1fr_1.3fr_1.1fr_140px]">
          <span>Coin</span>
          <span>Price</span>
          <span>Order Limit / Available</span>
          <span>Payment</span>
          <span className="text-right">Trade</span>
        </div>
        <ul className="divide-y divide-[var(--p2p-border)]">
          {list.map((ad) => {
            const cur = hexToCurrency(ad.currency)
            const c = countryByCurrency(cur)
            const cap = ad.maxAmount > ad.available ? ad.available : ad.maxAmount
            const floor = ad.minAmount > ad.available ? ad.available : ad.minAmount
            const methods = maskToMethods(ad.paymentMask)
            return (
              <li
                key={ad.id.toString()}
                className="grid items-center gap-4 px-5 py-4 md:grid-cols-[150px_1fr_1.3fr_1.1fr_140px]"
              >
                <span className="inline-flex items-center gap-2 text-sm font-bold text-[var(--p2p-ink)]">
                  <TokenUSDC variant="branded" size={20} /> USDC
                </span>
                <span className="p2p-mono text-base font-bold text-[var(--p2p-ink)]">
                  {formatPrice(ad.priceE6)} <span className="text-xs font-semibold">{cur}</span>
                </span>
                <div className="space-y-0.5 text-xs">
                  <p className="p2p-mono font-semibold text-[var(--p2p-ink)]">{formatUsdcAmount(ad.available)} USDC</p>
                  <p className="p2p-mono text-[var(--p2p-muted)]">
                    {c?.symbol}
                    {formatFiat(fiatFor(floor, ad.priceE6), 0)} - {c?.symbol}
                    {formatFiat(fiatFor(cap, ad.priceE6), 0)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {methods.map((m) => (
                    <span
                      key={m.bit}
                      className="inline-flex items-center pl-2 text-xs font-medium text-[var(--p2p-ink)]"
                      style={{ borderLeft: '2.5px solid #FF5A00' }}
                    >
                      {m.name}
                    </span>
                  ))}
                </div>
                <div className="flex justify-end">
                  {isSelf ? (
                    <span className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 py-2 text-xs font-semibold text-[var(--p2p-muted)]">
                      Your Ad
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSelectedAd(ad)}
                      className="inline-flex min-h-9 min-w-[116px] items-center justify-center rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white transition-opacity hover:opacity-90"
                    >
                      {viewerMode === 'buy' ? 'Buy USDC' : 'Sell USDC'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* =====================================================================
          MOBILE COUNTERPARTY PROFILE (< 768px — SS 2 Pattern)
         ===================================================================== */}
      <div className="md:hidden space-y-4">
        {/* Top Navigation Bar */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to P2P"
            className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-ink)]"
          >
            <ArrowLeft className="size-4" />
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleShare()}
              aria-label="Share trader profile"
              className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-ink)]"
            >
              <Share2 className="size-4" />
            </button>
            {!isSelf && (
              <button
                type="button"
                disabled={updatingRelation}
                onClick={() => void handleRelation('block', !detail?.viewerBlocked)}
                aria-label={detail?.viewerBlocked ? 'Unblock trader' : 'Block trader'}
                className={`inline-flex h-9 items-center gap-1 rounded-xl border px-3 text-xs font-semibold ${
                  detail?.viewerBlocked
                    ? 'border-red-500 bg-red-500/15 text-red-400'
                    : 'border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)]'
                }`}
              >
                <Ban className="size-3.5" />
                {detail?.viewerBlocked ? 'Blocked' : 'Block'}
              </button>
            )}
          </div>
        </div>

        {/* Profile Identity Banner Card */}
        <section className="relative overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
          <div
            aria-hidden
            className="h-20 w-full"
            style={{
              background: 'linear-gradient(125deg, rgba(255,90,0,0.34) 0%, rgba(255,138,51,0.12) 55%, transparent 100%)',
            }}
          />
          <div className="px-4 pb-4 -mt-8 space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div className="relative inline-flex size-16 items-center justify-center rounded-full border-4 border-[var(--p2p-surface-solid)] bg-[var(--p2p-tint)] text-xl font-extrabold text-[#FF5A00]">
                {initial}
                <span className="absolute bottom-0.5 right-0.5 size-3 rounded-full border-2 border-[var(--p2p-surface-solid)] bg-emerald-400" />
              </div>

              {!isSelf && (
                <button
                  type="button"
                  disabled={updatingRelation}
                  onClick={() => void handleRelation('follow', !detail?.viewerFollowing)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-xs font-bold transition-colors ${
                    detail?.viewerFollowing
                      ? 'border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]'
                      : 'bg-[#FF5A00] text-white'
                  }`}
                >
                  {updatingRelation ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : detail?.viewerFollowing ? (
                    <UserCheck className="size-3.5 text-[#FF5A00]" />
                  ) : (
                    <UserPlus className="size-3.5" />
                  )}
                  {detail?.viewerFollowing ? 'Following' : 'Follow'}
                </button>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-extrabold text-[var(--p2p-ink)]">{displayName}</h1>
                {chainAcc?.merchant && (
                  <span className="inline-flex items-center gap-1 rounded bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
                    <ShieldCheck className="size-3.5" /> Verified Merchant
                  </span>
                )}
              </div>
              <p className="p2p-mono mt-0.5 text-[11px] text-[var(--p2p-muted)]">{shortAddr(normWallet)}</p>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--p2p-muted)]">
              <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                <span className="size-2 rounded-full bg-emerald-400" /> Online
              </span>
              {chainAcc && chainAcc.margin > 0n && (
                <span>
                  Deposit: <strong className="p2p-mono text-[var(--p2p-ink)]">{formatUsdcAmount(chainAcc.margin)} USDC</strong>
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--p2p-muted)]">
              {idVerified && (
                <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                  <Check className="size-3.5" /> Verified
                </span>
              )}
              {summary?.emailVerified && (
                <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                  <Check className="size-3.5" /> Email
                </span>
              )}
              <span>
                <strong className="text-[var(--p2p-ink)]">{summary?.followingCount ?? 0}</strong> Following
              </span>
              <span>
                <strong className="text-[var(--p2p-ink)]">{summary?.followersCount ?? 0}</strong> Followers
              </span>
            </div>
          </div>
        </section>

        {/* Sub-Tabs: Info | Ads | Feedback */}
        <div className="flex items-center gap-6 border-b border-[var(--p2p-border)] px-1">
          {[
            { id: 'info' as const, label: 'Info' },
            { id: 'ads' as const, label: `Ads (${liveAds.length})` },
            { id: 'feedback' as const, label: `Feedback (${summary?.totalFeedback ?? 0})` },
          ].map((t) => {
            const active = mobileTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setMobileTab(t.id)}
                className={`relative pb-2.5 text-sm font-bold transition-colors ${
                  active ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)]'
                }`}
              >
                {t.label}
                {active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#FF5A00]" />}
              </button>
            )
          })}
        </div>

        {mobileTab === 'info' && (
          <section className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 space-y-3 text-xs">
            {[
              ['30d Trades', String(metrics.trades30d)],
              ['30d Completion Rate', metrics.completion30dPct],
              ['Avg. Release Time', `${metrics.avgReleaseMin} Minute(s)`],
              ['Avg. Pay Time', `${metrics.avgPayMin} Minute(s)`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-1">
                <span className="text-[var(--p2p-muted)]">{k}</span>
                <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">{v}</span>
              </div>
            ))}

            <div className="border-t border-[var(--p2p-border)] pt-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[var(--p2p-muted)]">Account Tier</span>
                <span className="font-bold text-[var(--p2p-ink)]">
                  Tier {tierInfo.tier} ({tierInfo.label})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--p2p-muted)]">Registered</span>
                <span className="p2p-mono font-semibold text-[var(--p2p-ink)]">
                  {registeredDays !== null ? `${registeredDays} Day(s) ago` : 'Onchain Member'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--p2p-muted)]">First Trade</span>
                <span className="p2p-mono font-semibold text-[var(--p2p-ink)]">
                  {metrics.firstTradeDaysAgo !== null ? `${metrics.firstTradeDaysAgo} Day(s) ago` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--p2p-muted)]">Trading Counterparties</span>
                <span className="p2p-mono font-semibold text-[var(--p2p-ink)]">{metrics.counterpartiesCount}</span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-[var(--p2p-muted)]">All Trades</span>
                <div className="text-right">
                  <p className="p2p-mono font-bold text-[var(--p2p-ink)]">{metrics.allCompleted} Time(s)</p>
                  <p className="p2p-mono text-[11px] text-[var(--p2p-muted)]">
                    Buy {metrics.buyCompleted} | Sell {metrics.sellCompleted}
                  </p>
                </div>
              </div>
            </div>

            {chainAcc && chainAcc.margin > 0n && (
              <div className="border-t border-[var(--p2p-border)] pt-3 text-center text-[11px] text-[var(--p2p-muted)]">
                <p className="font-semibold text-[var(--p2p-ink)]">OnPeer Risk Management</p>
                <p className="mt-0.5">
                  To reduce trading risk, this advertiser has locked {formatUsdcAmount(chainAcc.margin)} USDC security
                  margin in the Arc smart contract.
                </p>
              </div>
            )}
          </section>
        )}

        {mobileTab === 'ads' && (
          <div className="space-y-3">
            {liveAds.length === 0 ? (
              <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-12 text-center text-xs text-[var(--p2p-muted)]">
                No active ads right now.
              </div>
            ) : (
              liveAds.map((ad) => {
                const cur = hexToCurrency(ad.currency)
                const c = countryByCurrency(cur)
                const viewerMode = ad.side === SIDE_SELL ? 'buy' : 'sell'
                const cap = ad.maxAmount > ad.available ? ad.available : ad.maxAmount
                const floor = ad.minAmount > ad.available ? ad.available : ad.minAmount
                return (
                  <div
                    key={ad.id.toString()}
                    className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="rounded bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
                        {viewerMode === 'buy' ? 'Buy USDC' : 'Sell USDC'}
                      </span>
                      <span className="p2p-mono text-xs text-[var(--p2p-muted)]">⏱ {ad.windowMinutes} min</span>
                    </div>
                    <p className="p2p-mono text-xl font-bold text-[var(--p2p-ink)]">
                      {c?.symbol} {formatPrice(ad.priceE6)}{' '}
                      <span className="text-xs font-normal text-[var(--p2p-muted)]">/USDC</span>
                    </p>
                    <div className="flex items-end justify-between gap-2 text-xs">
                      <div className="space-y-0.5 text-[var(--p2p-muted)]">
                        <p>
                          Limit{' '}
                          <span className="p2p-mono text-[var(--p2p-ink)]">
                            {formatFiat(fiatFor(floor, ad.priceE6), 0)} - {formatFiat(fiatFor(cap, ad.priceE6), 0)} {cur}
                          </span>
                        </p>
                        <p>
                          Available <span className="p2p-mono text-[var(--p2p-ink)]">{formatUsdcAmount(ad.available)} USDC</span>
                        </p>
                      </div>
                      {!isSelf && (
                        <button
                          type="button"
                          onClick={() => setSelectedAd(ad)}
                          className="h-9 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-white hover:opacity-90"
                        >
                          {viewerMode === 'buy' ? 'Buy' : 'Sell'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {mobileTab === 'feedback' &&
          (isLoading ? (
            <div className="h-32 animate-pulse rounded-2xl bg-[var(--p2p-surface)]" />
          ) : (
            <FeedbackListSection
              feedback={detail?.feedback ?? []}
              positivePct={summary?.positivePct ?? null}
              positiveCount={summary?.positiveCount ?? 0}
              negativeCount={summary?.negativeCount ?? 0}
              avgRating={summary?.avgRating ?? null}
            />
          ))}
      </div>

      {/* =====================================================================
          DESKTOP COUNTERPARTY PROFILE (>= 768px — SS 13 Pattern, No Footer)
         ===================================================================== */}
      <div className="hidden md:block space-y-6">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-3.5 py-2 text-xs font-bold text-[var(--p2p-ink)] hover:border-[#FF5A00]"
          >
            <ArrowLeft className="size-3.5" /> Back to P2P Market
          </button>
        </div>

        <section className="overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
          <div
            aria-hidden
            className="h-28 w-full"
            style={{
              background:
                'radial-gradient(circle at 25% 0%, rgba(255,90,0,0.32), transparent 58%), linear-gradient(90deg, rgba(255,90,0,0.12), rgba(21,21,21,0.4))',
            }}
          />
          <div className="px-7 pb-6 -mt-9 space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex items-end gap-4">
                <div className="relative flex size-20 items-center justify-center rounded-full border-4 border-[var(--p2p-surface-solid)] bg-[var(--p2p-tint)] text-2xl font-extrabold text-[#FF5A00]">
                  {initial}
                  <span className="absolute bottom-1 right-1 size-3.5 rounded-full border-2 border-[var(--p2p-surface-solid)] bg-emerald-400" />
                </div>
                <div className="pb-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-extrabold text-[var(--p2p-ink)]">{displayName}</h1>
                    {chainAcc?.merchant && (
                      <span className="inline-flex items-center gap-1 rounded bg-[var(--p2p-tint)] px-2.5 py-0.5 text-xs font-bold text-[#FF5A00]">
                        <ShieldCheck className="size-3.5" /> Verified Merchant
                      </span>
                    )}
                    <span className="p2p-mono text-xs text-[var(--p2p-muted)]">({shortAddr(normWallet)})</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--p2p-muted)]">
                    <span className="text-emerald-400 font-semibold">Online</span>
                    {summary?.joinedAt && `  |  Joined on ${summary.joinedAt.slice(0, 10)}`}
                    {`  |  ${summary?.followingCount ?? 0} Following • ${summary?.followersCount ?? 0} Followers`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {!isSelf && (
                  <>
                    <button
                      type="button"
                      disabled={updatingRelation}
                      onClick={() => void handleRelation('follow', !detail?.viewerFollowing)}
                      className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-xs font-bold transition-colors ${
                        detail?.viewerFollowing
                          ? 'border border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                          : 'bg-[#FF5A00] text-white hover:opacity-90'
                      }`}
                    >
                      {detail?.viewerFollowing ? <UserCheck className="size-4" /> : <UserPlus className="size-4" />}
                      {detail?.viewerFollowing ? 'Following' : 'Follow'}
                    </button>

                    <button
                      type="button"
                      disabled={updatingRelation}
                      onClick={() => void handleRelation('block', !detail?.viewerBlocked)}
                      className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-4 text-xs font-bold transition-colors ${
                        detail?.viewerBlocked
                          ? 'border-red-500 bg-red-500/15 text-red-400'
                          : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)] hover:border-red-500/60'
                      }`}
                    >
                      <Ban className="size-3.5" />
                      {detail?.viewerBlocked ? 'Unblock' : 'Block'}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => void handleShare()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-bold text-[var(--p2p-ink)] hover:border-[#FF5A00]"
                >
                  <Share2 className="size-3.5" /> Share
                </button>
              </div>
            </div>

            {/* Verification Checkmarks Row */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span
                className={`inline-flex items-center gap-1 font-semibold ${
                  summary?.emailVerified ? 'text-emerald-400' : 'text-[var(--p2p-muted)]'
                }`}
              >
                <Check className="size-3.5" /> Email
              </span>
              <span
                className={`inline-flex items-center gap-1 font-semibold ${
                  idVerified ? 'text-emerald-400' : 'text-[var(--p2p-muted)]'
                }`}
              >
                <Check className="size-3.5" /> ID Verification
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                <Check className="size-3.5" /> Arc Wallet
              </span>
              <span className="text-[var(--p2p-muted)]">
                Deposit:{' '}
                <strong className="p2p-mono text-[var(--p2p-ink)]">
                  {chainAcc ? formatUsdcAmount(chainAcc.margin) : '0.00'} USDC
                </strong>
              </span>
              <span className="text-[var(--p2p-muted)]">
                Positive Feedback:{' '}
                <strong className="p2p-mono text-emerald-400">
                  {summary?.positivePct !== null && summary?.positivePct !== undefined
                    ? `${summary.positivePct.toFixed(2)}%`
                    : '100.00%'}
                </strong>
              </span>
            </div>

            {/* 5-Column Stat Tiles (SS 13) */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[
                { label: 'All Trades', value: `${metrics.allCompleted}`, unit: 'Time(s)' },
                { label: '30d Trades', value: `${metrics.trades30d}`, unit: 'Time(s)' },
                { label: '30d Completion Rate', value: metrics.completion30dPct, unit: '' },
                { label: 'Avg. Release Time', value: metrics.avgReleaseMin, unit: 'Minute(s)' },
                { label: 'Avg. Pay Time', value: metrics.avgPayMin, unit: 'Minute(s)' },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-3.5"
                >
                  <span className="block text-xs text-[var(--p2p-muted)]">{s.label}</span>
                  <p className="p2p-mono mt-1.5 text-xl font-extrabold text-[var(--p2p-ink)]">
                    {s.value}{' '}
                    {s.unit && <span className="text-xs font-normal text-[var(--p2p-muted)]">{s.unit}</span>}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Desktop Tabs: Online Ads | Feedback */}
        <div className="flex items-center gap-7 border-b border-[var(--p2p-border)]">
          {[
            { id: 'ads' as const, label: `Online Ads (${liveAds.length})` },
            { id: 'feedback' as const, label: `Feedback (${summary?.totalFeedback ?? 0})` },
          ].map((t) => {
            const active = desktopTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setDesktopTab(t.id)}
                className={`relative pb-3 text-sm font-bold transition-colors ${
                  active ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                }`}
              >
                {t.label}
                {active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#FF5A00]" />}
              </button>
            )
          })}
        </div>

        {desktopTab === 'ads' ? (
          <div className="space-y-6">
            <div className="space-y-2.5">
              <h2 className="text-sm font-extrabold text-[var(--p2p-ink)]">Online Buy Ads</h2>
              {renderDesktopAdTable(onlineBuyAds, 'buy')}
            </div>

            <div className="space-y-2.5">
              <h2 className="text-sm font-extrabold text-[var(--p2p-ink)]">Online Sell Ads</h2>
              {renderDesktopAdTable(onlineSellAds, 'sell')}
            </div>
          </div>
        ) : (
          <FeedbackListSection
            feedback={detail?.feedback ?? []}
            positivePct={summary?.positivePct ?? null}
            positiveCount={summary?.positiveCount ?? 0}
            negativeCount={summary?.negativeCount ?? 0}
            avgRating={summary?.avgRating ?? null}
          />
        )}
      </div>

      <TradePopupModal
        ad={selectedAd}
        makerAccount={chainAcc}
        onClose={() => setSelectedAd(null)}
        onOpened={(id) => {
          setSelectedAd(null)
          onOpenedOrder(id)
        }}
      />
    </div>
  )
}
