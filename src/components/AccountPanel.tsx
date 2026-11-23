import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Ban,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CreditCard,
  Eye,
  FileSearch,
  Loader2,
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

function resolveInitialSubView(): ProfileSubView {
  if (typeof window === 'undefined') return 'main'
  const hp = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const sp = new URLSearchParams(window.location.search)
  if (hp.has('kyc_return') || sp.has('kyc_return')) return 'kyc'
  if (hp.has('verify_email') || hp.has('unsubscribe')) return 'notifications'
  return 'main'
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
  onOpenTrader,
  onBackToMarket,
}: {
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

  const [view, setView] = useState<ProfileSubView>(resolveInitialSubView)
  const [returnToSettings, setReturnToSettings] = useState(false)
  const [mainTab, setMainTab] = useState<'trade' | 'others'>('trade')
  const [statsExpanded, setStatsExpanded] = useState(false)
  const [merchantBannerHidden, setMerchantBannerHidden] = useState(false)
  const [restrictionsTab, setRestrictionsTab] = useState<'suspended' | 'frozen'>('suspended')
  const [followsTab, setFollowsTab] = useState<'blocked' | 'following'>('blocked')

  // Merchant margin & debt repay inputs
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
          Inspect your P2P profile, saved payment methods, feedback, and Merchant Security Margin.
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

  // =========================================================================
  // SUB-VIEW 1: SETTINGS (SS 9)
  // =========================================================================
  if (view === 'settings') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="relative flex items-center justify-center border-b border-[var(--p2p-border)] pb-3.5">
          <button
            type="button"
            onClick={() => setView('main')}
            aria-label="Back to profile"
            className="absolute left-0 inline-flex size-9 items-center justify-center rounded-lg text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)]"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="text-base font-bold text-[var(--p2p-ink)]">Settings</h1>
        </div>

        <section className="overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] divide-y divide-[var(--p2p-border)]">
          <button
            type="button"
            onClick={() => setView('restrictions')}
            className="flex w-full items-center justify-between px-4 py-4 text-left text-sm font-semibold text-[var(--p2p-ink)] transition-colors hover:bg-[var(--p2p-row-hover)] sm:px-5"
          >
            <span>Restrictions Removal Center</span>
            <div className="flex items-center gap-2">
              {(totalDebt > 0n || !!blocked) && (
                <span className="rounded-full bg-[#FF5A00] px-2 py-0.5 text-[10px] font-bold text-white">
                  Action Needed
                </span>
              )}
              <ChevronRight className="size-4 text-[var(--p2p-muted)]" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setReturnToSettings(true)
              setView('notifications')
            }}
            className="flex w-full items-center justify-between px-4 py-4 text-left text-sm font-semibold text-[var(--p2p-ink)] transition-colors hover:bg-[var(--p2p-row-hover)] sm:px-5"
          >
            <span>Notifications</span>
            <ChevronRight className="size-4 text-[var(--p2p-muted)]" />
          </button>
        </section>
      </div>
    )
  }

  // =========================================================================
  // SUB-VIEW 2: RESTRICTIONS REMOVAL CENTER (SS 10)
  // =========================================================================
  if (view === 'restrictions') {
    const hasSuspended =
      totalDebt > 0n ||
      !!blocked ||
      (account ? account.strikes >= 3 || account.lateMarks >= 2 : false)

    const hasFrozen = myLockedOrders.length > 0 || pendingWithdrawal > 0n

    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="relative flex items-center justify-center border-b border-[var(--p2p-border)] pb-3.5">
          <button
            type="button"
            onClick={() => setView('settings')}
            aria-label="Back to settings"
            className="absolute left-0 inline-flex size-9 items-center justify-center rounded-lg text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)]"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="text-base font-bold text-[var(--p2p-ink)]">Restrictions</h1>
        </div>

        {/* Sub-Tabs: Suspended Function(s) | Frozen Assets (SS 10) */}
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

        {restrictionsTab === 'suspended' ? (
          !hasSuspended ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)]">
                <FileSearch className="size-8" />
              </div>
              <p className="mt-4 text-sm font-medium text-[var(--p2p-muted)]">No restrictions found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {renderDebtRepayCard()}

              {blocked && (
                <div className="rounded-2xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-surface)] p-4 text-xs">
                  <p className="font-bold text-[#FF5A00]">Trading Restriction Active</p>
                  <p className="mt-1 text-[var(--p2p-muted)]">{blocked}</p>
                  {kycRequired && !kyc.verified && (
                    <button
                      type="button"
                      onClick={() => setView('kyc')}
                      className="mt-3 inline-flex h-9 items-center rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white"
                    >
                      Complete KYC Verification
                    </button>
                  )}
                </div>
              )}

              {account && account.lateMarks >= 2 && (
                <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 text-xs">
                  <p className="font-bold text-[var(--p2p-ink)]">Late Payment Recovery Limit Reached (2 / 2)</p>
                  <p className="mt-1 text-[var(--p2p-muted)]">
                    You have used both 5-minute post-deadline late payment marks within the rolling 30-day window. Standard in-window payments remain unaffected.
                  </p>
                </div>
              )}
            </div>
          )
        ) : !hasFrozen ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)]">
              <FileSearch className="size-8" />
            </div>
            <p className="mt-4 text-sm font-medium text-[var(--p2p-muted)]">No frozen assets found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingWithdrawal > 0n && ESCROW_ADDRESS && (
              <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--p2p-ink)]">Timelocked Margin Withdrawal</span>
                  <span className="p2p-mono text-sm font-bold text-[#FF5A00]">
                    {formatUsdcAmount(pendingWithdrawal)} USDC
                  </span>
                </div>
                <p className="text-xs text-[var(--p2p-muted)]">
                  {unlockIn > 0 ? `Unlocks in ${formatDuration(unlockIn)}` : 'Unlocked — ready to withdraw'}
                  {account && account.partyOpen > 0n && ' • Finish open orders first'}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={unlockIn > 0 || (account ? account.partyOpen > 0n : false) || busy}
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
                    className="h-9 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white disabled:opacity-40"
                  >
                    Withdraw Now
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run('cancelReq', 'Cancel withdrawal request', () =>
                        writeContractAsync({
                          address: ESCROW_ADDRESS!,
                          abi: p2pEscrowAbi,
                          chainId: CHAIN_ID,
                          functionName: 'cancelMarginWithdrawal',
                        }),
                      )
                    }
                    className="h-9 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-semibold text-[var(--p2p-ink)]"
                  >
                    Cancel Request
                  </button>
                </div>
              </div>
            )}

            {myLockedOrders.map((o) => (
              <div
                key={o.id.toString()}
                className="flex items-center justify-between rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-4 py-3.5 text-xs"
              >
                <div>
                  <p className="font-bold text-[var(--p2p-ink)]">Escrow Order #{o.id.toString()}</p>
                  <p className="mt-0.5 text-[var(--p2p-muted)]">
                    Status: {STATUS_META[o.status]?.label ?? 'Active'}
                  </p>
                </div>
                <span className="p2p-mono text-sm font-bold text-[#FF5A00]">
                  {formatUsdcAmount(o.amount)} USDC
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // =========================================================================
  // SUB-VIEW 3: NOTIFICATIONS & PROFILE ALIAS (AccountSetup)
  // =========================================================================
  if (view === 'notifications') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SubViewHeader
          title="Notifications & Profile Alias"
          onBack={() => {
            const backTarget = returnToSettings ? 'settings' : 'main'
            setReturnToSettings(false)
            setView(backTarget)
          }}
        />
        <AccountSetup />
      </div>
    )
  }

  // =========================================================================
  // SUB-VIEW 4: PAYMENT METHODS
  // =========================================================================
  if (view === 'payments') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SubViewHeader title="Payment Method(s)" onBack={() => setView('main')} />
        <PaymentMethodsPanel />
      </div>
    )
  }

  // =========================================================================
  // SUB-VIEW 5: RECEIVED FEEDBACK
  // =========================================================================
  if (view === 'feedback') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SubViewHeader title="Received Feedback" onBack={() => setView('main')} />

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4">
            <span className="block text-[11px] text-[var(--p2p-muted)]">Positive Rate</span>
            <p className="p2p-mono mt-1 text-xl font-extrabold text-emerald-400">
              {feedbackSummary?.positivePct !== null && feedbackSummary?.positivePct !== undefined
                ? `${feedbackSummary.positivePct.toFixed(2)}%`
                : '100.00%'}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4">
            <span className="block text-[11px] text-[var(--p2p-muted)]">Positive / Negative</span>
            <p className="p2p-mono mt-1 text-xl font-extrabold text-[var(--p2p-ink)]">
              {feedbackSummary?.positiveCount ?? 0} / {feedbackSummary?.negativeCount ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4">
            <span className="block text-[11px] text-[var(--p2p-muted)]">Avg. Rating</span>
            <p className="p2p-mono mt-1 flex items-center gap-1 text-xl font-extrabold text-[#FF5A00]">
              <Star className="size-4 fill-[#FF5A00] text-[#FF5A00]" />
              {feedbackSummary?.avgRating !== null && feedbackSummary?.avgRating !== undefined
                ? feedbackSummary.avgRating.toFixed(1)
                : '5.0'}
            </p>
          </div>
        </div>

        {feedbackItems.length === 0 ? (
          <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-14 text-center text-xs text-[var(--p2p-muted)]">
            No counterparty reviews received yet. Reviews from completed P2P trades appear here.
          </div>
        ) : (
          <ul className="space-y-2.5">
            {feedbackItems.map((f) => (
              <li
                key={f.id}
                className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[var(--p2p-ink)]">
                      {f.fromDisplayName ?? f.fromWallet}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold ${
                        f.positive
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-red-500/15 text-red-400'
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

  // =========================================================================
  // SUB-VIEW 6: CUSTOM ALERTS
  // =========================================================================
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
      <div className="mx-auto max-w-3xl space-y-4">
        <SubViewHeader title="Custom Alerts" onBack={() => setView('main')} />

        <section className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 sm:p-5 space-y-3">
          <p className="text-xs text-[var(--p2p-muted)]">
            Track target P2P exchange rates across South Asian corridors. For email order &amp; dispute notifications, manage your address in{' '}
            <button
              type="button"
              onClick={() => setView('notifications')}
              className="font-bold text-[#FF5A00] hover:underline"
            >
              Notifications
            </button>
            .
          </p>

          <div className="grid gap-2.5 sm:grid-cols-[120px_120px_1fr_auto]">
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
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white hover:opacity-90"
            >
              <Plus className="size-3.5" /> Add Alert
            </button>
          </div>
        </section>

        {alerts.length === 0 ? (
          <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-12 text-center text-xs text-[var(--p2p-muted)]">
            No custom price alerts configured.
          </div>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-4 py-3 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`rounded px-2 py-0.5 font-bold ${
                      a.side === 'buy'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-[var(--p2p-tint)] text-[#FF5A00]'
                    }`}
                  >
                    {a.side === 'buy' ? 'BUY' : 'SELL'}
                  </span>
                  <span className="p2p-mono font-bold text-[var(--p2p-ink)]">
                    {a.targetPrice} {a.currency} / USDC
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAlert(a.id)}
                  aria-label="Delete alert"
                  className="rounded-lg p-1.5 text-[var(--p2p-muted)] hover:bg-red-500/10 hover:text-red-400"
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

  // =========================================================================
  // SUB-VIEW 7: BLOCKED USERS & FOLLOWS
  // =========================================================================
  if (view === 'follows') {
    const list = followsTab === 'blocked' ? blockedUsers : following
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SubViewHeader title="Blocked Users & Follows" onBack={() => setView('main')} />

        <div className="flex items-center gap-6 border-b border-[var(--p2p-border)] px-1">
          {[
            { id: 'blocked' as const, label: `Blocked (${blockedUsers.length})` },
            { id: 'following' as const, label: `Following (${following.length})` },
          ].map((t) => {
            const active = followsTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFollowsTab(t.id)}
                className={`relative pb-2.5 text-sm font-bold ${
                  active ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)]'
                }`}
              >
                {t.label}
                {active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#FF5A00]" />}
              </button>
            )
          })}
        </div>

        {list.length === 0 ? (
          <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-14 text-center text-xs text-[var(--p2p-muted)]">
            {followsTab === 'blocked'
              ? 'You have not blocked any advertisers.'
              : 'You are not following any advertisers yet.'}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--p2p-border)] overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
            {list.map((u) => (
              <li key={u.wallet} className="flex items-center justify-between gap-3 px-4 py-3.5">
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
                  onClick={() =>
                    void setRelation({
                      target: u.wallet,
                      kind: followsTab === 'blocked' ? 'block' : 'follow',
                      active: false,
                    })
                  }
                  className="h-8 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-xs font-bold text-[var(--p2p-ink)] hover:border-[#FF5A00]"
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

  // =========================================================================
  // SUB-VIEW 8: RECENTLY VIEWED
  // =========================================================================
  if (view === 'recent') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
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
                className="text-xs font-bold text-[#FF5A00] hover:underline"
              >
                Clear
              </button>
            ) : undefined
          }
        />

        {recentList.length === 0 ? (
          <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-14 text-center text-xs text-[var(--p2p-muted)]">
            Advertisers you inspect in the marketplace will appear here for quick access.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--p2p-border)] overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
            {recentList.map((r) => (
              <li key={r.wallet}>
                <button
                  type="button"
                  onClick={() => onOpenTrader?.(r.wallet)}
                  className="flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-[var(--p2p-row-hover)]"
                >
                  <div>
                    <p className="text-sm font-bold text-[var(--p2p-ink)]">
                      {r.displayName?.trim() || shortAddr(r.wallet)}
                    </p>
                    <p className="p2p-mono text-[11px] text-[var(--p2p-muted)]">{shortAddr(r.wallet)}</p>
                  </div>
                  <ChevronRight className="size-4 text-[var(--p2p-muted)]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // =========================================================================
  // SUB-VIEW 9: AD SHARING CODE
  // =========================================================================
  if (view === 'adshare') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SubViewHeader title="Ad Sharing Code" onBack={() => setView('main')} />

        {myLiveAds.length === 0 ? (
          <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] py-14 text-center text-xs text-[var(--p2p-muted)]">
            You have no active P2P ads right now. Post an ad to generate a direct share code and deep link.
          </div>
        ) : (
          <ul className="space-y-3">
            {myLiveAds.map((ad) => {
              const cur = hexToCurrency(ad.currency)
              const idStr = ad.id.toString()
              const code = `ONPEER-AD-${idStr}`
              return (
                <li
                  key={idStr}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="p2p-mono rounded bg-[var(--p2p-tint)] px-2 py-0.5 text-xs font-bold text-[#FF5A00]">
                        {code}
                      </span>
                      <span className="text-xs font-bold text-[var(--p2p-ink)]">
                        {ad.side === SIDE_SELL ? 'Sell USDC' : 'Buy USDC'}
                      </span>
                    </div>
                    <p className="p2p-mono mt-1 text-xs text-[var(--p2p-muted)]">
                      Rate: {formatPrice(ad.priceE6)} {cur} • Available: {formatUsdcAmount(ad.available)} USDC
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void copyAdShareLink(idStr)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white hover:opacity-90"
                  >
                    <Copy className="size-3.5" /> Copy Share Link
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  // =========================================================================
  // SUB-VIEW 10: ACTIVITIES & TIER STANDING
  // =========================================================================
  if (view === 'activities') {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <SubViewHeader title="Activities & Account Tier" onBack={() => setView('main')} />

        <section className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-[var(--p2p-ink)]">Trading Volume &amp; Standing</h2>
            {account && (
              <span className="p2p-mono rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2.5 py-1 text-xs font-bold text-[#FF5A00]">
                Tier {account.tier}: {tierMeta.label} • Cap {formatOrderCap(account.orderCap)}
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['All Trades', `${metrics.allCompleted} (B:${metrics.buyCompleted} / S:${metrics.sellCompleted})`],
              ['Total Volume', account ? `${formatUsdcAmount(account.volume, 0)} USDC` : '0 USDC'],
              ['Counterparties', String(metrics.counterpartiesCount)],
              ['Per-Order Cap', account ? formatOrderCap(account.orderCap) : '200 USDC'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3">
                <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">{k}</span>
                <span className="p2p-mono mt-1 block text-sm font-bold text-[var(--p2p-ink)]">{v}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-4">
            {TIER_TABLE.map((t) => {
              const current = (account?.tier ?? 0) === t.tier
              return (
                <div
                  key={t.tier}
                  className={`rounded-xl border p-3 text-xs ${
                    current
                      ? 'border-[#FF5A00] bg-[var(--p2p-tint)]'
                      : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)]'
                  }`}
                >
                  <p className={`font-bold ${current ? 'text-[#FF5A00]' : 'text-[var(--p2p-ink)]'}`}>
                    Tier {t.tier} • {t.label}
                  </p>
                  <p className="p2p-mono mt-0.5 font-semibold text-[var(--p2p-ink)]">
                    {t.cap === null ? 'Uncapped' : `${formatUsdcAmount(t.cap, 0)} USDC`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--p2p-muted)]">{t.requirement}</p>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    )
  }

  // =========================================================================
  // SUB-VIEW 11: IDENTITY VERIFICATION (KYC)
  // =========================================================================
  if (view === 'kyc') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SubViewHeader title="Identity Verification (KYC)" onBack={() => setView('main')} />
        <KycPanel />
      </div>
    )
  }

  // =========================================================================
  // SUB-VIEW 12: P2P HELP CENTER
  // =========================================================================
  if (view === 'help') {
    const guides = [
      {
        title: '1. Non-Custodial Arc Smart Contract Escrow',
        body: 'Every P2P order locks USDC directly in the verified P2PEscrow contract on Arc Testnet. Neither OnPeer nor your counterparty can move escrowed USDC until the seller releases or an arbiter resolves a dispute.',
      },
      {
        title: '2. Strict Name-Match Protection (Anti-Triangulation)',
        body: 'Always verify inside your actual banking/mobile-money app (bKash, Nagad, UPI, Easypaisa) that the sender or receiver name matches your counterparty. Never transfer or release if a third-party name appears — OnPeer is not liable if you proceed despite a name mismatch.',
      },
      {
        title: '3. 30-Minute Cooling-Off & Dispute Resolution',
        body: 'After filing a dispute and before an arbiter takes the case, either party can peacefully settle within 30 minutes with zero dispute bond or penalty.',
      },
      {
        title: '4. Saved Payment Methods & Auto-Fill',
        body: 'Add your bKash, Nagad, Rocket, UPI, or bank accounts under Payment Method(s). Whenever you post a Sell Ad or sell USDC to a Buy Ad, selecting your saved method auto-fills your encrypted details.',
      },
    ]

    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SubViewHeader title="P2P Help Center" onBack={() => setView('main')} />
        <div className="space-y-3">
          {guides.map((g) => (
            <section
              key={g.title}
              className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 sm:p-5"
            >
              <h2 className="text-sm font-bold text-[var(--p2p-ink)]">{g.title}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--p2p-muted)]">{g.body}</p>
            </section>
          ))}
        </div>
      </div>
    )
  }

  // =========================================================================
  // SUB-VIEW 13: ADD P2P TO HOME SCREEN
  // =========================================================================
  if (view === 'homescreen') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SubViewHeader title="Add P2P To Home Screen" onBack={() => setView('main')} />

        <section className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-5 space-y-4">
          <p className="text-xs text-[var(--p2p-muted)]">
            Pin OnPeer P2P directly to your phone&apos;s home screen for one-tap app-like access to your orders, chat, and offers:
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-4 text-xs space-y-1.5">
              <p className="font-bold text-[var(--p2p-ink)]">Android (Chrome / Brave)</p>
              <p className="text-[var(--p2p-muted)]">
                1. Open <span className="p2p-mono text-[var(--p2p-ink)]">/p2p</span> in your browser.
              </p>
              <p className="text-[var(--p2p-muted)]">
                2. Tap the browser menu <strong>⋮</strong> → <strong>Add to Home screen</strong>.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-4 text-xs space-y-1.5">
              <p className="font-bold text-[var(--p2p-ink)]">iOS (Safari)</p>
              <p className="text-[var(--p2p-muted)]">
                1. Open <span className="p2p-mono text-[var(--p2p-ink)]">/p2p</span> in Safari.
              </p>
              <p className="text-[var(--p2p-muted)]">
                2. Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void copyP2pHomeLink()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white hover:opacity-90"
          >
            <Copy className="size-3.5" /> Copy Direct P2P Launch URL
          </button>
        </section>
      </div>
    )
  }

  // =========================================================================
  // SUB-VIEW 14: BECOME A MERCHANT (Margin Staking)
  // =========================================================================
  if (view === 'merchant') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SubViewHeader title="Become a Merchant" onBack={() => setView('main')} />

        {!account || !ESCROW_ADDRESS ? (
          <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-6 text-xs text-[var(--p2p-muted)]">
            Loading onchain Merchant Security Margin from Arc Testnet...
          </div>
        ) : (
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
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">
                    Total Margin
                  </span>
                  <span className="p2p-mono text-base font-bold text-[var(--p2p-ink)]">
                    {formatUsdcAmount(account.margin)} USDC
                  </span>
                </div>
                <div className="border-l border-[var(--p2p-border)] pl-4">
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">
                    Free Margin
                  </span>
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
                    <span className="p2p-mono text-[var(--p2p-muted)]">
                      Wallet: {formatUsdcAmount(balance)} USDC
                    </span>
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
        )}
      </div>
    )
  }

  // =========================================================================
  // MAIN USER CENTER / PROFILE VIEW (SS 7, 8, 11 — Mobile & PC)
  // =========================================================================
  const tradeMenuRows = [
    {
      id: 'feedback' as const,
      label: 'Received Feedback',
      icon: ThumbsUp,
      count: feedbackSummary?.totalFeedback ?? 0,
      showZero: true,
    },
    {
      id: 'alerts' as const,
      label: 'Custom Alerts',
      icon: Bell,
      count: alerts.length,
      showZero: false,
    },
    {
      id: 'payments' as const,
      label: 'Payment Method(s)',
      icon: CreditCard,
      count: savedMethods.length,
      showZero: true,
    },
    {
      id: 'follows' as const,
      label: 'Blocked Users',
      icon: Ban,
      count: blockedUsers.length,
      showZero: false,
    },
    {
      id: 'recent' as const,
      label: 'Recently Viewed',
      icon: Eye,
      count: recentList.length,
      showZero: false,
    },
    {
      id: 'adshare' as const,
      label: 'Ad Sharing Code',
      icon: QrCode,
      count: myLiveAds.length,
      showZero: false,
    },
  ]

  const othersMenuRows = [
    {
      id: 'activities' as const,
      label: 'Activities',
      icon: Activity,
      badgeText: account ? `Tier ${account.tier}` : undefined,
    },
    {
      id: 'kyc' as const,
      label: 'Identity Verification (KYC)',
      icon: UserCheck,
      badgeText: idVerified ? 'Verified' : undefined,
    },
    {
      id: 'help' as const,
      label: 'P2P Help Center',
      icon: BookOpen,
      badgeText: undefined,
    },
    {
      id: 'homescreen' as const,
      label: 'Add P2P To Home Screen',
      icon: Smartphone,
      badgeText: undefined,
    },
    {
      id: 'merchant' as const,
      label: 'Become a Merchant',
      icon: Store,
      badgeText: account?.merchant ? 'Active' : undefined,
    },
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Top Action Row: Back (mobile) + Share + Settings (SS 7, 8, 11) */}
      <div className="flex items-center justify-between gap-3">
        <div>
          {onBackToMarket && (
            <button
              type="button"
              onClick={onBackToMarket}
              aria-label="Back to P2P market"
              className="inline-flex size-9 items-center justify-center rounded-lg text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)] md:hidden"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('restrictions')}
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-3.5 text-xs font-semibold text-[var(--p2p-ink)] hover:border-[#FF5A00] md:inline-flex"
          >
            Restrictions Removal Center
          </button>

          <button
            type="button"
            onClick={() => void shareOwnProfile()}
            aria-label="Share profile"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-ink)] hover:border-[#FF5A00] md:h-9 md:w-auto md:gap-1.5 md:px-3.5 md:text-xs md:font-semibold"
          >
            <Share2 className="size-4" />
            <span className="hidden md:inline">Share</span>
          </button>

          <button
            type="button"
            onClick={() => setView('settings')}
            aria-label="Settings"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-ink)] hover:border-[#FF5A00] md:h-9 md:w-auto md:gap-1.5 md:px-3.5 md:text-xs md:font-semibold"
          >
            <Settings className="size-4" />
            <span className="hidden md:inline">Settings</span>
          </button>
        </div>
      </div>

      {/* Urgent Unpaid Dispute Bond Card (if any) */}
      {renderDebtRepayCard()}

      {/* Profile Identity Header (SS 7) */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full border border-[var(--p2p-border)] bg-[var(--p2p-tint)] text-xl font-extrabold text-[#FF5A00]">
            {initial}
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-extrabold text-[var(--p2p-ink)]">{displayName}</h1>
              <button
                type="button"
                onClick={() => {
                  setReturnToSettings(false)
                  setView('notifications')
                }}
                title="Edit Display Alias"
                className="inline-flex size-7 items-center justify-center rounded-lg text-[var(--p2p-muted)] hover:bg-[var(--p2p-input-bg)] hover:text-[var(--p2p-ink)]"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>

            <p className="text-xs text-[var(--p2p-muted)]">
              {account?.merchant
                ? 'Verified Merchant'
                : idVerified || emailVerified
                  ? 'Verified user'
                  : 'P2P Trader'}{' '}
              • <span className="p2p-mono">{shortAddr(address)}</span>
            </p>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-[var(--p2p-muted)]">
              {(idVerified || emailVerified) && (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                  <Check className="size-3.5" /> Verified
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setFollowsTab('following')
                  setView('follows')
                }}
                className="hover:text-[var(--p2p-ink)]"
              >
                <strong className="text-[var(--p2p-ink)]">
                  {feedbackSummary?.followingCount ?? following.length}
                </strong>{' '}
                Following
              </button>
              <span>
                <strong className="text-[var(--p2p-ink)]">{feedbackSummary?.followersCount ?? 0}</strong>{' '}
                Followers
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 4-Metric Card + Expandable More (SS 7 & 8) */}
      <section className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-5">
        <div className="grid grid-cols-2 gap-y-5 gap-x-4 sm:grid-cols-4">
          <div>
            <p className="p2p-mono text-2xl font-extrabold text-[var(--p2p-ink)]">{metrics.trades30d}</p>
            <span className="mt-0.5 block text-xs text-[var(--p2p-muted)]">30d Trades</span>
          </div>
          <div>
            <p className="p2p-mono text-2xl font-extrabold text-[var(--p2p-ink)]">{metrics.completion30dPct}</p>
            <span className="mt-0.5 block text-xs text-[var(--p2p-muted)]">30d Completion Rate</span>
          </div>
          <div>
            <p className="p2p-mono text-2xl font-extrabold text-[var(--p2p-ink)]">{metrics.avgReleaseMin} m</p>
            <span className="mt-0.5 block text-xs text-[var(--p2p-muted)]">Avg. Release Time</span>
          </div>
          <div>
            <p className="p2p-mono text-2xl font-extrabold text-[var(--p2p-ink)]">{metrics.avgPayMin} m</p>
            <span className="mt-0.5 block text-xs text-[var(--p2p-muted)]">Avg. Pay Time</span>
          </div>
        </div>

        {statsExpanded && account && (
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--p2p-border)] pt-4 sm:grid-cols-4">
            <div>
              <span className="block text-[11px] text-[var(--p2p-muted)]">All Trades</span>
              <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">{metrics.allCompleted}</span>
            </div>
            <div>
              <span className="block text-[11px] text-[var(--p2p-muted)]">Volume</span>
              <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">
                {formatUsdcAmount(account.volume, 0)} USDC
              </span>
            </div>
            <div>
              <span className="block text-[11px] text-[var(--p2p-muted)]">Per-Order Cap</span>
              <span className="p2p-mono text-sm font-bold text-[#FF5A00]">
                {formatOrderCap(account.orderCap)}
              </span>
            </div>
            <div>
              <span className="block text-[11px] text-[var(--p2p-muted)]">Disputes / Concessions</span>
              <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">
                {account.disputesLost} / {account.concessions}
              </span>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-center border-t border-[var(--p2p-border)]/60 pt-3">
          <button
            type="button"
            onClick={() => setStatsExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]"
          >
            <span>{statsExpanded ? 'Less' : 'More'}</span>
            <ChevronDown className={`size-3.5 transition-transform ${statsExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </section>

      {/* Become a Merchant Callout Card (SS 7 & 8) */}
      {account?.merchant ? (
        <section className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-5 shrink-0 text-[#FF5A00]" />
            <div className="text-xs">
              <p className="font-bold text-[var(--p2p-ink)]">Verified Merchant Active</p>
              <p className="p2p-mono text-[var(--p2p-muted)]">
                Staked Margin: {formatUsdcAmount(account.margin)} USDC • Free: {formatUsdcAmount(account.effectiveMargin)} USDC
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setView('merchant')}
            className="shrink-0 rounded-lg bg-[#FF5A00] px-3 py-1.5 text-xs font-bold text-white"
          >
            Manage
          </button>
        </section>
      ) : (
        !merchantBannerHidden && (
          <section className="relative rounded-2xl border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-4 py-4 pr-10">
            <button
              type="button"
              onClick={() => setMerchantBannerHidden(true)}
              aria-label="Dismiss merchant banner"
              className="absolute right-3 top-3 rounded-lg p-1 text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]"
            >
              <X className="size-4" />
            </button>
            <div className="flex items-start gap-2.5">
              <Store className="mt-0.5 size-4 shrink-0 text-[#FF5A00]" />
              <div className="space-y-1 text-xs">
                <p className="font-bold text-[var(--p2p-ink)]">Become a Merchant</p>
                <p className="text-[var(--p2p-muted)]">
                  Unlock Buy Ads immediately, higher order caps, and verified buyer trust.
                </p>
                <button
                  type="button"
                  onClick={() => setView('merchant')}
                  className="pt-0.5 font-bold text-[#FF5A00] hover:underline"
                >
                  View more
                </button>
              </div>
            </div>
          </section>
        )
      )}

      {/* Sub-Tabs: Trade | Others (SS 7, 8, 11) */}
      <div>
        <div className="flex items-center gap-6 border-b border-[var(--p2p-border)] px-1">
          {[
            { id: 'trade' as const, label: 'Trade' },
            { id: 'others' as const, label: 'Others' },
          ].map((t) => {
            const active = mainTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setMainTab(t.id)}
                className={`relative pb-2.5 text-sm font-bold transition-colors ${
                  active ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                }`}
              >
                {t.label}
                {active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#FF5A00]" />}
              </button>
            )
          })}
        </div>

        {mainTab === 'trade' ? (
          <ul className="mt-2 divide-y divide-[var(--p2p-border)] overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
            {tradeMenuRows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setView(row.id)}
                  className="flex w-full items-center justify-between px-4 py-4 text-left transition-colors hover:bg-[var(--p2p-row-hover)] sm:px-5"
                >
                  <span className="flex items-center gap-3 text-sm font-semibold text-[var(--p2p-ink)]">
                    <row.icon className="size-4 text-[var(--p2p-muted)]" />
                    {row.label}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-[var(--p2p-muted)]">
                    {(row.showZero || row.count > 0) && (
                      <span className="p2p-mono font-semibold text-[var(--p2p-muted)]">{row.count}</span>
                    )}
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
                  className="flex w-full items-center justify-between px-4 py-4 text-left transition-colors hover:bg-[var(--p2p-row-hover)] sm:px-5"
                >
                  <span className="flex items-center gap-3 text-sm font-semibold text-[var(--p2p-ink)]">
                    <row.icon className="size-4 text-[var(--p2p-muted)]" />
                    {row.label}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-[var(--p2p-muted)]">
                    {row.badgeText && (
                      <span className="rounded bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
                        {row.badgeText}
                      </span>
                    )}
                    <ChevronRight className="size-4" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
