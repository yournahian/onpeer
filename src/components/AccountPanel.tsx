import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from 'wagmi'
import { ConnectWalletCustom } from '@/components/TelegramWalletModal'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Ban,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  FileSearch,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  QrCode,
  Settings,
  Share2,
  ShieldCheck,
  Smartphone,
  Star,
  Store,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  COUNTRIES,
  ESCROW_ADDRESS,
  MARGIN_DELAY_DAYS,
  MERCHANT_MARGIN,
  SIDE_SELL,
  STATUS_META,
  TIER_TABLE,
  formatDuration,
  formatOrderCap,
  formatPrice,
  formatUsdcAmount,
  hexToCurrency,
  isActiveStatus,
  isAdExpired,
  sameAddr,
  shortAddr,
} from '@/lib/p2p'
import { buildShareLink } from '@/lib/share'
import { formatUnitsFixed, parseUnitsExact } from '@/onchain-money'
import {
  useAds,
  useDebts,
  useNow,
  useOrders,
  useUsdcAllowance,
  useUsdcBalance,
} from '@/hooks/useEscrow'
import { useEligibility } from '@/hooks/useEligibility'
import { useP2pAccount, useSavedPaymentMethods } from '@/hooks/useAccount'
import { useTx } from '@/hooks/useTx'
import { AccountSetup } from '@/components/AccountSetup'
import { KycPanel } from '@/components/KycPanel'
import { PaymentMethodsPanel } from '@/components/PaymentMethodsPanel'
import type { UserCenterQuickTarget } from '@/components/Header'
import {
  clearRecentlyViewed,
  computeTraderOrderMetrics,
  loadCustomAlerts,
  loadRecentlyViewed,
  saveCustomAlerts,
  traderInitial,
  traderLabel,
  useMyRelations,
  useTraderDetail,
  type CustomPriceAlert,
} from '@/hooks/useSocial'

type ProfileSubView =
  | 'main'
  | 'settings'
  | 'restrictions'
  | 'notifications'
  | 'feedback'
  | 'alerts'
  | 'payments'
  | 'follows'
  | 'recent'
  | 'adshare'
  | 'activities'
  | 'kyc'
  | 'help'
  | 'homescreen'
  | 'merchant'

type DesktopUserCenterTab =
  | 'payments'
  | 'feedback'
  | 'blocked'
  | 'follows'
  | 'restrictions'
  | 'notifications'

function parseUsdcInput(v: string): bigint {
  try {
    return v ? parseUnitsExact(v, 6) : 0n
  } catch {
    return 0n
  }
}

function buildAlertEntry(currency: string, side: 'buy' | 'sell', targetPrice: string): CustomPriceAlert {
  return {
    id: `alert_${Date.now().toString(36)}`,
    currency,
    side,
    targetPrice,
    createdAt: new Date().toISOString(),
  }
}

function resolveInitialMobileView(initialSection?: UserCenterQuickTarget): ProfileSubView {
  if (initialSection) return initialSection
  if (typeof window === 'undefined') return 'main'
  const hp = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const sp = new URLSearchParams(window.location.search)
  if (hp.has('kyc_return') || sp.has('kyc_return')) return 'kyc'
  if (hp.has('verify_email') || hp.has('unsubscribe')) return 'notifications'
  return 'main'
}

function resolveInitialDesktopTab(initialSection?: UserCenterQuickTarget): DesktopUserCenterTab {
  if (initialSection === 'restrictions') return 'restrictions'
  if (initialSection === 'notifications') return 'notifications'
  if (typeof window !== 'undefined') {
    const hp = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const sp = new URLSearchParams(window.location.search)
    if (hp.has('kyc_return') || sp.has('kyc_return') || hp.has('verify_email') || hp.has('unsubscribe')) {
      return 'notifications'
    }
  }
  return 'payments'
}

function SubViewHeader({
  title,
  onBack,
  right,
}: {
  title: string
  onBack: () => void
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--p2p-border)] pb-3.5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-bold text-[var(--p2p-ink)] hover:text-[#FF5A00]"
      >
        <ArrowLeft className="size-4" />
        <span>{title}</span>
      </button>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  )
}

