import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount, usePublicClient } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import {
  AlertTriangle,
  ArrowUpDown,
  Clock,
  ExternalLink,
  Hourglass,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import {
  CHAIN_ID,
  DETAILS_MAX_BYTES,
  DETAILS_MODE,
  ESCROW_ADDRESS,
  MAX_OPEN_ORDERS,
  SIDE_SELL,
  TIER0_CAP,
  TIER_TABLE,
  ZERO_BYTES32,
  computeBond,
  countryByCurrency,
  fiatFor,
  formatDuration,
  formatFiat,
  formatOrderCap,
  formatPrice,
  formatUsdcAmount,
  hexToCurrency,
  isAdExpired,
  isUncapped,
  maskToMethods,
  shortAddr,
  usdcFor,
} from '@/lib/p2p'
import { formatUnitsFixed, parseUnitsExact } from '@/onchain-money'
import {
  useNow,
  useOpenOrderCount,
  useUsdcAllowance,
  useUsdcBalance,
  useVerification,
  type Account,
  type AdWithId,
} from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { useEligibility } from '@/hooks/useEligibility'
import { Sheet } from '@/components/ui'
import { MethodLogo } from '@/components/logos'
import { toast } from 'sonner'
import { BackendApiError } from '@/lib/api'
import { formatSavedMethodLine, useSavedPaymentMethods, type SavedPaymentMethod } from '@/hooks/useAccount'
import { useVaultActions } from '@/hooks/useVault'

const safeParse = (v: string, d: number): bigint => {
  try {
    return v ? parseUnitsExact(v, d) : 0n
  } catch {
    return 0n
  }
}

function useOrderFormState(ad: AdWithId, initialUsdc?: string) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { run, approveUsdc, writeContractAsync, pendingKey, busy } = useTx()
  const balance = useUsdcBalance()
  const allowance = useUsdcAllowance()
  const openCount = useOpenOrderCount()
  const now = useNow()
  const { blocked, account, kycRequired } = useEligibility()
  const makerKyc = useVerification(ad.maker)
  const { sealDetails } = useVaultActions()
  const { methods: savedMethods } = useSavedPaymentMethods()

  const currency = hexToCurrency(ad.currency)
  const country = countryByCurrency(currency)
  const userBuys = ad.side === SIDE_SELL
  const isSealedBuyAd = !userBuys && ad.detailsMode !== DETAILS_MODE.PLAIN

  const matchingSaved = useMemo(
    () => savedMethods.filter((m) => (ad.paymentMask & (1 << m.methodBit)) !== 0),
    [savedMethods, ad.paymentMask],
  )

  const validInitial = initialUsdc && /^\d+(\.\d{1,6})?$/.test(initialUsdc) ? initialUsdc : ''
  const [fiat, setFiat] = useState('')
  const [usdc, setUsdc] = useState(validInitial)
  const [edited, setEdited] = useState<'fiat' | 'usdc'>(validInitial ? 'usdc' : 'fiat')
  const [selectedSavedId, setSelectedSavedId] = useState<string | 'manual' | null>(null)
  const [manualHolderName, setManualHolderName] = useState('')
  const [manualDetails, setManualDetails] = useState('')
  const [sealing, setSealing] = useState(false)

  const activeSaved: SavedPaymentMethod | null = useMemo(() => {
    if (userBuys || selectedSavedId === 'manual') return null
    if (selectedSavedId !== null) {
      return matchingSaved.find((m) => m.id === selectedSavedId) ?? null
    }
    return matchingSaved[0] ?? null
  }, [userBuys, selectedSavedId, matchingSaved])

  const holderName = activeSaved ? activeSaved.holderName : manualHolderName
  const details = activeSaved
    ? formatSavedMethodLine(activeSaved, !isSealedBuyAd).slice(0, isSealedBuyAd ? 400 : DETAILS_MAX_BYTES)
    : manualDetails

  const setHolderName = (v: string) => {
    if (activeSaved) {
      setManualDetails(details)
      setSelectedSavedId('manual')
    }
    setManualHolderName(v)
  }

  const setDetails = (v: string) => {
    if (activeSaved) {
      setManualHolderName(holderName)
      setSelectedSavedId('manual')
    }
    setManualDetails(v)
  }

  const selectSavedMethod = (item: SavedPaymentMethod) => {
    setSelectedSavedId(item.id)
  }

  const usdcRaw = useMemo(
    () => (edited === 'fiat' ? usdcFor(safeParse(fiat, 6), ad.priceE6) : safeParse(usdc, 6)),
    [edited, fiat, usdc, ad.priceE6],
  )
  const fiatRaw = useMemo(
    () => (edited === 'fiat' ? safeParse(fiat, 6) : fiatFor(safeParse(usdc, 6), ad.priceE6)),
    [edited, fiat, usdc, ad.priceE6],
  )

  const shownFiat = edited === 'fiat' ? fiat : fiatRaw > 0n ? formatUnitsFixed(fiatRaw, 6, 2) : ''
  const shownUsdc = edited === 'usdc' ? usdc : usdcRaw > 0n ? formatUnitsFixed(usdcRaw, 6, 4) : ''

  const detailBytes = new TextEncoder().encode(details).length
  const isRemainder = usdcRaw === ad.available
  const userCap = account ? account.orderCap : TIER0_CAP
  const tierInfo = TIER_TABLE[account ? account.tier : 0] ?? TIER_TABLE[0]
  const expiredAd = isAdExpired(ad.expiresAt, now)

  const adHigh = ad.maxAmount > ad.available ? ad.available : ad.maxAmount
  const effectiveHigh = !isUncapped(userCap) && userCap < adHigh ? userCap : adHigh
  const adLow = ad.minAmount > ad.available ? ad.available : ad.minAmount

  const setMaxAmount = (targetTab?: 'fiat' | 'usdc') => {
    let maxAllowed = effectiveHigh
    if (!userBuys && balance !== undefined && balance < maxAllowed) {
      maxAllowed = balance
    }
    if (targetTab === 'fiat') {
      setEdited('fiat')
      const maxFiat = fiatFor(maxAllowed, ad.priceE6)
      setFiat(maxFiat > 0n ? formatUnitsFixed(maxFiat, 6, 2) : '')
    } else {
      setEdited('usdc')
      setUsdc(maxAllowed > 0n ? formatUnitsFixed(maxAllowed, 6, 6).replace(/\.?0+$/, '') : '')
    }
  }

  let problem: string | null = null
  if (expiredAd) problem = 'This ad has expired and can no longer accept new orders.'
  else if (kycRequired && !makerKyc.verified)
    problem = 'This advertiser does not currently hold active KYC verification.'
  else if (usdcRaw === 0n) problem = null
  else if (usdcRaw > ad.available) problem = `Only ${formatUsdcAmount(ad.available)} USDC is available.`
  else if (usdcRaw > ad.maxAmount) problem = `Maximum order is ${formatUsdcAmount(ad.maxAmount)} USDC.`
  else if (usdcRaw < ad.minAmount && !isRemainder) problem = `Minimum order is ${formatUsdcAmount(ad.minAmount)} USDC.`
  else if (!isUncapped(userCap) && usdcRaw > userCap)
    problem = `Your ${tierInfo.label} tier (Tier ${tierInfo.tier}) caps orders at ${formatOrderCap(userCap)}.`
  else if (!userBuys && balance !== undefined && usdcRaw > balance)
    problem = `Insufficient balance (${formatUsdcAmount(balance)} USDC available).`
  else if (!userBuys && !isSealedBuyAd && detailBytes > DETAILS_MAX_BYTES)
    problem = 'Receiving details exceed 200 bytes.'
  else if (isSealedBuyAd && details.trim().length > 400)
    problem = 'Encrypted receiving details exceed 400 characters.'
  else if (openCount >= MAX_OPEN_ORDERS)
    problem = `You already have ${MAX_OPEN_ORDERS} open orders. Complete or cancel one first.`
  else if (account && account.ordersCompleted < ad.minTakerCompleted)
    problem = `Advertiser requires ${ad.minTakerCompleted}+ completed trades (you have ${account.ordersCompleted}).`
  if (!problem && blocked) problem = blocked

  const sellerInputsReady = isSealedBuyAd
    ? holderName.trim().length >= 2 && details.trim().length >= 2 && details.trim().length <= 400
    : details.trim().length > 0 && detailBytes <= DETAILS_MAX_BYTES

  const ready = usdcRaw > 0n && !problem && (userBuys || sellerInputsReady)

  const submit = async (onOpened: (orderId: bigint) => void) => {
    const escrow = ESCROW_ADDRESS
    if (!ready || !escrow || !address) return
    if (!userBuys && (allowance ?? 0n) < usdcRaw) {
      const ok = await approveUsdc(usdcRaw)
      if (!ok) return
    }

    let detailsHashArg: `0x${string}` = ZERO_BYTES32
    let plainDetailsArg = userBuys ? '' : details.trim()

    if (isSealedBuyAd) {
      setSealing(true)
      try {
        const sealed = await sealDetails({
          kind: 'order_details',
          holderName: holderName.trim(),
          accountDetails: details.trim(),
        })
        detailsHashArg = sealed.contentHash
        plainDetailsArg = ''
      } catch (err) {
        toast.error(err instanceof BackendApiError ? err.message : 'Wallet sign-in or vault encryption was cancelled.')
        setSealing(false)
        return
      }
      setSealing(false)
    }

    const ok = await run('open', 'Open order', () =>
      writeContractAsync({
        address: escrow,
        abi: p2pEscrowAbi,
        functionName: 'openOrder',
        args: [ad.id, usdcRaw, ad.priceE6, detailsHashArg, plainDetailsArg],
        chainId: CHAIN_ID,
      }),
    )
    if (!ok || !publicClient) return
    const ids = await publicClient.readContract({
      address: escrow,
      abi: p2pEscrowAbi,
      functionName: 'getUserOrderIds',
      args: [address],
    })
    const last = ids[ids.length - 1]
    if (last !== undefined) onOpened(last)
  }

  return {
    isConnected,
    balance,
    now,
    account,
    makerKyc,
    currency,
    country,
    userBuys,
    isSealedBuyAd,
    edited,
    setEdited,
    setFiat,
    setUsdc,
    holderName,
    setHolderName,
    details,
    setDetails,
    matchingSaved,
    activeSaved,
    selectSavedMethod,
    detailBytes,
    usdcRaw,
    fiatRaw,
    shownFiat,
    shownUsdc,
    adLow,
    effectiveHigh,
    setMaxAmount,
    problem,
    ready,
    submit,
    pendingKey,
    busy: busy || sealing,
    sealing,
  }
}

