import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount, usePublicClient } from 'wagmi'
import { parseEventLogs, type Address } from 'viem'
import { ConnectWalletCustom } from '@/components/TelegramWalletModal'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  BadgeCheck,
  ChevronRight,
  Clock,
  ExternalLink,
  Hourglass,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import {
  BUY_AD_MIN_COMPLETED,
  CHAIN_ID,
  DETAILS_MAX_BYTES,
  DETAILS_MODE,
  MAX_OPEN_ORDERS,
  MIN_GAS_WARNING_USDC,
  NATIVE_USDC_GAS_BUFFER,
  SIDE_BUY,
  SIDE_SELL,
  TIER_TABLE,
  ZERO_BYTES32,
  computeBond,
  countryByCurrency,
  encodeScopedId,
  fiatFor,
  formatDuration,
  hasMethodBit,
  formatFiat,
  formatOrderCap,
  formatPrice,
  formatUsdcAmount,
  getEscrowConfig,
  hexToCurrency,
  isAdExpired,
  isUncapped,
  maskToMethods,
  shortAddr,
  tier0CapFor,
  truncateUtf8,
  usdcFor,
} from '@/lib/p2p'
import { formatUnitsExact, formatUnitsFixed, parseUnitsExact } from '@/onchain-money'
import {
  useAccounts,
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
import { CoinLogo, MethodLogo } from '@/components/logos'
import { toast } from 'sonner'
import { BackendApiError } from '@/lib/api'
import {
  formatSavedMethodLine,
  saveOrderChosenMethod,
  useSavedPaymentMethods,
  type SavedPaymentMethod,
} from '@/hooks/useAccount'
import { recordRecentlyViewed, traderLabel, useTraderProfiles } from '@/hooks/useSocial'
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
  const asset = ad.asset
  const escrowCfg = getEscrowConfig(asset)
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { runWithReceipt, approveUsdc, writeContractAsync, pendingKey, busy } = useTx(asset)
  const balance = useUsdcBalance(asset)
  const nativeUsdcBalance = useUsdcBalance('USDC')
  const allowance = useUsdcAllowance(asset)
  const openCount = useOpenOrderCount(asset)
  const now = useNow()
  const { blocked, account, kycRequired } = useEligibility(asset)
  const makerKyc = useVerification(ad.maker, asset)
  const makerAccounts = useAccounts([ad.maker as Address], asset)
  const makerChainAccount = makerAccounts.get(ad.maker.toLowerCase())
  const { sealDetails, bindOrderDetails } = useVaultActions()
  const { methods: savedMethods } = useSavedPaymentMethods()
  const profiles = useTraderProfiles([ad.maker])
  const makerProfile = profiles.get(ad.maker.toLowerCase()) ?? null
  const makerName = traderLabel(ad.maker, makerProfile)

  const currency = hexToCurrency(ad.currency)
  const country = countryByCurrency(currency)
  const userBuys = ad.side === SIDE_SELL
  const isSealedBuyAd = !userBuys && ad.detailsMode !== DETAILS_MODE.PLAIN

  const matchingSaved = useMemo(
    () => savedMethods.filter((m) => hasMethodBit(ad.paymentMask, m.methodBit)),
    [savedMethods, ad.paymentMask],
  )

  const tokenDecimals = escrowCfg.decimals
  const displayDigits = asset === 'cirBTC' ? 6 : asset === 'WETH' ? 5 : 4
  const validInitial =
    initialUsdc && new RegExp(`^\\d+(\\.\\d{1,${tokenDecimals}})?$`).test(initialUsdc) ? initialUsdc : ''
  const [fiat, setFiat] = useState('')
  const [usdc, setUsdc] = useState(validInitial)
  const [edited, setEdited] = useState<'fiat' | 'usdc'>(validInitial ? 'usdc' : 'fiat')
  const adMethods = useMemo(() => maskToMethods(ad.paymentMask), [ad.paymentMask])
  const [selectedBuyMethodBit, setSelectedBuyMethodBit] = useState<number | null>(() =>
    adMethods.length === 1 ? adMethods[0]!.bit : null,
  )
  const [methodPickerOpen, setMethodPickerOpen] = useState(false)
  const [selectedSavedId, setSelectedSavedId] = useState<string | 'manual' | null>(null)
  const [manualHolderName, setManualHolderName] = useState('')
  const [manualDetails, setManualDetails] = useState('')
  const [sealing, setSealing] = useState(false)

  const selectedBuyMethod = useMemo(
    () =>
      selectedBuyMethodBit !== null ? (adMethods.find((m) => m.bit === selectedBuyMethodBit) ?? null) : null,
    [adMethods, selectedBuyMethodBit],
  )

  useEffect(() => {
    recordRecentlyViewed({
      wallet: ad.maker,
      displayName: makerProfile?.displayName ?? null,
      adId: ad.id.toString(),
      priceText: formatPrice(ad.priceE6),
      currency,
    })
  }, [ad.maker, ad.id, ad.priceE6, currency, makerProfile?.displayName])

  const activeSaved: SavedPaymentMethod | null = useMemo(() => {
    if (userBuys || selectedSavedId === 'manual') return null
    if (selectedSavedId !== null) {
      return matchingSaved.find((m) => m.id === selectedSavedId) ?? null
    }
    return matchingSaved[0] ?? null
  }, [userBuys, selectedSavedId, matchingSaved])

  const holderName = activeSaved ? activeSaved.holderName : manualHolderName
  const details = activeSaved
    ? isSealedBuyAd
      ? formatSavedMethodLine(activeSaved, false).slice(0, 400)
      : truncateUtf8(formatSavedMethodLine(activeSaved, true), DETAILS_MAX_BYTES)
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
    () => (edited === 'fiat' ? usdcFor(safeParse(fiat, 6), ad.priceE6, asset) : safeParse(usdc, tokenDecimals)),
    [edited, fiat, usdc, ad.priceE6, asset, tokenDecimals],
  )
  const fiatRaw = useMemo(
    () => (edited === 'fiat' ? safeParse(fiat, 6) : fiatFor(safeParse(usdc, tokenDecimals), ad.priceE6, asset)),
    [edited, fiat, usdc, ad.priceE6, asset, tokenDecimals],
  )

  const shownFiat = edited === 'fiat' ? fiat : fiatRaw > 0n ? formatUnitsFixed(fiatRaw, 6, 2) : ''
  const shownUsdc =
    edited === 'usdc'
      ? usdc
      : usdcRaw > 0n
        ? tokenDecimals > 6
          ? formatUnitsFixed(usdcRaw, tokenDecimals, displayDigits).replace(/\.?0+$/, '') || '0'
          : formatUnitsFixed(usdcRaw, tokenDecimals, displayDigits)
        : ''

  const detailBytes = new TextEncoder().encode(details).length
  const isRemainder = usdcRaw === ad.available
  const userCap = account ? account.orderCap : tier0CapFor(asset)
  const tierInfo = TIER_TABLE[account ? account.tier : 0] ?? TIER_TABLE[0]
  const expiredAd = isAdExpired(ad.expiresAt, now)

  const adHigh = ad.maxAmount > ad.available ? ad.available : ad.maxAmount
  const effectiveHigh = !isUncapped(userCap) && userCap < adHigh ? userCap : adHigh
  const adLow = ad.minAmount > ad.available ? ad.available : ad.minAmount

  const setMinAmount = () => {
    setEdited('usdc')
    setUsdc(adLow > 0n ? formatUnitsExact(adLow, tokenDecimals) : '')
  }

  const setMaxAmount = (targetTab?: 'fiat' | 'usdc') => {
    let maxAllowed = effectiveHigh
    if (!userBuys && balance !== undefined) {
      const spendable =
        asset === 'USDC'
          ? balance > NATIVE_USDC_GAS_BUFFER
            ? balance - NATIVE_USDC_GAS_BUFFER
            : 0n
          : balance
      if (spendable < maxAllowed) maxAllowed = spendable
    }
    if (targetTab === 'fiat') {
      setEdited('fiat')
      const maxFiat = fiatFor(maxAllowed, ad.priceE6, asset)
      setFiat(maxFiat > 0n ? formatUnitsFixed(maxFiat, 6, 2) : '')
    } else {
      setEdited('usdc')
      setUsdc(maxAllowed > 0n ? formatUnitsExact(maxAllowed, tokenDecimals) : '')
    }
  }

  const lowNativeGas = isConnected && nativeUsdcBalance !== undefined && nativeUsdcBalance < MIN_GAS_WARNING_USDC

  let problem: string | null = null
  if (expiredAd) problem = 'This ad has expired and can no longer accept new orders.'
  else if (kycRequired && !makerKyc.verified)
    problem = 'This advertiser does not currently hold active KYC verification.'
  else if (makerChainAccount && (makerChainAccount.restricted || makerChainAccount.disputeLimitReached))
    problem = 'This advertiser is currently restricted from opening new trades.'
  else if (makerChainAccount && makerChainAccount.totalDebt > 0n)
    problem = 'This advertiser has an unpaid dispute bond and cannot accept orders right now.'
  else if (makerChainAccount && Number(makerChainAccount.bannedUntil) > now)
    problem = 'This advertiser is in a temporary cancellation cooldown.'
  else if (
    makerChainAccount &&
    ad.side === SIDE_BUY &&
    !makerChainAccount.merchant &&
    makerChainAccount.ordersCompleted < BUY_AD_MIN_COMPLETED
  )
    problem = 'This buy ad is temporarily unavailable until the advertiser restores their merchant margin.'
  else if (usdcRaw === 0n) problem = null
  else if (usdcRaw > ad.available)
    problem = `Only ${formatUsdcAmount(ad.available, undefined, asset)} ${asset} is available.`
  else if (usdcRaw > ad.maxAmount)
    problem = `Maximum order is ${formatUsdcAmount(ad.maxAmount, undefined, asset)} ${asset}.`
  else if (usdcRaw < ad.minAmount && !isRemainder)
    problem = `Minimum order is ${formatUsdcAmount(ad.minAmount, undefined, asset)} ${asset} (tap Min for exact amount).`
  else if (!isUncapped(userCap) && usdcRaw > userCap)
    problem = `Your ${tierInfo.label} tier (Tier ${tierInfo.tier}) caps orders at ${formatOrderCap(userCap, asset)}.`
  else if (!userBuys && balance !== undefined && usdcRaw > balance)
    problem = `Insufficient balance (${formatUsdcAmount(balance, undefined, asset)} ${asset} available).`
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

  const buyerMethodReady = !userBuys || adMethods.length === 0 || selectedBuyMethod !== null
  const ready = usdcRaw > 0n && !problem && (userBuys ? buyerMethodReady : sellerInputsReady)

  const submit = async (onOpened: (orderId: bigint) => void) => {
    const escrow = escrowCfg.escrowAddress
    if (!ready || !escrow || !address) return
    if (!userBuys && (allowance ?? 0n) < usdcRaw) {
      const ok = await approveUsdc(usdcRaw)
      if (!ok) return
    }

    let detailsHashArg: `0x${string}` = ZERO_BYTES32
    let plainDetailsArg = userBuys ? '' : details.trim()
    let sealedBlobId: string | null = null

    if (isSealedBuyAd) {
      setSealing(true)
      try {
        const sealed = await sealDetails({
          kind: 'order_details',
          holderName: holderName.trim(),
          accountDetails: details.trim(),
        })
        sealedBlobId = sealed.id
        detailsHashArg = sealed.contentHash
        plainDetailsArg = ''
      } catch (err) {
        toast.error(err instanceof BackendApiError ? err.message : 'Wallet sign-in or vault encryption was cancelled.')
        setSealing(false)
        return
      }
      setSealing(false)
    }

    const receipt = await runWithReceipt('open', 'Open order', () =>
      writeContractAsync({
        address: escrow,
        abi: p2pEscrowAbi,
        functionName: 'openOrder',
        args: [ad.rawId, usdcRaw, ad.priceE6, detailsHashArg, plainDetailsArg],
        chainId: CHAIN_ID,
      }),
    )
    if (!receipt) return
    let minedRawOrderId: bigint | undefined
    try {
      const parsed = parseEventLogs({
        abi: p2pEscrowAbi,
        eventName: 'OrderOpened',
        logs: receipt.logs,
      })
      minedRawOrderId = parsed[0]?.args.orderId
    } catch {
      minedRawOrderId = undefined
    }
    if (minedRawOrderId === undefined && publicClient) {
      const ids = await publicClient
        .readContract({
          address: escrow,
          abi: p2pEscrowAbi,
          functionName: 'getUserOrderIds',
          args: [address],
        })
        .catch(() => [] as readonly bigint[])
      minedRawOrderId = ids[ids.length - 1]
    }
    if (minedRawOrderId !== undefined) {
      const scopedOrderId = encodeScopedId(asset, minedRawOrderId)
      if (userBuys && selectedBuyMethod) {
        saveOrderChosenMethod(scopedOrderId, selectedBuyMethod.bit)
      }
      if (sealedBlobId) {
        await bindOrderDetails(sealedBlobId, scopedOrderId)
      }
      onOpened(scopedOrderId)
    }
  }

  return {
    asset,
    tokenDecimals,
    escrowAddress: escrowCfg.escrowAddress,
    isConnected,
    adMethods,
    selectedBuyMethod,
    setSelectedBuyMethodBit,
    methodPickerOpen,
    setMethodPickerOpen,
    balance,
    nativeUsdcBalance,
    lowNativeGas,
    now,
    account,
    makerKyc,
    makerProfile,
    makerName,
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
    setMinAmount,
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
  makerName,
  onAccept,
  onCancel,
}: {
  maker: string
  makerName: string
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] text-[var(--p2p-warn-ink)]">
            <AlertTriangle className="size-5" />
          </div>
          <div>
            <h3 id="unverified-kyc-title" className="text-base font-bold leading-snug text-[var(--p2p-warn-ink)]">
              Advertiser Is Not KYC Verified
            </h3>
            <p className="mt-0.5 text-xs text-[var(--p2p-muted)]">
              Counterparty <strong className="text-[var(--p2p-ink)]">{makerName}</strong> ({shortAddr(maker)})
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]"
        >
          <X className="size-4" />
        </button>
      </div>

      <p className="text-xs leading-relaxed text-[var(--p2p-muted)]">
        This advertiser has <strong className="text-[var(--p2p-ink)]">not</strong> completed KYC identity verification.
        Please review and acknowledge the risk notice below before opening an order.
      </p>

      <div
        className="rounded-xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] px-4 py-3 text-xs font-semibold leading-relaxed text-[var(--p2p-warn-ink)]"
        style={{ borderLeftWidth: '3px' }}
      >
        If you encounter a scam or lose funds when trading with an unverified counterparty, OnPeer is not responsible
        or liable.
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3.5 text-xs font-medium leading-relaxed text-[var(--p2p-ink)] hover:border-[var(--p2p-border-active)]">
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

      <div className="grid grid-cols-2 gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-bold text-[var(--p2p-ink)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!checked}
          onClick={onAccept}
          className={`h-11 rounded-xl px-4 text-xs font-bold transition-colors ${
            checked
              ? 'bg-[#FF5A00] text-[#FFFFFF] hover:opacity-90'
              : 'cursor-not-allowed border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
          }`}
        >
          I Understand, Continue
        </button>
      </div>
    </motion.div>
  )
}