export function AccountPanel({
  initialSection,
  onOpenTrader,
  onBackToMarket,
}: {
  initialSection?: UserCenterQuickTarget
  onOpenTrader?: (wallet: string) => void
  onBackToMarket?: () => void
}) {
  const { address, isConnected } = useAccount()
  const { profile: myAccountProfile } = useP2pAccount()
  const { account, blocked, kyc, kycRequired } = useEligibility()
  const { methods: savedMethods } = useSavedPaymentMethods()
  const { ads } = useAds()
  const { orders } = useOrders()
  const debts = useDebts(address)
  const balance = useUsdcBalance()
  const allowance = useUsdcAllowance()
  const now = useNow()
  const { run, approveUsdc, writeContractAsync, pendingKey, busy } = useTx()

  const { data: traderDetail } = useTraderDetail(address)
  const { following, blocked: blockedUsers, setRelation, updating: updatingRel } = useMyRelations()

  // Mobile state
  const [view, setView] = useState<ProfileSubView>(() => resolveInitialMobileView(initialSection))
  const [returnToSettings, setReturnToSettings] = useState(false)
  const [mainTab, setMainTab] = useState<'trade' | 'others'>('trade')
  const [statsExpanded, setStatsExpanded] = useState(false)
  const [merchantBannerHidden, setMerchantBannerHidden] = useState(false)

  // Desktop state (SS 4 & SS 6)
  const [desktopTab, setDesktopTab] = useState<DesktopUserCenterTab>(() => resolveInitialDesktopTab(initialSection))
  const [desktopOverlay, setDesktopOverlay] = useState<'merchant' | 'help' | null>(() =>
    initialSection === 'merchant' ? 'merchant' : initialSection === 'help' ? 'help' : null,
  )
  const [tradeInfoOpen, setTradeInfoOpen] = useState(false)
  const [hideValue, setHideValue] = useState(true)
  const [fbFilter, setFbFilter] = useState<'all' | 'pos' | 'neg'>('all')

  // Shared sub-states
  const [restrictionsTab, setRestrictionsTab] = useState<'suspended' | 'frozen'>('suspended')
  const [followsTab, setFollowsTab] = useState<'blocked' | 'following'>('blocked')

  // Margin & Debt Repay inputs
  const [deposit, setDeposit] = useState('')
  const [withdraw, setWithdraw] = useState('')
  const [repay, setRepay] = useState('')

  // Custom alerts local state
  const [alerts, setAlerts] = useState<CustomPriceAlert[]>(() => loadCustomAlerts())
  const [alertCurrency, setAlertCurrency] = useState('BDT')
  const [alertSide, setAlertSide] = useState<'buy' | 'sell'>('buy')
  const [alertPrice, setAlertPrice] = useState('')

  // Recently viewed local state
  const [recentList, setRecentList] = useState(() => loadRecentlyViewed())

  const metrics = useMemo(
    () =>
      computeTraderOrderMetrics(
        address,
        orders,
        now,
        account?.ordersCompleted,
        account?.ordersCreated,
      ),
    [address, orders, now, account?.ordersCompleted, account?.ordersCreated],
  )

  const myLiveAds = useMemo(
    () =>
      address
        ? ads.filter((a) => sameAddr(a.maker, address) && !a.closed && !isAdExpired(a.expiresAt, now))
        : [],
    [ads, address, now],
  )

  const myLockedOrders = useMemo(
    () =>
      address
        ? orders.filter(
            (o) => (sameAddr(o.buyer, address) || sameAddr(o.seller, address)) && isActiveStatus(o.status),
          )
        : [],
    [orders, address],
  )

  if (!isConnected || !address) {
    return (
      <div className="p2p-card rounded-xl px-6 py-14 text-center">
        <p className="text-base font-bold text-[var(--p2p-ink)]">Connect Your Wallet</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--p2p-muted)]">
          Inspect your P2P User Center, saved payment methods, feedback, and Merchant Security Margin.
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
      </div>
    )
  }

  const displayName =
    myAccountProfile?.displayName?.trim() ||
    traderDetail?.profile.displayName?.trim() ||
    shortAddr(address)
  const initial = traderInitial(address, traderDetail?.profile ?? null)
  const idVerified = kyc.verified || myAccountProfile?.kycStatus === 'approved'
  const emailVerified = !!myAccountProfile?.emailVerified
  const feedbackSummary = traderDetail?.profile ?? null
  const feedbackItems = traderDetail?.feedback ?? []
  const positivePctText =
    feedbackSummary?.positivePct !== null && feedbackSummary?.positivePct !== undefined
      ? `${feedbackSummary.positivePct.toFixed(2)}%`
      : '100.00%'
  const posCount = feedbackSummary?.positiveCount ?? 0
  const negCount = feedbackSummary?.negativeCount ?? 0
  const totalFeedback = feedbackSummary?.totalFeedback ?? 0

  const joinedAtIso = myAccountProfile?.createdAt ?? feedbackSummary?.joinedAt ?? null
  const registeredDays = joinedAtIso
    ? Math.max(0, Math.floor((now - Math.floor(new Date(joinedAtIso).getTime() / 1000)) / 86_400))
    : 0

  const totalOrderVol = metrics.buyVolumeUsdc + metrics.sellVolumeUsdc
  const totalVolumeUsdc = account && account.volume > totalOrderVol ? account.volume : totalOrderVol
  const totalPortfolioUsdc = (balance ?? 0n) + (account?.margin ?? 0n)

  const shareOwnProfile = async () => {
    try {
      const link = await buildShareLink(`/p2p?trader=${address.toLowerCase()}`)
      await navigator.clipboard.writeText(link)
      toast.success('Profile link copied to clipboard')
    } catch {
      toast.error('Could not copy profile link')
    }
  }

  const copyAdShareLink = async (adId: string) => {
    try {
      const link = await buildShareLink(`/p2p?trade=${adId}`)
      await navigator.clipboard.writeText(link)
      toast.success(`Ad #${adId} share link copied`)
    } catch {
      toast.error('Could not copy ad share link')
    }
  }

  const copyP2pHomeLink = async () => {
    try {
      const link = await buildShareLink('/p2p')
      await navigator.clipboard.writeText(link)
      toast.success('P2P shortcut URL copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  const totalDebt = account?.totalDebt ?? 0n
  const depositRaw = parseUsdcInput(deposit)
  const withdrawRaw = parseUsdcInput(withdraw)
  const repayRaw = repay ? parseUsdcInput(repay) : totalDebt
  const effectiveRepay = repayRaw > totalDebt ? totalDebt : repayRaw
  const pendingWithdrawal = account?.pendingWithdrawal ?? 0n
  const unlockIn = account ? Number(account.withdrawalUnlockAt) - now : 0
  const tierMeta = TIER_TABLE[account?.tier ?? 0] ?? TIER_TABLE[0]

  const doDeposit = async () => {
    if (!ESCROW_ADDRESS || depositRaw === 0n) return
    if ((allowance ?? 0n) < depositRaw) {
      const ok = await approveUsdc(depositRaw)
      if (!ok) return
    }
    const ok = await run('deposit', 'Deposit margin', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        chainId: CHAIN_ID,
        functionName: 'depositMargin',
        args: [depositRaw],
      }),
    )
    if (ok) setDeposit('')
  }

  const doRepay = async () => {
    if (!ESCROW_ADDRESS || effectiveRepay === 0n) return
    if ((allowance ?? 0n) < effectiveRepay) {
      const ok = await approveUsdc(effectiveRepay)
      if (!ok) return
    }
    const ok = await run('repayDebt', 'Repay dispute bond debt', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        chainId: CHAIN_ID,
        functionName: 'repayDebt',
        args: [effectiveRepay],
      }),
    )
    if (ok) setRepay('')
  }

  const doRequestWithdrawal = async () => {
    if (!ESCROW_ADDRESS || withdrawRaw === 0n) return
    const ok = await run('request', 'Request withdrawal', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        chainId: CHAIN_ID,
        functionName: 'requestMarginWithdrawal',
        args: [withdrawRaw],
      }),
    )
    if (ok) setWithdraw('')
  }

  // ---- Reusable Section Renderers (Shared by Desktop Tabs & Mobile Sub-Views) ----

  const renderDebtRepayCard = () => {
    if (!account || account.totalDebt === 0n) return null
    return (
      <section className="rounded-2xl border border-[#FF5A00] bg-[var(--p2p-surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#FF5A00] sm:text-base">
            <AlertTriangle className="size-4" />
            Unpaid Dispute Bond: <span className="p2p-mono">{formatUsdcAmount(account.totalDebt)} USDC</span>
          </h2>
        </div>
        <p className="mt-1 text-xs text-[var(--p2p-muted)]">
          New ads and new orders are restricted until this dispute bond debt is repaid. Existing orders and withdrawals remain open.
        </p>

        {debts.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-xs">
            {debts.map((d, idx) => (
              <li
                key={`${d.creditor}-${idx}`}
                className="flex items-center justify-between rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 py-2"
              >
                <span className="text-[var(--p2p-muted)]">
                  Creditor <span className="p2p-mono text-[var(--p2p-ink)]">{shortAddr(d.creditor)}</span>
                </span>
                <span className="p2p-mono font-bold text-[#FF5A00]">{formatUsdcAmount(d.amount)} USDC</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
              Amount to Repay (USDC)
            </span>
            <input
              inputMode="decimal"
              value={repay}
              onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setRepay(e.target.value)}
              placeholder={formatUnitsFixed(account.totalDebt, 6, 2)}
              className="p2p-input p2p-mono h-11 w-full rounded-lg px-3 text-sm font-bold"
            />
          </label>
          <button
            type="button"
            disabled={effectiveRepay === 0n || (balance !== undefined && effectiveRepay > balance) || busy}
            onClick={() => void doRepay()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-40"
          >
            {(pendingKey === 'repayDebt' || pendingKey === 'approve') && (
              <Loader2 className="size-4 animate-spin" />
            )}
            Repay {formatUsdcAmount(effectiveRepay)} USDC
          </button>
        </div>
      </section>
    )
  }

  const renderMerchantMarginSection = () => {
    if (!account || !ESCROW_ADDRESS) {
      return (
        <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-6 text-xs text-[var(--p2p-muted)]">
          Loading onchain Merchant Security Margin from Arc Testnet...
        </div>
      )
    }

    return (
      <section className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p2p-border)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[var(--p2p-ink)]">Merchant Security Margin</h2>
              {account.merchant && (
                <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
                  <ShieldCheck className="size-3.5" /> Verified Merchant
                </span>
              )}
            </div>
            <p className="mt-1 max-w-2xl text-xs text-[var(--p2p-muted)]">
              Stake <strong className="text-[var(--p2p-ink)]">{formatUsdcAmount(MERCHANT_MARGIN, 0)} USDC</strong> or more to earn the Verified Merchant badge, unlock Buy Ads immediately, and receive at least the 500 USDC per-order tier. Withdrawals have a {MARGIN_DELAY_DAYS}-day timelock and require zero open orders.
            </p>
          </div>

          <div className="flex gap-4 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-2.5">
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">Total Margin</span>
              <span className="p2p-mono text-base font-bold text-[var(--p2p-ink)]">
                {formatUsdcAmount(account.margin)} USDC
              </span>
            </div>
            <div className="border-l border-[var(--p2p-border)] pl-4">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">Free Margin</span>
              <span className="p2p-mono text-base font-bold text-[#FF5A00]">
                {formatUsdcAmount(account.effectiveMargin)} USDC
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--p2p-ink)]">Stake USDC Margin</span>
              {balance !== undefined && (
                <span className="p2p-mono text-[var(--p2p-muted)]">Wallet: {formatUsdcAmount(balance)} USDC</span>
              )}
            </div>
            <div className="p2p-input flex items-center rounded-lg !bg-[var(--p2p-surface-solid)] px-3 py-2.5">
              <input
                inputMode="decimal"
                value={deposit}
                onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setDeposit(e.target.value)}
                placeholder="100.00"
                className="p2p-mono w-full bg-transparent text-sm font-bold text-[var(--p2p-ink)] outline-none"
              />
              <button
                type="button"
                onClick={() => setDeposit('100')}
                className="mr-2 text-xs font-bold text-[#FF5A00]"
              >
                100
              </button>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--p2p-ink)]">
                <TokenUSDC variant="branded" size={14} /> USDC
              </span>
            </div>
            <button
              type="button"
              disabled={depositRaw === 0n || (balance !== undefined && depositRaw > balance) || busy}
              onClick={() => void doDeposit()}
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-40"
            >
              {(pendingKey === 'deposit' || pendingKey === 'approve') && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              Deposit Margin
            </button>
          </div>

          <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-4 space-y-3">
            {pendingWithdrawal === 0n ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--p2p-ink)]">Request Margin Withdrawal</span>
                  <span className="text-[var(--p2p-muted)]">{MARGIN_DELAY_DAYS}-day cooldown</span>
                </div>
                <div className="p2p-input flex items-center rounded-lg !bg-[var(--p2p-surface-solid)] px-3 py-2.5">
                  <input
                    inputMode="decimal"
                    value={withdraw}
                    onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setWithdraw(e.target.value)}
                    placeholder="0.00"
                    className="p2p-mono w-full bg-transparent text-sm font-bold text-[var(--p2p-ink)] outline-none"
                  />
                  <span className="text-xs font-bold text-[var(--p2p-ink)]">USDC</span>
                </div>
                <button
                  type="button"
                  disabled={withdrawRaw === 0n || withdrawRaw > account.margin || busy}
                  onClick={() => void doRequestWithdrawal()}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] px-4 text-xs font-bold text-[var(--p2p-ink)] hover:border-[#FF5A00] disabled:opacity-40"
                >
                  {pendingKey === 'request' && <Loader2 className="size-3.5 animate-spin" />}
                  Request Withdrawal
                </button>
              </>
            ) : (
              <div className="flex h-full flex-col justify-between space-y-3">
                <div>
                  <p className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">
                    Queued: {formatUsdcAmount(pendingWithdrawal)} USDC
                  </p>
                  <p className="mt-1 text-xs text-[var(--p2p-muted)]">
                    {unlockIn > 0 ? `Unlocks in ${formatDuration(unlockIn)}` : 'Unlocked — ready to withdraw'}
                    {account.partyOpen > 0n && ' • Finish open orders first'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={unlockIn > 0 || account.partyOpen > 0n || busy}
                    onClick={() =>
                      void run('complete', 'Withdraw margin', () =>
                        writeContractAsync({
                          address: ESCROW_ADDRESS!,
                          abi: p2pEscrowAbi,
                          chainId: CHAIN_ID,
                          functionName: 'completeMarginWithdrawal',
                        }),
                      )
                    }
                    className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#FF5A00] px-3 text-xs font-bold text-[#FFFFFF] disabled:opacity-40"
                  >
                    Withdraw
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run('cancelReq', 'Cancel request', () =>
                        writeContractAsync({
                          address: ESCROW_ADDRESS!,
                          abi: p2pEscrowAbi,
                          chainId: CHAIN_ID,
                          functionName: 'cancelMarginWithdrawal',
                        }),
                      )
                    }
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] px-3 text-xs font-semibold text-[var(--p2p-ink)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    )
  }

  const renderHelpSection = () => {
    const guides = [
      {
        title: '1. How to Buy & Sell USDC on OnPeer P2P',
        body: 'Select Buy or Sell in the P2P market, choose your local currency (BDT, INR, PKR, etc.), enter an amount, and place an order. Every trade locks USDC directly inside the verified Arc Testnet P2PEscrow smart contract with 0 platform trade fee.',
      },
      {
        title: '2. Placing an Order & Auto-Filled Payment Methods',
        body: 'Save your bKash, Nagad, Rocket, UPI, or bank accounts under P2P Payment Methods. When you sell USDC or post an ad, selecting your saved method auto-fills your encrypted receiving details automatically.',
      },
      {
        title: '3. Anti-Scam Safety Rules (Strict Name-Match Rule)',
        body: 'Always verify inside your own banking or mobile-money app that the sender/receiver name matches your counterparty. Never transfer or release funds if a third-party name appears — OnPeer is not liable if you proceed despite a name mismatch.',
      },
      {
        title: '4. P2P Trading FAQ: 30-Minute Cooling-Off & Disputes',
        body: 'If an issue arises, file a dispute from the Order Room. Before an arbiter takes the case, either party can settle peacefully within 30 minutes with zero dispute bond or penalty.',
      },
    ]

    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {guides.map((g) => (
          <section
            key={g.title}
            className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 sm:p-5"
          >
            <h3 className="text-sm font-bold text-[var(--p2p-ink)]">{g.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--p2p-muted)]">{g.body}</p>
          </section>
        ))}
      </div>
    )
  }

  const renderFeedbackContent = () => {
    const shown =
      fbFilter === 'pos'
        ? feedbackItems.filter((f) => f.positive)
        : fbFilter === 'neg'
          ? feedbackItems.filter((f) => !f.positive)
          : feedbackItems

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4">
          <div className="flex items-center gap-6">
            <div>
              <span className="block text-[11px] text-[var(--p2p-muted)]">Positive Feedback</span>
              <p className="p2p-mono mt-0.5 text-xl font-extrabold text-emerald-400">{positivePctText}</p>
            </div>
            <div className="border-l border-[var(--p2p-border)] pl-6 text-xs">
              <span className="text-emerald-400 font-bold">Positive {posCount}</span>
              <span className="mx-2 text-[var(--p2p-muted)]">/</span>
              <span className="text-red-400 font-bold">Negative {negCount}</span>
            </div>
          </div>

          <div className="flex gap-1.5">
            {[
              { id: 'all' as const, label: `All (${totalFeedback})` },
              { id: 'pos' as const, label: `Positive (${posCount})` },
              { id: 'neg' as const, label: `Negative (${negCount})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFbFilter(t.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                  fbFilter === t.id
                    ? 'border-[#FF5A00] bg-[#FF5A00] text-white'
                    : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-14 text-center text-xs text-[var(--p2p-muted)]">
            No counterparty reviews in this category yet.
          </div>
        ) : (
          <ul className="space-y-2.5">
            {shown.map((f) => (
              <li
                key={f.id}
                className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[var(--p2p-ink)]">
                      {f.fromDisplayName ?? f.fromWallet}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold ${
                        f.positive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                      }`}
                    >
                      {f.positive ? <ThumbsUp className="size-3" /> : <ThumbsDown className="size-3" />}
                      {f.positive ? 'Positive' : 'Negative'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--p2p-muted)]">
                    <span className="inline-flex items-center gap-0.5 text-[#FF5A00]">
                      {Array.from({ length: f.rating }).map((_, idx) => (
                        <Star key={idx} className="size-3 fill-[#FF5A00] text-[#FF5A00]" />
                      ))}
                    </span>
                    <span className="p2p-mono">{f.createdAt.slice(0, 10)}</span>
                  </div>
                </div>
                {f.comment && <p className="text-xs text-[var(--p2p-ink)]">{f.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const renderRestrictionsContent = () => {
    const hasSuspended =
      totalDebt > 0n ||
      !!blocked ||
      (account ? account.strikes >= 3 || account.lateMarks >= 2 : false)
    const hasFrozen = myLockedOrders.length > 0 || pendingWithdrawal > 0n

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-6 border-b border-[var(--p2p-border)] px-1">
          {[
            { id: 'suspended' as const, label: 'Suspended Function(s)' },
            { id: 'frozen' as const, label: 'Frozen Assets' },
          ].map((t) => {
            const active = restrictionsTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setRestrictionsTab(t.id)}
                className={`relative pb-3 text-xs font-bold transition-colors sm:text-sm ${
                  active ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                }`}
              >
                {t.label}
                {active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#FF5A00]" />}
              </button>
            )
          })}
        </div>

        {restrictionsTab === 'suspended' ? (
          !hasSuspended ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)]">
                <FileSearch className="size-8" />
              </div>
              <p className="mt-4 text-sm font-medium text-[var(--p2p-muted)]">No restrictions found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {renderDebtRepayCard()}
              {blocked && (
                <div className="rounded-xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-surface)] p-4 text-xs">
                  <p className="font-bold text-[#FF5A00]">Trading Restriction Active</p>
                  <p className="mt-1 text-[var(--p2p-muted)]">{blocked}</p>
                  {kycRequired && !kyc.verified && (
                    <button
                      type="button"
                      onClick={() => {
                        setView('kyc')
                        setDesktopTab('notifications')
                      }}
                      className="mt-3 inline-flex h-9 items-center rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white"
                    >
                      Complete KYC Verification
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        ) : !hasFrozen ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)]">
              <FileSearch className="size-8" />
            </div>
            <p className="mt-4 text-sm font-medium text-[var(--p2p-muted)]">No frozen assets found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingWithdrawal > 0n && (
              <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 text-xs">
                <p className="font-bold text-[var(--p2p-ink)]">
                  Timelocked Margin Withdrawal: <span className="p2p-mono text-[#FF5A00]">{formatUsdcAmount(pendingWithdrawal)} USDC</span>
                </p>
                <p className="mt-1 text-[var(--p2p-muted)]">
                  {unlockIn > 0 ? `Unlocks in ${formatDuration(unlockIn)}` : 'Unlocked — ready to withdraw'}
                </p>
              </div>
            )}
            {myLockedOrders.map((o) => (
              <div
                key={o.id.toString()}
                className="flex items-center justify-between rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-4 py-3.5 text-xs"
              >
                <div>
                  <p className="font-bold text-[var(--p2p-ink)]">
                    Escrow Order #{o.rawId.toString()} ({o.asset})
                  </p>
                  <p className="mt-0.5 text-[var(--p2p-muted)]">{STATUS_META[o.status]?.label ?? 'Active'}</p>
                </div>
                <span className="p2p-mono text-sm font-bold text-[#FF5A00]">
                  {formatUsdcAmount(o.amount, undefined, o.asset)} {o.asset}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // =========================================================================
  // TRADE INFO MODAL (Exact SS 6 — Triggered by `⋯` button in Desktop User Center)
  // =========================================================================
  const tradeInfoModal =
    tradeInfoOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="p2p-terminal fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
            onClick={() => setTradeInfoOpen(false)}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-label="Trade Info"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[440px] rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] p-6 text-xs text-[var(--p2p-ink)] shadow-2xl space-y-3.5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold text-[var(--p2p-ink)]">Trade Info</h2>
                <button
                  type="button"
                  onClick={() => setTradeInfoOpen(false)}
                  aria-label="Close Trade Info"
                  className="inline-flex size-7 items-center justify-center rounded-lg text-[var(--p2p-muted)] hover:bg-[var(--p2p-input-bg)] hover:text-[var(--p2p-ink)]"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--p2p-muted)]">30d Trades</span>
                  <span className="p2p-mono font-bold">{metrics.trades30d} Time(s)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--p2p-muted)]">30d Completion Rate</span>
                  <span className="p2p-mono font-bold">{metrics.completion30dPct}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--p2p-muted)]">Avg. Release Time</span>
                  <span className="p2p-mono font-bold">{metrics.avgReleaseMin} Minute(s)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--p2p-muted)]">Avg. Pay Time</span>
                  <span className="p2p-mono font-bold">{metrics.avgPayMin} Minute(s)</span>
                </div>
              </div>

              <div className="border-t border-[var(--p2p-border)] pt-3.5 space-y-3">
                <div className="flex items-start justify-between">
                  <span className="text-[var(--p2p-muted)]">Positive Feedback</span>
                  <div className="text-right">
                    <p className="p2p-mono font-bold">{positivePctText}</p>
                    <p className="p2p-mono mt-0.5 text-[11px]">
                      Positive <span className="text-emerald-400">{posCount}</span> / Negative{' '}
                      <span className="text-red-400">{negCount}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[var(--p2p-muted)]">Registered</span>
                  <span className="p2p-mono font-bold">{registeredDays} Day(s)</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[var(--p2p-muted)]">First Trade</span>
                  <span className="p2p-mono font-bold">
                    {metrics.firstTradeDaysAgo !== null ? `${metrics.firstTradeDaysAgo} Day(s)` : '0 Day(s)'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[var(--p2p-muted)]">Trading Counterparties</span>
                  <span className="p2p-mono font-bold">{metrics.counterpartiesCount}</span>
                </div>

                <div className="flex items-start justify-between">
                  <span className="text-[var(--p2p-muted)]">All Trades</span>
                  <div className="text-right">
                    <p className="p2p-mono font-bold">{metrics.allCompleted} Time(s)</p>
                    <p className="p2p-mono mt-0.5 text-[11px]">
                      <span className="text-[#FF5A00]">Buy {metrics.buyCompleted}</span> /{' '}
                      <span className="text-red-400">Sell {metrics.sellCompleted}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[var(--p2p-muted)]">Approx. 30d Volume</span>
                  <span className="p2p-mono font-bold">{formatUsdcAmount(metrics.volume30dUsdc)} USDC</span>
                </div>

                <div className="flex items-start justify-between">
                  <span className="text-[var(--p2p-muted)]">Approx. Total Volume</span>
                  <div className="text-right">
                    <p className="p2p-mono font-bold">{formatUsdcAmount(totalVolumeUsdc)} USDC</p>
                    <p className="p2p-mono mt-0.5 text-[11px]">
                      <span className="text-[#FF5A00]">Buy {formatUsdcAmount(metrics.buyVolumeUsdc)} USDC</span> /{' '}
                      <span className="text-red-400">Sell {formatUsdcAmount(metrics.sellVolumeUsdc)} USDC</span>
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>,
          document.body,
        )
      : null

  // =========================================================================
  // DESKTOP USER CENTER (>= 768px — Exact SS 4, SS 5, SS 6 Layout, No Footer)
  // =========================================================================
  const desktopUserCenter = (
    <div className="hidden md:block space-y-6">
      {renderDebtRepayCard()}

      {/* Top Hero Banner + Identity Header (SS 4) */}
      <section className="overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
        {/* Orbital Dark/Orange Header Strip with Become Merchant CTA */}
        <div
          className="flex h-24 items-center justify-end px-7"
          style={{
            background:
              'radial-gradient(circle at 60% -20%, rgba(255,90,0,0.34), transparent 52%), linear-gradient(90deg, rgba(255,90,0,0.08) 0%, rgba(20,20,20,0.5) 100%)',
          }}
        >
          <button
            type="button"
            onClick={() => setDesktopOverlay((cur) => (cur === 'merchant' ? null : 'merchant'))}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white shadow-sm hover:opacity-90"
          >
            <Store className="size-3.5" />
            {account?.merchant ? 'Manage Merchant' : 'Become merchant'}
          </button>
        </div>

        <div className="px-7 pb-6 -mt-8 space-y-6">
          {/* Identity + Portfolio Value Row */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <div className="relative flex size-16 items-center justify-center rounded-full border-4 border-[var(--p2p-surface-solid)] bg-[var(--p2p-input-bg)] text-xl font-extrabold text-[#FF5A00]">
                {initial}
                <span className="absolute bottom-0 right-0 size-3.5 rounded-full border-2 border-[var(--p2p-surface-solid)] bg-emerald-400" />
              </div>

              <div className="pb-0.5 space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-extrabold text-[var(--p2p-ink)]">{displayName}</h1>
                  {(idVerified || account?.merchant) && (
                    <BadgeCheck className="size-4 text-[#FF5A00]" />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDesktopOverlay(null)
                      setDesktopTab('notifications')
                    }}
                    title="Edit Display Alias"
                    className="rounded p-1 text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void shareOwnProfile()}
                    title="Share Profile"
                    className="rounded p-1 text-[var(--p2p-muted)] hover:text-[#FF5A00]"
                  >
                    <Share2 className="size-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <span
                    className={`inline-flex items-center gap-1 font-semibold ${
                      emailVerified ? 'text-emerald-400' : 'text-[var(--p2p-muted)]'
                    }`}
                  >
                    <Check className="size-3.5" /> Email
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                    <Check className="size-3.5" /> Wallet
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDesktopOverlay(null)
                      setDesktopTab('notifications')
                    }}
                    className={`inline-flex items-center gap-1 font-semibold hover:underline ${
                      idVerified ? 'text-emerald-400' : 'text-[var(--p2p-muted)]'
                    }`}
                  >
                    <Check className="size-3.5" /> KYC
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Wallet & Escrow Value with Eye Toggle (SS 4) */}
            <div className="text-right">
              <button
                type="button"
                onClick={() => setHideValue((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]"
              >
                <span>Escrow &amp; Wallet Value</span>
                {hideValue ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
              <p className="p2p-mono mt-1 text-sm font-extrabold text-[var(--p2p-ink)]">
                {hideValue ? '************' : `${formatUsdcAmount(totalPortfolioUsdc)} USDC`}
              </p>
            </div>
          </div>

          {/* 5 Horizontal Stat Cards + `⋯` Trade Info Trigger (SS 4 & SS 6) */}
          <div className="flex items-center gap-3">
            <div className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-4 text-center">
                <span className="block text-xs text-[var(--p2p-muted)]">30d Trades</span>
                <p className="p2p-mono mt-2 text-lg font-extrabold text-[var(--p2p-ink)]">
                  {metrics.trades30d}{' '}
                  <span className="text-xs font-normal text-[var(--p2p-muted)]">Time(s)</span>
                </p>
              </div>

              <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-4 text-center">
                <span className="block text-xs text-[var(--p2p-muted)]">30d Completion Rate</span>
                <p className="p2p-mono mt-2 text-lg font-extrabold text-[var(--p2p-ink)]">
                  {metrics.completion30dPct}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-4 text-center">
                <span className="block text-xs text-[var(--p2p-muted)]">Avg. Release Time</span>
                <p className="p2p-mono mt-2 text-lg font-extrabold text-[var(--p2p-ink)]">
                  {metrics.avgReleaseMin}{' '}
                  <span className="text-xs font-normal text-[var(--p2p-muted)]">Minute(s)</span>
                </p>
              </div>

              <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-4 text-center">
                <span className="block text-xs text-[var(--p2p-muted)]">Avg. Pay Time</span>
                <p className="p2p-mono mt-2 text-lg font-extrabold text-[var(--p2p-ink)]">
                  {metrics.avgPayMin}{' '}
                  <span className="text-xs font-normal text-[var(--p2p-muted)]">Minute(s)</span>
                </p>
              </div>

              <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-3 text-center">
                <span className="block text-xs text-[var(--p2p-muted)]">Positive Feedback</span>
                <p className="p2p-mono mt-1.5 text-lg font-extrabold text-[var(--p2p-ink)]">
                  {positivePctText}
                </p>
                <p className="p2p-mono mt-0.5 text-[11px] text-[var(--p2p-muted)]">
                  Positive <span className="text-emerald-400">{posCount}</span> / Negative{' '}
                  <span className="text-red-400">{negCount}</span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setTradeInfoOpen(true)}
              aria-label="Open full Trade Info"
              title="Trade Info"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] transition-colors hover:border-[#FF5A00] hover:text-[#FF5A00]"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Optional Inline Drawer for Merchant Margin or Help Center when opened from Banner / More Menu */}
      {desktopOverlay === 'merchant' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-[var(--p2p-ink)]">Become a Merchant</h2>
            <button
              type="button"
              onClick={() => setDesktopOverlay(null)}
              className="text-xs font-bold text-[#FF5A00] hover:underline"
            >
              Close
            </button>
          </div>
          {renderMerchantMarginSection()}
        </div>
      )}

      {desktopOverlay === 'help' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-[var(--p2p-ink)]">P2P Help Center</h2>
            <button
              type="button"
              onClick={() => setDesktopOverlay(null)}
              className="text-xs font-bold text-[#FF5A00] hover:underline"
            >
              Close
            </button>
          </div>
          {renderHelpSection()}
        </div>
      )}

      {/* 6 Horizontal Underline Tabs inside High-Contrast Bar (Exact SS 4 — Readable over Ribbon) */}
      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-5 pt-3 shadow-sm">
        {[
          { id: 'payments' as const, label: 'P2P Payment Methods' },
          { id: 'feedback' as const, label: `Feedback (${totalFeedback})` },
          { id: 'blocked' as const, label: 'Blocked Users' },
          { id: 'follows' as const, label: 'Follows' },
          { id: 'restrictions' as const, label: 'Restrictions Removal Center' },
          { id: 'notifications' as const, label: 'Notification Settings' },
        ].map((t) => {
          const active = desktopTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setDesktopOverlay(null)
                setDesktopTab(t.id)
              }}
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

      {/* Desktop Tab Content */}
      {desktopTab === 'payments' && <PaymentMethodsPanel />}

      {desktopTab === 'feedback' && renderFeedbackContent()}

      {desktopTab === 'blocked' &&
        (blockedUsers.length === 0 ? (
          <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-14 text-center text-xs text-[var(--p2p-muted)]">
            You have not blocked any advertisers.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--p2p-border)] overflow-hidden rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
            {blockedUsers.map((u) => (
              <li key={u.wallet} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => onOpenTrader?.(u.wallet)}
                  className="flex items-center gap-3 text-left"
                >
                  <div className="flex size-9 items-center justify-center rounded-full bg-[var(--p2p-tint)] text-xs font-extrabold text-[#FF5A00]">
                    {traderInitial(u.wallet, u)}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[var(--p2p-ink)]">{traderLabel(u.wallet, u)}</p>
                    <p className="p2p-mono text-[11px] text-[var(--p2p-muted)]">{shortAddr(u.wallet)}</p>
                  </div>
                </button>
                <button
                  type="button"
                  disabled={updatingRel}
                  onClick={() => void setRelation({ target: u.wallet, kind: 'block', active: false })}
                  className="h-8 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 text-xs font-bold text-[var(--p2p-ink)] hover:border-[#FF5A00]"
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        ))}

      {desktopTab === 'follows' &&
        (following.length === 0 ? (
          <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-14 text-center text-xs text-[var(--p2p-muted)]">
            You are not following any advertisers yet.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--p2p-border)] overflow-hidden rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
            {following.map((u) => (
              <li key={u.wallet} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => onOpenTrader?.(u.wallet)}
                  className="flex items-center gap-3 text-left"
                >
                  <div className="flex size-9 items-center justify-center rounded-full bg-[var(--p2p-tint)] text-xs font-extrabold text-[#FF5A00]">
                    {traderInitial(u.wallet, u)}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[var(--p2p-ink)]">{traderLabel(u.wallet, u)}</p>
                    <p className="p2p-mono text-[11px] text-[var(--p2p-muted)]">{shortAddr(u.wallet)}</p>
                  </div>
                </button>
                <button
                  type="button"
                  disabled={updatingRel}
                  onClick={() => void setRelation({ target: u.wallet, kind: 'follow', active: false })}
                  className="h-8 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 text-xs font-bold text-[var(--p2p-ink)] hover:border-[#FF5A00]"
                >
                  Unfollow
                </button>
              </li>
            ))}
          </ul>
        ))}

      {desktopTab === 'restrictions' && renderRestrictionsContent()}

      {desktopTab === 'notifications' && (
        <div className="space-y-5">
          <AccountSetup />
          <KycPanel />
        </div>
      )}
    </div>
  )

  // =========================================================================
  // MOBILE PROFILE / USER CENTER (< 768px — Preserves SS 7, 8, 9, 10, 11)
  // =========================================================================
  const renderMobileView = () => {
    if (view === 'settings') {
      return (
        <div className="space-y-4">
          <div className="relative flex items-center justify-center border-b border-[var(--p2p-border)] pb-3.5">
            <button
              type="button"
              onClick={() => setView('main')}
              aria-label="Back to profile"
              className="absolute left-0 inline-flex size-9 items-center justify-center rounded-lg text-[var(--p2p-ink)]"
            >
              <ArrowLeft className="size-5" />
            </button>
            <h1 className="text-base font-bold text-[var(--p2p-ink)]">Settings</h1>
          </div>

          <section className="overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] divide-y divide-[var(--p2p-border)]">
            <button
              type="button"
              onClick={() => setView('restrictions')}
              className="flex w-full items-center justify-between px-4 py-4 text-left text-sm font-semibold text-[var(--p2p-ink)]"
            >
              <span>Restrictions Removal Center</span>
              <ChevronRight className="size-4 text-[var(--p2p-muted)]" />
            </button>

            <button
              type="button"
              onClick={() => {
                setReturnToSettings(true)
                setView('notifications')
              }}
              className="flex w-full items-center justify-between px-4 py-4 text-left text-sm font-semibold text-[var(--p2p-ink)]"
            >
              <span>Notifications</span>
              <ChevronRight className="size-4 text-[var(--p2p-muted)]" />
            </button>
          </section>
        </div>
      )
    }

    if (view === 'restrictions') {
      return (
        <div className="space-y-4">
          <div className="relative flex items-center justify-center border-b border-[var(--p2p-border)] pb-3.5">
            <button
              type="button"
              onClick={() => setView('settings')}
              aria-label="Back to settings"
              className="absolute left-0 inline-flex size-9 items-center justify-center rounded-lg text-[var(--p2p-ink)]"
            >
              <ArrowLeft className="size-5" />
            </button>
            <h1 className="text-base font-bold text-[var(--p2p-ink)]">Restrictions</h1>
          </div>
          {renderRestrictionsContent()}
        </div>
      )
    }

    if (view === 'notifications') {
      return (
        <div className="space-y-4">
          <SubViewHeader
            title="Notifications & Profile Alias"
            onBack={() => {
              const target = returnToSettings ? 'settings' : 'main'
              setReturnToSettings(false)
              setView(target)
            }}
          />
          <AccountSetup />
        </div>
      )
    }

    if (view === 'payments') {
      return (
        <div className="space-y-4">
          <SubViewHeader title="Payment Method(s)" onBack={() => setView('main')} />
          <PaymentMethodsPanel />
        </div>
      )
    }

    if (view === 'feedback') {
      return (
        <div className="space-y-4">
          <SubViewHeader title="Received Feedback" onBack={() => setView('main')} />
          {renderFeedbackContent()}
        </div>
      )
    }

    if (view === 'alerts') {
      const addAlert = () => {
        const cleaned = alertPrice.trim()
        if (!cleaned || Number(cleaned) <= 0) {
          toast.error('Enter a valid target rate')
          return
        }
        const next = [buildAlertEntry(alertCurrency, alertSide, cleaned), ...alerts].slice(0, 20)
        setAlerts(next)
        saveCustomAlerts(next)
        setAlertPrice('')
        toast.success('Custom rate alert saved')
      }

      const removeAlert = (id: string) => {
        const next = alerts.filter((a) => a.id !== id)
        setAlerts(next)
        saveCustomAlerts(next)
      }

      return (
        <div className="space-y-4">
          <SubViewHeader title="Custom Alerts" onBack={() => setView('main')} />

          <section className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 space-y-3">
            <div className="grid gap-2.5">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={alertSide}
                  onChange={(e) => setAlertSide(e.target.value === 'sell' ? 'sell' : 'buy')}
                  className="p2p-input h-10 rounded-lg px-3 text-xs font-bold"
                >
                  <option value="buy">Buy USDC</option>
                  <option value="sell">Sell USDC</option>
                </select>
                <select
                  value={alertCurrency}
                  onChange={(e) => setAlertCurrency(e.target.value)}
                  className="p2p-input h-10 rounded-lg px-3 text-xs font-bold"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.currency}>
                      {c.currency}
                    </option>
                  ))}
                </select>
              </div>
              <input
                inputMode="decimal"
                value={alertPrice}
                onChange={(e) => /^\d*\.?\d{0,4}$/.test(e.target.value) && setAlertPrice(e.target.value)}
                placeholder={`Target rate in ${alertCurrency}`}
                className="p2p-input p2p-mono h-10 rounded-lg px-3 text-xs font-bold"
              />
              <button
                type="button"
                onClick={addAlert}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white"
              >
                <Plus className="size-3.5" /> Add Alert
              </button>
            </div>
          </section>

          {alerts.length > 0 && (
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-4 py-3 text-xs"
                >
                  <span className="p2p-mono font-bold text-[var(--p2p-ink)]">
                    {a.side.toUpperCase()} • {a.targetPrice} {a.currency}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAlert(a.id)}
                    className="text-[var(--p2p-muted)] hover:text-red-400"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }

    if (view === 'follows') {
      const list = followsTab === 'blocked' ? blockedUsers : following
      return (
        <div className="space-y-4">
          <SubViewHeader title="Blocked Users & Follows" onBack={() => setView('main')} />
          <div className="flex items-center gap-6 border-b border-[var(--p2p-border)] px-1">
            {[
              { id: 'blocked' as const, label: `Blocked (${blockedUsers.length})` },
              { id: 'following' as const, label: `Following (${following.length})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFollowsTab(t.id)}
                className={`relative pb-2.5 text-sm font-bold ${
                  followsTab === t.id ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)]'
                }`}
              >
                {t.label}
                {followsTab === t.id && (
                  <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#FF5A00]" />
                )}
              </button>
            ))}
          </div>

          {list.length === 0 ? (
            <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-12 text-center text-xs text-[var(--p2p-muted)]">
              {followsTab === 'blocked' ? 'No blocked users.' : 'Not following anyone yet.'}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--p2p-border)] overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
              {list.map((u) => (
                <li key={u.wallet} className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <button
                    type="button"
                    onClick={() => onOpenTrader?.(u.wallet)}
                    className="text-left text-sm font-bold text-[var(--p2p-ink)]"
                  >
                    {traderLabel(u.wallet, u)}
                  </button>
                  <button
                    type="button"
                    disabled={updatingRel}
                    onClick={() =>
                      void setRelation({
                        target: u.wallet,
                        kind: followsTab === 'blocked' ? 'block' : 'follow',
                        active: false,
                      })
                    }
                    className="h-8 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-xs font-bold text-[var(--p2p-ink)]"
                  >
                    {followsTab === 'blocked' ? 'Unblock' : 'Unfollow'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }

    if (view === 'recent') {
      return (
        <div className="space-y-4">
          <SubViewHeader
            title="Recently Viewed"
            onBack={() => setView('main')}
            right={
              recentList.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    clearRecentlyViewed()
                    setRecentList([])
                  }}
                  className="text-xs font-bold text-[#FF5A00]"
                >
                  Clear
                </button>
              ) : undefined
            }
          />
          {recentList.length === 0 ? (
            <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-12 text-center text-xs text-[var(--p2p-muted)]">
              No recently viewed advertisers.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--p2p-border)] overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
              {recentList.map((r) => (
                <li key={r.wallet}>
                  <button
                    type="button"
                    onClick={() => onOpenTrader?.(r.wallet)}
                    className="flex w-full items-center justify-between px-4 py-3.5 text-left"
                  >
                    <span className="text-sm font-bold text-[var(--p2p-ink)]">
                      {r.displayName?.trim() || shortAddr(r.wallet)}
                    </span>
                    <ChevronRight className="size-4 text-[var(--p2p-muted)]" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }

    if (view === 'adshare') {
      return (
        <div className="space-y-4">
          <SubViewHeader title="Ad Sharing Code" onBack={() => setView('main')} />
          {myLiveAds.length === 0 ? (
            <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-12 text-center text-xs text-[var(--p2p-muted)]">
              No active ads right now.
            </div>
          ) : (
            <ul className="space-y-3">
              {myLiveAds.map((ad) => {
                const cur = hexToCurrency(ad.currency)
                const idStr = ad.id.toString()
                return (
                  <li
                    key={idStr}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4"
                  >
                    <div>
                      <span className="p2p-mono text-xs font-bold text-[#FF5A00]">ONPEER-AD-{idStr}</span>
                      <p className="p2p-mono mt-0.5 text-xs text-[var(--p2p-ink)]">
                        {ad.side === SIDE_SELL ? 'Sell' : 'Buy'} • {formatPrice(ad.priceE6)} {cur}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyAdShareLink(idStr)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-3.5 text-xs font-bold text-white"
                    >
                      <Copy className="size-3.5" /> Copy
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )
    }

    if (view === 'activities') {
      return (
        <div className="space-y-4">
          <SubViewHeader title="Activities & Tier" onBack={() => setView('main')} />
          <section className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 space-y-3">
            <p className="text-xs font-bold text-[#FF5A00]">
              Tier {account?.tier ?? 0}: {tierMeta.label} • Cap {account ? formatOrderCap(account.orderCap) : '200 USDC'}
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {TIER_TABLE.map((t) => (
                <div
                  key={t.tier}
                  className={`rounded-xl border p-3 text-xs ${
                    (account?.tier ?? 0) === t.tier
                      ? 'border-[#FF5A00] bg-[var(--p2p-tint)]'
                      : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)]'
                  }`}
                >
                  <p className="font-bold text-[var(--p2p-ink)]">
                    Tier {t.tier} • {t.label}
                  </p>
                  <p className="p2p-mono mt-0.5 text-[var(--p2p-muted)]">
                    {t.cap === null ? 'Uncapped' : `${formatUsdcAmount(t.cap, 0)} USDC`}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )
    }

    if (view === 'kyc') {
      return (
        <div className="space-y-4">
          <SubViewHeader title="Identity Verification (KYC)" onBack={() => setView('main')} />
          <KycPanel />
        </div>
      )
    }

    if (view === 'help') {
      return (
        <div className="space-y-4">
          <SubViewHeader title="P2P Help Center" onBack={() => setView('main')} />
          {renderHelpSection()}
        </div>
      )
    }

    if (view === 'homescreen') {
      return (
        <div className="space-y-4">
          <SubViewHeader title="Add P2P To Home Screen" onBack={() => setView('main')} />
          <section className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 space-y-3 text-xs">
            <p className="text-[var(--p2p-muted)]">
              Open browser menu (⋮ on Android Chrome or Share on iOS Safari) and tap <strong>Add to Home Screen</strong>.
            </p>
            <button
              type="button"
              onClick={() => void copyP2pHomeLink()}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#FF5A00] px-4 font-bold text-white"
            >
              <Copy className="size-3.5" /> Copy P2P Shortcut URL
            </button>
          </section>
        </div>
      )
    }

    if (view === 'merchant') {
      return (
        <div className="space-y-4">
          <SubViewHeader title="Become a Merchant" onBack={() => setView('main')} />
          {renderMerchantMarginSection()}
        </div>
      )
    }

    const tradeMenuRows = [
      { id: 'feedback' as const, label: 'Received Feedback', icon: ThumbsUp, count: totalFeedback, showZero: true },
      { id: 'alerts' as const, label: 'Custom Alerts', icon: Bell, count: alerts.length, showZero: false },
      { id: 'payments' as const, label: 'Payment Method(s)', icon: CreditCard, count: savedMethods.length, showZero: true },
      { id: 'follows' as const, label: 'Blocked Users', icon: Ban, count: blockedUsers.length, showZero: false },
      { id: 'recent' as const, label: 'Recently Viewed', icon: Eye, count: recentList.length, showZero: false },
      { id: 'adshare' as const, label: 'Ad Sharing Code', icon: QrCode, count: myLiveAds.length, showZero: false },
    ]

    const othersMenuRows = [
      { id: 'activities' as const, label: 'Activities', icon: Activity },
      { id: 'kyc' as const, label: 'Identity Verification (KYC)', icon: UserCheck },
      { id: 'help' as const, label: 'P2P Help Center', icon: BookOpen },
      { id: 'homescreen' as const, label: 'Add P2P To Home Screen', icon: Smartphone },
      { id: 'merchant' as const, label: 'Become a Merchant', icon: Store },
    ]

    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          {onBackToMarket ? (
            <button
              type="button"
              onClick={onBackToMarket}
              aria-label="Back to market"
              className="inline-flex size-9 items-center justify-center rounded-lg text-[var(--p2p-ink)]"
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void shareOwnProfile()}
              aria-label="Share profile"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-ink)]"
            >
              <Share2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setView('settings')}
              aria-label="Settings"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-ink)]"
            >
              <Settings className="size-4" />
            </button>
          </div>
        </div>

        {renderDebtRepayCard()}

        <div className="flex items-start gap-3.5">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full border border-[var(--p2p-border)] bg-[var(--p2p-tint)] text-xl font-extrabold text-[#FF5A00]">
            {initial}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-[var(--p2p-ink)]">{displayName}</h1>
              <button
                type="button"
                onClick={() => {
                  setReturnToSettings(false)
                  setView('notifications')
                }}
                aria-label="Edit alias"
                className="text-[var(--p2p-muted)]"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
            <p className="text-xs text-[var(--p2p-muted)]">
              {account?.merchant ? 'Verified Merchant' : 'Verified user'}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--p2p-muted)]">
              {(idVerified || emailVerified) && (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                  <Check className="size-3.5" /> Verified
                </span>
              )}
              <span>
                <strong className="text-[var(--p2p-ink)]">{following.length}</strong> Following
              </span>
              <span>
                <strong className="text-[var(--p2p-ink)]">{feedbackSummary?.followersCount ?? 0}</strong> Followers
              </span>
            </div>
          </div>
        </div>

        <section className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="p2p-mono text-2xl font-extrabold text-[var(--p2p-ink)]">{metrics.trades30d}</p>
              <span className="text-xs text-[var(--p2p-muted)]">30d Trades</span>
            </div>
            <div>
              <p className="p2p-mono text-2xl font-extrabold text-[var(--p2p-ink)]">{metrics.completion30dPct}</p>
              <span className="text-xs text-[var(--p2p-muted)]">30d Completion Rate</span>
            </div>
            <div>
              <p className="p2p-mono text-2xl font-extrabold text-[var(--p2p-ink)]">{metrics.avgReleaseMin} m</p>
              <span className="text-xs text-[var(--p2p-muted)]">Avg. Release Time</span>
            </div>
            <div>
              <p className="p2p-mono text-2xl font-extrabold text-[var(--p2p-ink)]">{metrics.avgPayMin} m</p>
              <span className="text-xs text-[var(--p2p-muted)]">Avg. Pay Time</span>
            </div>
          </div>

          {statsExpanded && (
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--p2p-border)] pt-3 text-xs">
              <div>
                <span className="block text-[var(--p2p-muted)]">All Trades</span>
                <span className="p2p-mono font-bold text-[var(--p2p-ink)]">{metrics.allCompleted}</span>
              </div>
              <div>
                <span className="block text-[var(--p2p-muted)]">Total Volume</span>
                <span className="p2p-mono font-bold text-[var(--p2p-ink)]">{formatUsdcAmount(totalVolumeUsdc, 0)} USDC</span>
              </div>
            </div>
          )}

          <div className="mt-3 flex justify-center border-t border-[var(--p2p-border)]/60 pt-2.5">
            <button
              type="button"
              onClick={() => setStatsExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--p2p-muted)]"
            >
              <span>{statsExpanded ? 'Less' : 'More'}</span>
              <ChevronDown className={`size-3.5 transition-transform ${statsExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </section>

        {!account?.merchant && !merchantBannerHidden && (
          <section className="relative rounded-2xl border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-4 py-4 pr-10">
            <button
              type="button"
              onClick={() => setMerchantBannerHidden(true)}
              aria-label="Dismiss"
              className="absolute right-3 top-3 p-1 text-[var(--p2p-muted)]"
            >
              <X className="size-4" />
            </button>
            <div className="flex items-start gap-2.5 text-xs">
              <Store className="mt-0.5 size-4 shrink-0 text-[#FF5A00]" />
              <div>
                <p className="font-bold text-[var(--p2p-ink)]">Become a Merchant</p>
                <p className="mt-0.5 text-[var(--p2p-muted)]">Unlock premium tools, Buy Ads, and buyer trust.</p>
                <button
                  type="button"
                  onClick={() => setView('merchant')}
                  className="mt-1 font-bold text-[#FF5A00]"
                >
                  View more
                </button>
              </div>
            </div>
          </section>
        )}

        <div>
          <div className="flex items-center gap-6 border-b border-[var(--p2p-border)] px-1">
            {[
              { id: 'trade' as const, label: 'Trade' },
              { id: 'others' as const, label: 'Others' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setMainTab(t.id)}
                className={`relative pb-2.5 text-sm font-bold ${
                  mainTab === t.id ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)]'
                }`}
              >
                {t.label}
                {mainTab === t.id && (
                  <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#FF5A00]" />
                )}
              </button>
            ))}
          </div>

          {mainTab === 'trade' ? (
            <ul className="mt-2 divide-y divide-[var(--p2p-border)] overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
              {tradeMenuRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setView(row.id)}
                    className="flex w-full items-center justify-between px-4 py-4 text-left"
                  >
                    <span className="flex items-center gap-3 text-sm font-semibold text-[var(--p2p-ink)]">
                      <row.icon className="size-4 text-[var(--p2p-muted)]" />
                      {row.label}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-[var(--p2p-muted)]">
                      {(row.showZero || row.count > 0) && <span className="p2p-mono">{row.count}</span>}
                      <ChevronRight className="size-4" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--p2p-border)] overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
              {othersMenuRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setView(row.id)}
                    className="flex w-full items-center justify-between px-4 py-4 text-left"
                  >
                    <span className="flex items-center gap-3 text-sm font-semibold text-[var(--p2p-ink)]">
                      <row.icon className="size-4 text-[var(--p2p-muted)]" />
                      {row.label}
                    </span>
                    <ChevronRight className="size-4 text-[var(--p2p-muted)]" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {desktopUserCenter}
      <div className="md:hidden">{renderMobileView()}</div>
      {tradeInfoModal}
    </>
  )
}