function UnverifiedAdvertiserCard({
  maker,
  onAccept,
  onCancel,
}: {
  maker: string
  onAccept: () => void
  onCancel: () => void
}) {
  const [checked, setChecked] = useState(false)

  return (
    <motion.div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unverified-kyc-title"
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 8 }}
      transition={{ duration: 0.18 }}
      onClick={(e) => e.stopPropagation()}
      className="w-full max-w-[460px] space-y-4 rounded-2xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-surface-solid)] p-6 text-[var(--p2p-ink)] shadow-2xl"
    >
      {/* Header Row — aligned flush left & right */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] text-[var(--p2p-warn-ink)]">
            <AlertTriangle className="size-5" />
          </div>
          <div>
            <h3 id="unverified-kyc-title" className="text-base font-bold leading-snug text-[var(--p2p-warn-ink)]">
              Advertiser Is Not KYC Verified
            </h3>
            <p className="p2p-mono mt-0.5 text-xs text-[var(--p2p-muted)]">
              Counterparty <span className="font-semibold text-[var(--p2p-ink)]">{shortAddr(maker)}</span> • Unverified
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] transition-colors hover:text-[var(--p2p-ink)]"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Description — aligned flush left & right */}
      <p className="text-xs leading-relaxed text-[var(--p2p-muted)]">
        This advertiser has <strong className="text-[var(--p2p-ink)]">not</strong> completed KYC identity verification.
        Please review and acknowledge the risk notice below before opening an order with them.
      </p>

      {/* Liability Warning Box — exact same width & alignment */}
      <div
        className="rounded-xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] px-4 py-3 text-xs font-semibold leading-relaxed text-[var(--p2p-warn-ink)]"
        style={{ borderLeftWidth: '3px' }}
      >
        If you encounter a scam or lose funds when trading with an unverified counterparty, OnPeer is not responsible
        or liable.
      </div>

      {/* Consent Checkbox Card — exact same width & alignment */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3.5 text-xs font-medium leading-relaxed text-[var(--p2p-ink)] transition-colors hover:border-[var(--p2p-border-active)]">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[#FF5A00]"
        />
        <span>
          I understand this advertiser is not KYC verified, and I accept full responsibility. OnPeer is not liable if I
          lose funds or get scammed.
        </span>
      </label>

      {/* Balanced 2-Column Action Row — exact same width & alignment */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-bold text-[var(--p2p-ink)] transition-colors hover:border-[var(--p2p-border-active)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!checked}
          onClick={onAccept}
          className={`h-11 rounded-xl px-4 text-xs font-bold transition-colors ${
            checked
              ? 'bg-[#FF5A00] text-[#FFFFFF] shadow-sm hover:opacity-90'
              : 'cursor-not-allowed border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
          }`}
        >
          I Understand, Continue
        </button>
      </div>
    </motion.div>
  )
}