function BuyPaymentMethodPickerModal({
  open,
  methods,
  selectedBit,
  onSelect,
  onClose,
}: {
  open: boolean
  methods: ReturnType<typeof maskToMethods>
  selectedBit: number | null
  onSelect: (bit: number) => void
  onClose: () => void
}) {
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      className="p2p-terminal fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Payment Method(s)"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] p-5 text-[var(--p2p-ink)] shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h4 className="text-base font-extrabold text-[var(--p2p-ink)]">Payment Method(s)</h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--p2p-muted)] hover:bg-[var(--p2p-input-bg)] hover:text-[var(--p2p-ink)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-2.5">
          {methods.map((m) => {
            const active = selectedBit === m.bit
            return (
              <button
                key={m.bit}
                type="button"
                onClick={() => {
                  onSelect(m.bit)
                  onClose()
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-left text-sm font-bold transition-colors ${
                  active
                    ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[var(--p2p-ink)]'
                    : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)] hover:border-[#FF5A00]'
                }`}
              >
                <span
                  className="inline-flex items-center gap-2.5 pl-2.5"
                  style={{ borderLeft: '3px solid #FF5A00' }}
                >
                  <MethodLogo name={m.name} size={18} />
                  <span>{m.name}</span>
                </span>
                {active && (
                  <span className="rounded-full bg-[#FF5A00] px-2 py-0.5 text-[10px] font-bold text-white">
                    Selected
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Mobile Full-Screen Order Placement View (SS 3 Pattern) */
function MobileOrderScreen({
  ad,
  s,
  onCancel,
  onOpened,
  onOpenTrader,
}: {
  ad: AdWithId
  s: ReturnType<typeof useOrderFormState>
  onCancel: () => void
  onOpened: (orderId: bigint) => void
  onOpenTrader?: (wallet: string) => void
}) {
  const methods = maskToMethods(ad.paymentMask)
  const kycVerified = s.makerKyc.verified || s.makerProfile?.kycApproved === true

  return (
    <motion.section
      role="dialog"
      aria-modal="true"
      aria-label={s.userBuys ? `Buy ${s.asset}` : `Sell ${s.asset}`}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 380, damping: 36 }}
      onClick={(e) => e.stopPropagation()}
      className="flex h-dvh w-full flex-col bg-[var(--p2p-surface-solid)] text-[var(--p2p-ink)] md:hidden"
    >
      {/* Top Bar (SS 3) */}
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--p2p-border)] px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Back"
          className="inline-flex size-9 items-center justify-center rounded-xl text-[var(--p2p-ink)]"
        >
          <ArrowLeft className="size-5" />
        </button>

        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 text-base font-extrabold text-[var(--p2p-ink)]">
            <CoinLogo symbol={s.asset} size={20} />
            <span>{s.userBuys ? `Buy ${s.asset}` : `Sell ${s.asset}`}</span>
          </div>
          <p className="p2p-mono mt-0.5 flex items-center justify-center gap-1 text-xs text-[var(--p2p-muted)]">
            Price {s.country?.symbol} {formatPrice(ad.priceE6)} <RefreshCw className="size-3" />
          </p>
        </div>

        <span className="size-9" />
      </header>

      {/* Scrollable Body (SS 3) */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* Card 1: By Fiat / By USDC Input */}
        <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-4 space-y-3">
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => s.setEdited('fiat')}
              className={`relative pb-2 text-xs font-bold transition-colors ${
                s.edited === 'fiat' ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)]'
              }`}
            >
              By {s.currency}
              {s.edited === 'fiat' && (
                <span className="absolute inset-x-0 bottom-0 mx-auto h-[3px] w-6 rounded-full bg-[#FF5A00]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => s.setEdited('usdc')}
              className={`relative pb-2 text-xs font-bold transition-colors ${
                s.edited === 'usdc' ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)]'
              }`}
            >
              By {s.asset}
              {s.edited === 'usdc' && (
                <span className="absolute inset-x-0 bottom-0 mx-auto h-[3px] w-6 rounded-full bg-[#FF5A00]" />
              )}
            </button>
          </div>

          <div className="flex items-baseline justify-between gap-2 border-b border-[var(--p2p-border)] pb-3">
            {s.edited === 'fiat' ? (
              <input
                inputMode="decimal"
                value={s.shownFiat}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, '')
                  if (/^\d*\.?\d{0,2}$/.test(v)) s.setFiat(v)
                }}
                placeholder="0"
                className="p2p-mono w-full bg-transparent text-3xl font-extrabold text-[var(--p2p-ink)] outline-none placeholder:text-[var(--p2p-muted)]"
              />
            ) : (
              <input
                inputMode="decimal"
                value={s.shownUsdc}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, '')
                  if (new RegExp(`^\\d*\\.?\\d{0,${s.tokenDecimals}}$`).test(v)) s.setUsdc(v)
                }}
                placeholder="0"
                className="p2p-mono w-full bg-transparent text-3xl font-extrabold text-[var(--p2p-ink)] outline-none placeholder:text-[var(--p2p-muted)]"
              />
            )}

            <div className="flex shrink-0 items-center gap-2 text-sm font-bold">
              <span className="text-[var(--p2p-ink)]">{s.edited === 'fiat' ? s.currency : s.asset}</span>
              <button
                type="button"
                onClick={s.setMinAmount}
                className="text-xs font-extrabold text-[var(--p2p-muted)] hover:text-[#FF5A00]"
              >
                Min
              </button>
              <button
                type="button"
                onClick={() => s.setMaxAmount('usdc')}
                className="font-extrabold text-[#FF5A00]"
              >
                Max
              </button>
            </div>
          </div>

          <p className="p2p-mono text-xs text-[var(--p2p-muted)]">
            {s.edited === 'fiat'
              ? `Limit ${formatFiat(fiatFor(s.adLow, ad.priceE6, s.asset), 0)} - ${formatFiat(fiatFor(s.effectiveHigh, ad.priceE6, s.asset), 0)} ${s.currency}`
              : `Limit ${formatUsdcAmount(s.adLow, undefined, s.asset)} - ${formatUsdcAmount(s.effectiveHigh, undefined, s.asset)} ${s.asset}`}
          </p>

          <div className="flex items-center justify-between pt-1 text-xs">
            <span className="text-[var(--p2p-muted)]">You Receive</span>
            <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">
              {s.userBuys
                ? `${s.usdcRaw > 0n ? formatUsdcAmount(s.usdcRaw, undefined, s.asset) : '0'} ${s.asset}`
                : `${s.country?.symbol ?? ''}${s.fiatRaw > 0n ? formatFiat(s.fiatRaw) : '0.00'} ${s.currency}`}
            </span>
          </div>
        </div>

        {/* Card 2: Payment Methods & Auto-Fill */}
        {s.userBuys ? (
          <button
            type="button"
            onClick={() => s.setMethodPickerOpen(true)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-3.5 text-left transition-colors hover:border-[#FF5A00]"
          >
            {s.selectedBuyMethod ? (
              <span
                className="inline-flex items-center gap-2 pl-2.5 text-sm font-bold text-[var(--p2p-ink)]"
                style={{ borderLeft: '3px solid #FF5A00' }}
              >
                <MethodLogo name={s.selectedBuyMethod.name} size={16} />
                <span>{s.selectedBuyMethod.name}</span>
              </span>
            ) : (
              <span className="text-sm font-semibold text-[var(--p2p-muted)]">Set my payment method</span>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--p2p-muted)]">
              <span className="p2p-mono inline-flex size-5 items-center justify-center rounded-full bg-[var(--p2p-surface)] text-[11px] font-bold text-[var(--p2p-ink)]">
                {methods.length}
              </span>
              <ChevronRight className="size-4" />
            </span>
          </button>
        ) : (
        <div className="rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {methods.map((m) => (
              <span
                key={m.bit}
                className="inline-flex items-center pl-2.5 text-sm font-bold text-[var(--p2p-ink)]"
                style={{ borderLeft: '3px solid #FF5A00' }}
              >
                {m.name}
              </span>
            ))}
          </div>

          <div className="space-y-2.5 border-t border-[var(--p2p-border)] pt-3">
              {s.matchingSaved.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-bold text-[#FF5A00]">
                    Select Saved Payment Method (Auto-Fill)
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {s.matchingSaved.map((sm) => {
                      const selected = s.activeSaved?.id === sm.id
                      return (
                        <button
                          key={sm.id}
                          type="button"
                          onClick={() => s.selectSavedMethod(sm)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold ${
                            selected
                              ? 'border-[#FF5A00] bg-[#FF5A00] text-white'
                              : 'border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-ink)]'
                          }`}
                        >
                          <MethodLogo name={sm.methodName} size={13} />
                          <span>{sm.methodName}</span>
                          <span className="p2p-mono text-[11px]">••{sm.accountNumber.slice(-4)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {s.isSealedBuyAd && (
                <input
                  value={s.holderName}
                  onChange={(e) => s.setHolderName(e.target.value.slice(0, 80))}
                  placeholder="Account holder full name"
                  className="p2p-input h-10 w-full rounded-lg !bg-[var(--p2p-surface-solid)] px-3 text-xs font-medium"
                />
              )}
              <textarea
                value={s.details}
                onChange={(e) => s.setDetails(e.target.value)}
                rows={2}
                placeholder="Receiving account number (e.g. bKash Personal 01XXXXXXXXX)"
                className="p2p-input p2p-mono w-full resize-none rounded-lg !bg-[var(--p2p-surface-solid)] px-3 py-2 text-xs"
              />
            </div>
        </div>
        )}

        <BuyPaymentMethodPickerModal
          open={s.userBuys && s.methodPickerOpen}
          methods={methods}
          selectedBit={s.selectedBuyMethod?.bit ?? null}
          onSelect={(bit) => s.setSelectedBuyMethodBit(bit)}
          onClose={() => s.setMethodPickerOpen(false)}
        />

        {/* Escrow Info Row */}
        <div className="flex items-center justify-between rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-3 text-xs">
          <span className="inline-flex items-center gap-2 font-semibold text-[var(--p2p-ink)]">
            <Lock className="size-4 text-[#FF5A00]" /> Arc Smart Contract Escrow
          </span>
          <span className="p2p-mono font-bold text-emerald-400">0 Fee • {ad.windowMinutes}m Window</span>
        </div>

        {/* Advertiser's Info & Terms (SS 3) */}
        <div className="space-y-2.5 pt-1">
          <h4 className="text-sm font-extrabold text-[var(--p2p-ink)]">Advertiser&apos;s Info</h4>
          <button
            type="button"
            onClick={() => {
              onCancel()
              onOpenTrader?.(ad.maker)
            }}
            className="flex w-full items-center justify-between rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-3 text-left"
          >
            <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--p2p-ink)]">
              <span>{s.makerName}</span>
              {ad.merchantAd && <ShieldCheck className="size-4 text-[#FF5A00]" />}
              {kycVerified && <BadgeCheck className="size-4 text-emerald-400" />}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
              <span className="size-2 rounded-full bg-emerald-400" /> Online
              <ChevronRight className="size-4 text-[var(--p2p-muted)]" />
            </span>
          </button>

          {ad.details && (
            <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3.5 text-xs leading-relaxed text-[var(--p2p-muted)] whitespace-pre-wrap break-words">
              {ad.details}
            </div>
          )}
        </div>

        {s.lowNativeGas && (
          <div className="flex items-start gap-2 rounded-xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] p-3 text-xs text-[var(--p2p-warn-ink)]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Low native USDC gas ({formatUsdcAmount(s.nativeUsdcBalance ?? 0n)} USDC). Keep ~0.05 USDC free on Arc for transaction gas.
            </span>
          </div>
        )}

        {s.problem && (
          <div className="flex items-start gap-2 rounded-xl border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] p-3 text-xs text-[#FF5A00]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{s.problem}</span>
          </div>
        )}
      </div>

      {/* Sticky Bottom Place Order CTA (SS 3) */}
      <footer className="shrink-0 border-t border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] px-4 py-3.5">
        {s.isConnected ? (
          <button
            type="button"
            disabled={!s.ready || s.busy}
            onClick={() => void s.submit(onOpened)}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5A00] text-sm font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {s.busy && <Loader2 className="size-4 animate-spin" />}
            {s.pendingKey === 'approve'
              ? `Approve ${s.asset}...`
              : s.busy
                ? 'Confirming...'
                : 'Place Order'}
          </button>
        ) : (
          <ConnectWalletCustom>
            {({ show }) => (
              <button
                type="button"
                onClick={show}
                className="h-12 w-full rounded-xl bg-[#FF5A00] text-sm font-extrabold text-white"
              >
                Connect Wallet
              </button>
            )}
          </ConnectWalletCustom>
        )}
      </footer>
    </motion.section>
  )
}

export function InlineOrderDrawer({
  ad,
  makerAccount,
  initialUsdc,
  onCancel,
  onOpened,
  onOpenTrader,
}: {
  ad: AdWithId
  makerAccount?: Account
  initialUsdc?: string
  onCancel: () => void
  onOpened: (orderId: bigint) => void
  onOpenTrader?: (wallet: string) => void
}) {
  const s = useOrderFormState(ad, initialUsdc)

  const ttlLeft = Math.max(0, Number(ad.expiresAt) - s.now)
  const ttlText = ttlLeft >= 3600 ? `${Math.ceil(ttlLeft / 3600)}h left` : formatDuration(ttlLeft)
  const methods = maskToMethods(ad.paymentMask)
  const completionPct =
    makerAccount && makerAccount.ordersCreated > 0
      ? ((makerAccount.ordersCompleted / makerAccount.ordersCreated) * 100).toFixed(2)
      : '100.00'
  const previewBond = computeBond(s.usdcRaw > 0n ? s.usdcRaw : s.adLow, s.asset)

  const minFiatText = formatFiat(fiatFor(s.adLow, ad.priceE6, s.asset), 2)
  const maxFiatText = formatFiat(fiatFor(s.effectiveHigh, ad.priceE6, s.asset), 2)

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Left Side: Advertisers' Terms + Maker Info */}
        <div className="flex flex-col justify-between space-y-4 border-b border-[var(--p2p-border)] pb-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
          <div className="space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-extrabold text-[var(--p2p-ink)]">
                Advertisers&apos; Terms <span className="text-[#FF5A00]">*</span>
              </h4>
              <div className="flex flex-wrap items-center gap-1.5">
                {s.makerKyc.verified && (
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-ok-border)] bg-[var(--p2p-ok-bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--p2p-ok-ink)]">
                    <ShieldCheck className="size-3" /> Verified
                  </span>
                )}
                {ad.merchantAd && (
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
                    <ShieldCheck className="size-3" /> Merchant
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3.5 text-xs leading-relaxed text-[var(--p2p-ink)]">
              {ad.details?.trim() ? (
                <p className="whitespace-pre-wrap break-words">{ad.details}</p>
              ) : (
                <div className="space-y-1.5 text-[var(--p2p-muted)]">
                  <p className="font-semibold text-[var(--p2p-ink)]">Please read before opening an order:</p>
                  <p>• Pay strictly from an account matching your verified name on OnPeer.</p>
                  <p>• No third-party payments accepted. Do not mention crypto in bank remarks.</p>
                  <p>• Complete transfer within {ad.windowMinutes} minutes of opening the order.</p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  onCancel()
                  onOpenTrader?.(ad.maker)
                }}
                className="font-bold text-[var(--p2p-ink)] hover:text-[#FF5A00] hover:underline"
              >
                {s.makerName}
              </button>
              <span className="p2p-mono text-[var(--p2p-muted)]">
                {makerAccount ? `${makerAccount.ordersCompleted} orders` : '0 orders'} • {completionPct}%
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
                  {formatUsdcAmount(ad.available, undefined, s.asset)} {s.asset}
                </span>
              </div>
              <div>
                <span className="block text-[var(--p2p-muted)]">Asymmetric Dispute Bond</span>
                <span className="p2p-mono mt-0.5 font-semibold text-[#FF5A00]">
                  {formatUsdcAmount(previewBond, undefined, s.asset)} {s.asset}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-[var(--p2p-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3.5 text-[#FF5A00]" />
              {s.userBuys ? `Seller ${s.asset} locked in smart contract` : `Your ${s.asset} locks in escrow on open`}
            </span>
            <a
              href={buildAddressExplorerUrl(CHAIN_ID, s.escrowAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-[#FF5A00] hover:underline"
            >
              Verify Escrow <ExternalLink className="size-3" />
            </a>
          </div>
        </div>

        {/* Right Side */}
        <div className="space-y-3.5">
          {s.userBuys ? (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--p2p-muted)]">
                  Price{' '}
                  <strong className="p2p-mono ml-1 text-sm font-extrabold text-[var(--p2p-ink)]">
                    {formatPrice(ad.priceE6)} {s.currency}
                  </strong>
                </span>
                {s.account && (
                  <span className="p2p-mono text-[11px] text-[var(--p2p-muted)]">
                    Tier {s.account.tier} cap: {formatOrderCap(s.account.orderCap, s.asset)}
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 py-3">
                <span className="block text-xs font-medium text-[var(--p2p-muted)]">You Pay</span>
                <div className="mt-1.5 flex items-center gap-2">
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
                    placeholder={`${minFiatText} - ${maxFiatText}`}
                    className="p2p-mono w-full bg-transparent text-base font-bold text-[var(--p2p-ink)] outline-none placeholder:text-[var(--p2p-muted)]/70"
                  />
                  <button
                    type="button"
                    onClick={s.setMinAmount}
                    className="shrink-0 text-xs font-bold text-[var(--p2p-muted)] hover:text-[#FF5A00]"
                  >
                    MIN
                  </button>
                  <button
                    type="button"
                    onClick={() => s.setMaxAmount('usdc')}
                    className="shrink-0 text-xs font-extrabold text-[#FF5A00] hover:opacity-80"
                  >
                    MAX
                  </button>
                  <span className="inline-flex shrink-0 items-center gap-1 border-l border-[var(--p2p-border)] pl-2.5 text-xs font-bold text-[var(--p2p-ink)]">
                    {s.currency}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 py-3">
                <span className="block text-xs font-medium text-[var(--p2p-muted)]">You Receive</span>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    inputMode="decimal"
                    value={s.shownUsdc}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '')
                      if (new RegExp(`^\\d*\\.?\\d{0,${s.tokenDecimals}}$`).test(v)) {
                        s.setEdited('usdc')
                        s.setUsdc(v)
                      }
                    }}
                    placeholder="0.00"
                    className="p2p-mono w-full bg-transparent text-base font-bold text-[var(--p2p-ink)] outline-none placeholder:text-[var(--p2p-muted)]/70"
                  />
                  <span className="inline-flex shrink-0 items-center gap-1.5 border-l border-[var(--p2p-border)] pl-2.5 text-xs font-bold text-[var(--p2p-ink)]">
                    <CoinLogo symbol={s.asset} size={15} /> {s.asset}
                  </span>
                </div>
              </div>

              {/* Required Payment Method Selector (8th–10th SS) */}
              <button
                type="button"
                onClick={() => s.setMethodPickerOpen(true)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-3.5 text-left transition-colors ${
                  s.selectedBuyMethod
                    ? 'border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)]'
                    : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] hover:border-[#FF5A00]'
                }`}
              >
                {s.selectedBuyMethod ? (
                  <span
                    className="inline-flex items-center gap-2 pl-2.5 text-sm font-bold text-[var(--p2p-ink)]"
                    style={{ borderLeft: '3px solid #FF5A00' }}
                  >
                    <MethodLogo name={s.selectedBuyMethod.name} size={16} />
                    <span>{s.selectedBuyMethod.name}</span>
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-[var(--p2p-muted)]">Set my payment method</span>
                )}
                <span className="inline-flex items-center gap-1.5 text-xs text-[var(--p2p-muted)]">
                  <span className="p2p-mono inline-flex size-5 items-center justify-center rounded-full bg-[var(--p2p-surface)] text-[11px] font-bold text-[var(--p2p-ink)]">
                    {methods.length}
                  </span>
                  <ChevronRight className="size-4" />
                </span>
              </button>

              <BuyPaymentMethodPickerModal
                open={s.methodPickerOpen}
                methods={methods}
                selectedBit={s.selectedBuyMethod?.bit ?? null}
                onSelect={(bit) => s.setSelectedBuyMethodBit(bit)}
                onClose={() => s.setMethodPickerOpen(false)}
              />
            </>
          ) : (
            <>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--p2p-muted)]">I want to sell</span>
                  <span className="p2p-mono text-[var(--p2p-muted)]">
                    {s.balance !== undefined
                      ? `Wallet: ${formatUsdcAmount(s.balance, undefined, s.asset)} ${s.asset}`
                      : `Max: ${formatUsdcAmount(s.effectiveHigh, undefined, s.asset)} ${s.asset}`}
                  </span>
                </div>
                <div className="p2p-input flex items-center rounded-lg px-3 py-2.5">
                  <input
                    inputMode="decimal"
                    value={s.shownUsdc}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '')
                      if (new RegExp(`^\\d*\\.?\\d{0,${s.tokenDecimals}}$`).test(v)) {
                        s.setEdited('usdc')
                        s.setUsdc(v)
                      }
                    }}
                    placeholder="0.00"
                    className="p2p-mono w-full bg-transparent text-lg font-bold text-[var(--p2p-ink)] outline-none placeholder:text-[var(--p2p-muted)]"
                  />
                  <button
                    type="button"
                    onClick={s.setMinAmount}
                    className="mr-2 text-xs font-bold text-[var(--p2p-muted)] hover:text-[#FF5A00]"
                  >
                    Min
                  </button>
                  <button
                    type="button"
                    onClick={() => s.setMaxAmount('usdc')}
                    className="mr-2.5 text-xs font-bold text-[#FF5A00] hover:opacity-80"
                  >
                    Max
                  </button>
                  <span className="inline-flex items-center gap-1.5 border-l border-[var(--p2p-border)] pl-2.5 text-xs font-bold text-[var(--p2p-ink)]">
                    <CoinLogo symbol={s.asset} size={14} /> {s.asset}
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
                    {formatFiat(fiatFor(s.adLow, ad.priceE6, s.asset), 0)} - {s.country?.symbol}
                    {formatFiat(fiatFor(s.effectiveHigh, ad.priceE6, s.asset), 0)}
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

          {s.lowNativeGas && (
          <div className="flex items-start gap-2 rounded-xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] p-3 text-xs text-[var(--p2p-warn-ink)]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Low native USDC gas ({formatUsdcAmount(s.nativeUsdcBalance ?? 0n)} USDC). Keep ~0.05 USDC free on Arc for transaction gas.
            </span>
          </div>
        )}

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
              className="min-h-11 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-sm font-semibold text-[var(--p2p-ink)] hover:border-[var(--p2p-border-active)]"
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
                  ? `Approve ${s.asset}...`
                  : s.busy
                    ? 'Confirming...'
                    : s.userBuys
                      ? `Buy ${s.asset}`
                      : `Sell ${s.asset}`}
              </button>
            ) : (
              <ConnectWalletCustom>
                {({ show }) => (
                  <button
                    type="button"
                    onClick={show}
                    className="min-h-11 rounded-lg bg-[#FF5A00] px-5 text-sm font-bold text-[#FFFFFF]"
                  >
                    Connect Wallet
                  </button>
                )}
              </ConnectWalletCustom>
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
  onOpenTrader,
}: {
  ad: AdWithId
  makerAccount?: Account
  initialUsdc?: string
  onClose: () => void
  onOpened: (orderId: bigint) => void
  onOpenTrader?: (wallet: string) => void
}) {
  const s = useOrderFormState(ad, initialUsdc)
  const [unverifiedAccepted, setUnverifiedAccepted] = useState(false)
  const kycVerified = s.makerKyc.verified || s.makerProfile?.kycApproved === true

  if (s.makerKyc.isLoading) {
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

  if (!kycVerified && !unverifiedAccepted) {
    return (
      <UnverifiedAdvertiserCard
        maker={ad.maker}
        makerName={s.makerName}
        onAccept={() => setUnverifiedAccepted(true)}
        onCancel={onClose}
      />
    )
  }

  return (
    <>
      {/* Mobile Full-Screen Order Screen (SS 3) */}
      <MobileOrderScreen
        ad={ad}
        s={s}
        onCancel={onClose}
        onOpened={onOpened}
        onOpenTrader={onOpenTrader}
      />

      {/* Desktop Centered Order Modal */}
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={s.userBuys ? `Buy ${s.asset}` : `Sell ${s.asset}`}
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 10 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="hidden max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--p2p-border-active)] bg-[var(--p2p-surface-solid)] text-[var(--p2p-ink)] shadow-2xl md:flex"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-5 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <CoinLogo symbol={s.asset} size={22} />
            <div>
              <h3 className="text-base font-bold text-[var(--p2p-ink)]">
                {s.userBuys ? `Buy ${s.asset}` : `Sell ${s.asset}`} with {s.currency}
              </h3>
              <p className="p2p-mono text-[11px] text-[var(--p2p-muted)]">
                Rate {formatPrice(ad.priceE6)} {s.currency}/{s.asset} • Escrow Protected
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]"
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
            onOpenTrader={onOpenTrader}
          />
        </div>
      </motion.section>
    </>
  )
}

export function TradePopupModal({
  ad,
  makerAccount,
  initialUsdc,
  onClose,
  onOpened,
  onOpenTrader,
}: {
  ad: AdWithId | null
  makerAccount?: Account
  initialUsdc?: string
  onClose: () => void
  onOpened: (orderId: bigint) => void
  onOpenTrader?: (wallet: string) => void
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
          className="p2p-terminal fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-md md:p-4"
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
            onOpenTrader={onOpenTrader}
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
    <Sheet open={!!ad} onClose={onClose} title={ad ? (ad.side === SIDE_SELL ? `Buy ${ad.asset}` : `Sell ${ad.asset}`) : ''}>
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