export function InlineOrderDrawer({
  ad,
  makerAccount,
  initialUsdc,
  onCancel,
  onOpened,
}: {
  ad: AdWithId
  makerAccount?: Account
  initialUsdc?: string
  onCancel: () => void
  onOpened: (orderId: bigint) => void
}) {
  const s = useOrderFormState(ad, initialUsdc)

  const ttlLeft = Math.max(0, Number(ad.expiresAt) - s.now)
  const ttlText = ttlLeft >= 3600 ? `${Math.ceil(ttlLeft / 3600)}h left` : formatDuration(ttlLeft)
  const methods = maskToMethods(ad.paymentMask)
  const completionPct =
    makerAccount && makerAccount.ordersCreated > 0
      ? ((makerAccount.ordersCompleted / makerAccount.ordersCreated) * 100).toFixed(2)
      : null
  const previewBond = computeBond(s.usdcRaw > 0n ? s.usdcRaw : s.adLow)

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Left Side */}
        <div className="flex flex-col justify-between space-y-4 border-b border-[var(--p2p-border)] pb-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">{shortAddr(ad.maker)}</span>
                {s.makerKyc.verified ? (
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-ok-border)] bg-[var(--p2p-ok-bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--p2p-ok-ink)]">
                    <ShieldCheck className="size-3" /> KYC Verified
                  </span>
                ) : !s.makerKyc.isLoading ? (
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--p2p-warn-ink)]">
                    <AlertTriangle className="size-3" /> Not KYC Verified
                  </span>
                ) : null}
                {ad.merchantAd && (
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
                    <ShieldCheck className="size-3" /> Verified Merchant
                  </span>
                )}
              </div>
              <span className="p2p-mono text-xs text-[var(--p2p-muted)]">
                {makerAccount ? `${makerAccount.ordersCompleted} orders` : '...'}{' '}
                {completionPct !== null && `• ${completionPct}%`}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3 text-xs">
              <div>
                <span className="block text-[var(--p2p-muted)]">Payment Time Limit</span>
                <span className="p2p-mono mt-0.5 inline-flex items-center gap-1 font-semibold text-[var(--p2p-ink)]">
                  <Clock className="size-3.5 text-[#FF5A00]" /> {ad.windowMinutes} Mins
                </span>
              </div>
              <div>
                <span className="block text-[var(--p2p-muted)]">Ad Expiry Countdown</span>
                <span className="p2p-mono mt-0.5 inline-flex items-center gap-1 font-semibold text-[var(--p2p-ink)]">
                  <Hourglass className="size-3.5 text-[#FF5A00]" /> {ttlText}
                </span>
              </div>
              <div>
                <span className="block text-[var(--p2p-muted)]">Available Escrow</span>
                <span className="p2p-mono mt-0.5 font-semibold text-[var(--p2p-ink)]">
                  {formatUsdcAmount(ad.available)} USDC
                </span>
              </div>
              <div>
                <span className="block text-[var(--p2p-muted)]">Asymmetric Dispute Bond</span>
                <span className="p2p-mono mt-0.5 font-semibold text-[#FF5A00]">
                  {formatUsdcAmount(previewBond)} USDC (loser pays)
                </span>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Accepted Payment Methods
              </p>
              <div className="flex flex-wrap gap-1.5">
                {methods.map((m) => (
                  <span
                    key={m.bit}
                    className="inline-flex items-center rounded bg-[var(--p2p-input-bg)] py-1 pl-2.5 pr-2.5 text-xs font-medium text-[var(--p2p-ink)] ring-1 ring-inset ring-[var(--p2p-border)]"
                    style={{ borderLeft: '3px solid #FF5A00' }}
                  >
                    {m.name}
                  </span>
                ))}
              </div>
            </div>

            {ad.details && (
              <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                  {s.userBuys ? 'Payment Terms / Receiving Info' : 'Advertiser Terms'}
                </p>
                <p className="p2p-mono mt-1 whitespace-pre-wrap break-words text-xs text-[var(--p2p-ink)]">
                  {ad.details}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-[var(--p2p-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3.5 text-[#FF5A00]" />
              {s.userBuys ? 'Seller USDC locked in smart contract' : 'Your USDC locks in escrow on open'}
            </span>
            {ESCROW_ADDRESS && (
              <a
                href={buildAddressExplorerUrl(CHAIN_ID, ESCROW_ADDRESS)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-[#FF5A00] hover:underline"
              >
                Verify Escrow <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>

        {/* Right Side */}
        <div className="space-y-3.5">
          {s.userBuys ? (
            <>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--p2p-muted)]">I want to pay</span>
                  <span className="p2p-mono text-[var(--p2p-muted)]">
                    Limit: {s.country?.symbol}
                    {formatFiat(fiatFor(s.adLow, ad.priceE6), 0)} - {s.country?.symbol}
                    {formatFiat(fiatFor(s.effectiveHigh, ad.priceE6), 0)}
                  </span>
                </div>
                <div className="p2p-input flex items-center rounded-lg px-3 py-2.5">
                  <input
                    inputMode="decimal"
                    value={s.shownFiat}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '')
                      if (/^\d*\.?\d{0,2}$/.test(v)) {
                        s.setEdited('fiat')
                        s.setFiat(v)
                      }
                    }}
                    placeholder="0.00"
                    className="p2p-mono w-full bg-transparent text-lg font-bold text-[var(--p2p-ink)] outline-none placeholder:text-[var(--p2p-muted)]"
                  />
                  <button
                    type="button"
                    onClick={() => s.setMaxAmount('usdc')}
                    className="mr-2.5 text-xs font-bold text-[#FF5A00] hover:opacity-80"
                  >
                    Max
                  </button>
                  <span className="border-l border-[var(--p2p-border)] pl-2.5 text-xs font-bold text-[var(--p2p-ink)]">
                    {s.currency}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-center">
                <span className="rounded-full border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-1 text-[var(--p2p-muted)]">
                  <ArrowUpDown className="size-3.5" />
                </span>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--p2p-muted)]">I will receive</span>
                  {s.account && (
                    <span className="p2p-mono text-[var(--p2p-muted)]">
                      Tier {s.account.tier} cap: {formatOrderCap(s.account.orderCap)}
                    </span>
                  )}
                </div>
                <div className="p2p-input flex items-center rounded-lg px-3 py-2.5">
                  <input
                    inputMode="decimal"
                    value={s.shownUsdc}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '')
                      if (/^\d*\.?\d{0,6}$/.test(v)) {
                        s.setEdited('usdc')
                        s.setUsdc(v)
                      }
                    }}
                    placeholder="0.00"
                    className="p2p-mono w-full bg-transparent text-lg font-bold text-[var(--p2p-ink)] outline-none placeholder:text-[var(--p2p-muted)]"
                  />
                  <span className="inline-flex items-center gap-1.5 border-l border-[var(--p2p-border)] pl-2.5 text-xs font-bold text-[var(--p2p-ink)]">
                    <TokenUSDC variant="branded" size={14} /> USDC
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--p2p-muted)]">I want to sell</span>
                  <span className="p2p-mono text-[var(--p2p-muted)]">
                    {s.balance !== undefined
                      ? `Wallet: ${formatUsdcAmount(s.balance)} USDC`
                      : `Max: ${formatUsdcAmount(s.effectiveHigh)} USDC`}
                  </span>
                </div>
                <div className="p2p-input flex items-center rounded-lg px-3 py-2.5">
                  <input
                    inputMode="decimal"
                    value={s.shownUsdc}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '')
                      if (/^\d*\.?\d{0,6}$/.test(v)) {
                        s.setEdited('usdc')
                        s.setUsdc(v)
                      }
                    }}
                    placeholder="0.00"
                    className="p2p-mono w-full bg-transparent text-lg font-bold text-[var(--p2p-ink)] outline-none placeholder:text-[var(--p2p-muted)]"
                  />
                  <button
                    type="button"
                    onClick={() => s.setMaxAmount('usdc')}
                    className="mr-2.5 text-xs font-bold text-[#FF5A00] hover:opacity-80"
                  >
                    Max
                  </button>
                  <span className="inline-flex items-center gap-1.5 border-l border-[var(--p2p-border)] pl-2.5 text-xs font-bold text-[var(--p2p-ink)]">
                    <TokenUSDC variant="branded" size={14} /> USDC
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-center">
                <span className="rounded-full border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-1 text-[var(--p2p-muted)]">
                  <ArrowUpDown className="size-3.5" />
                </span>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--p2p-muted)]">I will receive</span>
                  <span className="p2p-mono text-[var(--p2p-muted)]">
                    Limit: {s.country?.symbol}
                    {formatFiat(fiatFor(s.adLow, ad.priceE6), 0)} - {s.country?.symbol}
                    {formatFiat(fiatFor(s.effectiveHigh, ad.priceE6), 0)}
                  </span>
                </div>
                <div className="p2p-input flex items-center rounded-lg px-3 py-2.5">
                  <input
                    inputMode="decimal"
                    value={s.shownFiat}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '')
                      if (/^\d*\.?\d{0,2}$/.test(v)) {
                        s.setEdited('fiat')
                        s.setFiat(v)
                      }
                    }}
                    placeholder="0.00"
                    className="p2p-mono w-full bg-transparent text-lg font-bold text-[var(--p2p-ink)] outline-none placeholder:text-[var(--p2p-muted)]"
                  />
                  <span className="border-l border-[var(--p2p-border)] pl-2.5 text-xs font-bold text-[var(--p2p-ink)]">
                    {s.currency}
                  </span>
                </div>
              </div>

              <div className="space-y-2.5">
                {s.matchingSaved.length > 0 && (
                  <div className="rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-[#FF5A00]">Saved Payment Methods (Auto-Fill)</span>
                      <span className="text-[var(--p2p-muted)]">Select account</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.matchingSaved.map((sm) => {
                        const selected = s.activeSaved?.id === sm.id
                        return (
                          <button
                            key={sm.id}
                            type="button"
                            onClick={() => s.selectSavedMethod(sm)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                              selected
                                ? 'border-[#FF5A00] bg-[#FF5A00] text-white'
                                : 'border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-ink)] hover:border-[#FF5A00]'
                            }`}
                          >
                            <MethodLogo name={sm.methodName} size={13} />
                            <span>{sm.methodName}</span>
                            <span className="p2p-mono text-[11px] opacity-90">••{sm.accountNumber.slice(-4)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {s.isSealedBuyAd && (
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1 font-medium text-[#FF5A00]">
                        <Lock className="size-3" /> Account Holder Name (Encrypted Vault)
                      </span>
                    </div>
                    <input
                      value={s.holderName}
                      onChange={(e) => s.setHolderName(e.target.value.slice(0, 80))}
                      placeholder="Full name on your bank / mobile wallet"
                      className="p2p-input h-10 w-full rounded-lg px-3 text-xs font-medium"
                    />
                  </div>
                )}
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--p2p-muted)]">
                      {s.isSealedBuyAd ? 'Receiving Account (Encrypted Offchain)' : 'Your Receiving Payment Details'}
                    </span>
                    <span className="p2p-mono text-[var(--p2p-muted)]">
                      {s.isSealedBuyAd ? `${s.details.length}/400` : `${s.detailBytes}/${DETAILS_MAX_BYTES}B`}
                    </span>
                  </div>
                  <textarea
                    value={s.details}
                    onChange={(e) => s.setDetails(e.target.value)}
                    rows={2}
                    placeholder="e.g. bKash Personal 01XXXXXXXXX (Account Name) or name@upi"
                    className="p2p-input p2p-mono w-full resize-none rounded-lg px-3 py-2 text-xs"
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 py-2 text-xs">
            <span className="text-[var(--p2p-muted)]">Price Slippage Guard</span>
            <span className="p2p-mono font-semibold text-[var(--p2p-ink)]">
              Fixed at {formatPrice(ad.priceE6)} {s.currency} — <span className="text-[#FF5A00]">0 Trade Fee</span>
            </span>
          </div>

          {s.problem && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-3 py-2 text-xs text-[#FF5A00]">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{s.problem}</span>
            </div>
          )}

          <div className="grid grid-cols-[1fr_2fr] gap-2.5 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-sm font-semibold text-[var(--p2p-ink)] transition-colors hover:border-[var(--p2p-border-active)]"
            >
              Cancel
            </button>

            {s.isConnected ? (
              <button
                type="button"
                disabled={!s.ready || s.busy}
                onClick={() => void s.submit(onOpened)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-sm font-bold text-[#FFFFFF] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {s.busy && <Loader2 className="size-4 animate-spin" />}
                {s.pendingKey === 'approve'
                  ? 'Approve USDC...'
                  : s.busy
                    ? 'Confirming...'
                    : s.userBuys
                      ? 'Buy USDC'
                      : 'Sell USDC'}
              </button>
            ) : (
              <ConnectKitButton.Custom>
                {({ show }) => (
                  <button
                    type="button"
                    onClick={show}
                    className="min-h-11 rounded-lg bg-[#FF5A00] px-5 text-sm font-bold text-[#FFFFFF] transition-opacity hover:opacity-90"
                  >
                    Connect Wallet
                  </button>
                )}
              </ConnectKitButton.Custom>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function TradePopupStage({
  ad,
  makerAccount,
  initialUsdc,
  onClose,
  onOpened,
}: {
  ad: AdWithId
  makerAccount?: Account
  initialUsdc?: string
  onClose: () => void
  onOpened: (orderId: bigint) => void
}) {
  const makerKyc = useVerification(ad.maker)
  const [unverifiedAccepted, setUnverifiedAccepted] = useState(false)
  const userBuys = ad.side === SIDE_SELL
  const currency = hexToCurrency(ad.currency)

  if (makerKyc.isLoading) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-2.5 rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] px-5 py-3.5 text-xs font-semibold text-[var(--p2p-ink)] shadow-2xl"
      >
        <Loader2 className="size-4 animate-spin text-[#FF5A00]" />
        Checking advertiser verification...
      </div>
    )
  }

  // Step 1: If advertiser is NOT KYC verified, ONLY show the risk consent modal first!
  if (!makerKyc.verified && !unverifiedAccepted) {
    return (
      <UnverifiedAdvertiserCard
        maker={ad.maker}
        onAccept={() => setUnverifiedAccepted(true)}
        onCancel={onClose}
      />
    )
  }

  // Step 2: Centered Order Form Popup Modal
  return (
    <motion.section
      role="dialog"
      aria-modal="true"
      aria-label={userBuys ? 'Buy USDC' : 'Sell USDC'}
      initial={{ opacity: 0, scale: 0.97, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 10 }}
      transition={{ duration: 0.2 }}
      onClick={(e) => e.stopPropagation()}
      className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--p2p-border-active)] bg-[var(--p2p-surface-solid)] text-[var(--p2p-ink)] shadow-2xl"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <TokenUSDC variant="branded" size={22} />
          <div>
            <h3 className="text-base font-bold text-[var(--p2p-ink)]">
              {userBuys ? 'Buy USDC' : 'Sell USDC'} with {currency}
            </h3>
            <p className="p2p-mono text-[11px] text-[var(--p2p-muted)]">
              Rate {formatPrice(ad.priceE6)} {currency}/USDC • Escrow Protected
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-8 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)] transition-colors hover:text-[var(--p2p-ink)]"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="overflow-y-auto p-5 sm:p-6">
        <InlineOrderDrawer
          ad={ad}
          makerAccount={makerAccount}
          initialUsdc={initialUsdc}
          onCancel={onClose}
          onOpened={onOpened}
        />
      </div>
    </motion.section>
  )
}

/** Unified Centered Popup Modal with soft backdrop blur (Step 1 KYC Consent if unverified -> Step 2 Order Form) */
export function TradePopupModal({
  ad,
  makerAccount,
  initialUsdc,
  onClose,
  onOpened,
}: {
  ad: AdWithId | null
  makerAccount?: Account
  initialUsdc?: string
  onClose: () => void
  onOpened: (orderId: bigint) => void
}) {
  useEffect(() => {
    if (!ad) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [ad, onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {ad && (
        <motion.div
          className="p2p-terminal fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <TradePopupStage
            key={ad.id.toString()}
            ad={ad}
            makerAccount={makerAccount}
            initialUsdc={initialUsdc}
            onClose={onClose}
            onOpened={onOpened}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function TradeSheet({
  ad,
  onClose,
  onOpened,
  initialUsdc,
}: {
  ad: AdWithId | null
  initialUsdc?: string
  onClose: () => void
  onOpened: (orderId: bigint) => void
}) {
  return (
    <Sheet open={!!ad} onClose={onClose} title={ad ? (ad.side === SIDE_SELL ? 'Buy USDC' : 'Sell USDC') : ''}>
      {ad && (
        <div className="p2p-terminal rounded-xl">
          <InlineOrderDrawer
            key={ad.id.toString()}
            ad={ad}
            initialUsdc={initialUsdc}
            onCancel={onClose}
            onOpened={onOpened}
          />
        </div>
      )}
    </Sheet>
  )
}
