import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount, usePublicClient } from 'wagmi'
import { keccak256, parseEventLogs, toBytes } from 'viem'
import { ConnectWalletCustom } from '@/components/TelegramWalletModal'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  BUY_AD_MIN_COMPLETED,
  CHAIN_ID,
  COUNTRIES,
  DEFAULT_TTL_HOURS,
  DETAILS_MAX_BYTES,
  DETAILS_MODE,
  MAX_FIAT_PRICE_E6,
  MIN_GAS_WARNING_USDC,
  MIN_TAKER_OPTIONS,
  NATIVE_USDC_GAS_BUFFER,
  VISIBLE_P2P_ASSETS,
  SIDE_BUY,
  SIDE_SELL,
  TTL_OPTIONS,
  ZERO_BYTES32,
  bitsToMask,
  currencyToHex,
  encodeScopedId,
  formatUsdcAmount,
  getEscrowConfig,
  merchantMarginFor,
  methodsForCountry,
  truncateUtf8,
  type P2pAsset,
} from '@/lib/p2p'
import { formatUnitsExact, parseUnitsExact } from '@/onchain-money'
import {
  useListingFee,
  useP2pAsset,
  usePrivacySwitches,
  useUsdcAllowance,
  useUsdcBalance,
} from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { AppLink } from '@/components/AppLink'
import { CoinLogo, CountryFlag, MethodLogo } from '@/components/logos'
import { useEligibility } from '@/hooks/useEligibility'
import { BackendApiError, apiFetch } from '@/lib/api'
import {
  formatSavedMethodLine,
  useSavedPaymentMethods,
  type SavedPaymentMethod,
} from '@/hooks/useAccount'
import { useVaultActions } from '@/hooks/useVault'

const PUBLIC_TERMS_MAX_BYTES = 1_000

const safe = (v: string, decimals = 6): bigint => {
  try {
    return v ? parseUnitsExact(v, decimals) : 0n
  } catch {
    return 0n
  }
}

const decimalInput = (setter: (v: string) => void, places: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
  const v = e.target.value.replace(/[^0-9.]/g, '')
  if (new RegExp(`^\\d*\\.?\\d{0,${places}}$`).test(v)) setter(v)
}

const ttlLabel = (h: number) => (h >= 24 && h % 24 === 0 ? `${h / 24}d (${h}h)` : `${h}h`)

export function PostAdSheet({
  open,
  onClose,
  initialSide,
  initialCurrency,
}: {
  open: boolean
  onClose: () => void
  initialSide?: number
  initialCurrency?: string
}) {
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="p2p-terminal fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="Create Buy / Sell Ad"
            className="p2p-glass-popover relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl text-[var(--p2p-ink)]"
            initial={{ y: 20, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-[var(--p2p-ink)]">Create Buy / Sell Ad</h2>
                <p className="text-xs text-[var(--p2p-muted)]">Non-custodial smart contract escrow on Arc</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex size-8 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="overflow-y-auto px-5 py-5">
              <PostAdForm onDone={onClose} initialSide={initialSide} initialCurrency={initialCurrency} />
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function PostAdForm({
  onDone,
  initialSide,
  initialCurrency,
}: {
  onDone: () => void
  initialSide?: number
  initialCurrency?: string
}) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const [activeMarketAsset, setActiveMarketAsset] = useP2pAsset()
  const [asset, setAsset] = useState<P2pAsset>(activeMarketAsset)
  const balance = useUsdcBalance(asset)
  const nativeUsdcBalance = useUsdcBalance('USDC')
  const allowance = useUsdcAllowance(asset)
  const listingFee = useListingFee(asset)
  const { sealedEnabled, isLoading: switchesLoading } = usePrivacySwitches(asset)
  const { sealDetails, bindAdDetails } = useVaultActions()
  const { runWithReceipt, approveUsdc, writeContractAsync, pendingKey, busy } = useTx(asset)
  const { blocked, account } = useEligibility(asset)
  const { methods: savedMethods } = useSavedPaymentMethods()

  const [side, setSide] = useState<number>(initialSide ?? SIDE_SELL)
  const [countryCode, setCountryCode] = useState(
    () => COUNTRIES.find((c) => c.currency === initialCurrency)?.code ?? 'BD',
  )
  const [price, setPrice] = useState('')
  const [total, setTotal] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [bits, setBits] = useState<number[]>([])
  const [windowMin, setWindowMin] = useState(15)
  const [ttlHours, setTtlHours] = useState<number>(DEFAULT_TTL_HOURS)
  const [holderName, setHolderName] = useState('')
  const [details, setDetails] = useState('')
  const [publicTerms, setPublicTerms] = useState('')
  const [methodDrafts, setMethodDrafts] = useState<
    Record<
      number,
      {
        holderName: string
        accountNumber: string
        bankOrBranch: string
        branchName: string
        routingNumber: string
        notes: string
      }
    >
  >({})
  const [activeVaultIdx, setActiveVaultIdx] = useState(0)
  const [minTaker, setMinTaker] = useState(0)
  const [sealing, setSealing] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const country = COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0]
  const methods = methodsForCountry(country.code)
  const tokenDecimals = getEscrowConfig(asset).decimals
  const minMerchantMargin = merchantMarginFor(asset)
  const priceE6 = safe(price, 6)
  const totalRaw = safe(total, tokenDecimals)
  const minRaw = safe(min, tokenDecimals)
  const maxRaw = safe(max, tokenDecimals)
  const isSell = side === SIDE_SELL
  const useSealedVault = sealedEnabled && isSell

  const safeVaultIdx = bits.length > 0 ? Math.min(activeVaultIdx, bits.length - 1) : 0
  const activeVaultBit = bits[safeVaultIdx]
  const activeVaultMethod = methods.find((m) => m.bit === activeVaultBit) ?? null
  const activeVaultDraft =
    activeVaultBit !== undefined
      ? (methodDrafts[activeVaultBit] ?? {
          holderName,
          accountNumber: '',
          bankOrBranch: '',
          branchName: '',
          routingNumber: '',
          notes: '',
        })
      : null

  const serializedVaultDetails = !useSealedVault
    ? details
    : bits
        .map((b) => {
          const mDef = methods.find((m) => m.bit === b)
          const d = methodDrafts[b]
          if (!mDef || !d || d.accountNumber.trim().length < 2) return null
          return formatSavedMethodLine(
            {
              id: `draft_${b}`,
              methodBit: b,
              methodName: mDef.name,
              holderName: d.holderName.trim() || holderName.trim(),
              accountNumber: d.accountNumber.trim(),
              bankOrBranch: d.bankOrBranch.trim(),
              branchName: d.branchName.trim() || undefined,
              routingNumber: d.routingNumber.trim() || undefined,
              notes: d.notes.trim(),
              updatedAt: '',
            },
            false,
          )
        })
        .filter((x): x is string => x !== null)
        .join('\n')

  const effectiveHolderName = !useSealedVault
    ? holderName
    : bits.map((b) => methodDrafts[b]?.holderName?.trim()).find((h): h is string => !!h) ?? holderName.trim()

  const publicTermsBytes = useMemo(() => new TextEncoder().encode(publicTerms).length, [publicTerms])
  const plainDetailsBytes = useMemo(() => new TextEncoder().encode(details).length, [details])
  const detailBytes = useSealedVault || !isSell ? publicTermsBytes : plainDetailsBytes
  const requiredUsdc = (isSell ? totalRaw : 0n) + listingFee

  const buyAdBlocked =
    !isSell &&
    isConnected &&
    !!account &&
    !account.merchant &&
    account.ordersCompleted < BUY_AD_MIN_COMPLETED

  let step1Problem: string | null = null
  if (priceE6 > MAX_FIAT_PRICE_E6) {
    step1Problem = 'Exchange rate exceeds the maximum supported limit.'
  } else if (buyAdBlocked) {
    step1Problem = `Buy ads require Merchant Margin >= ${formatUsdcAmount(minMerchantMargin, undefined, asset)} ${asset} or ${BUY_AD_MIN_COMPLETED}+ qualifying trades (>= 10 ${asset} each with different counterparties; you have ${account.ordersCompleted}).`
  } else if (!isSell && isConnected && balance !== undefined && listingFee > balance) {
    step1Problem = `Insufficient wallet balance for the ${formatUsdcAmount(listingFee, undefined, asset)} ${asset} listing fee (${formatUsdcAmount(balance, undefined, asset)} ${asset} available).`
  } else if (totalRaw > 0n && minRaw > 0n && maxRaw > 0n) {
    if (minRaw > maxRaw) step1Problem = 'Minimum order cannot exceed maximum order.'
    else if (maxRaw > totalRaw) step1Problem = 'Maximum order cannot exceed total amount.'
    else if (balance !== undefined && requiredUsdc > balance)
      step1Problem = `Insufficient wallet balance (${formatUsdcAmount(balance, undefined, asset)} ${asset} available; ${formatUsdcAmount(requiredUsdc, undefined, asset)} ${asset} needed with listing fee).`
  }

  let problem: string | null = step1Problem
  if (!problem && (useSealedVault || !isSell) && publicTermsBytes > PUBLIC_TERMS_MAX_BYTES) {
    problem = `Public maker terms exceed ${PUBLIC_TERMS_MAX_BYTES} bytes.`
  }
  if (!problem && !useSealedVault && isSell && plainDetailsBytes > DETAILS_MAX_BYTES) {
    problem = 'Payment details exceed 200 bytes.'
  }
  if (!problem && useSealedVault && serializedVaultDetails.trim().length > 1500) {
    problem = 'Encrypted receiving details exceed 1,500 characters.'
  }

  const lowNativeGas = isConnected && nativeUsdcBalance !== undefined && nativeUsdcBalance < MIN_GAS_WARNING_USDC

  const fillMaxTotal = () => {
    if (!isSell || balance === undefined) return
    const gasReserve = asset === 'USDC' ? NATIVE_USDC_GAS_BUFFER : 0n
    const usable = balance > listingFee + gasReserve ? balance - listingFee - gasReserve : 0n
    const formatted = usable > 0n ? formatUnitsExact(usable, tokenDecimals) : ''
    setTotal(formatted)
    if (!max) setMax(formatted)
  }

  const missingSealedMethod =
    useSealedVault &&
    bits.some((b) => {
      const d = methodDrafts[b]
      return !d || d.accountNumber.trim().length < 2
    })

  const sellDetailsReady = useSealedVault
    ? effectiveHolderName.length >= 2 && serializedVaultDetails.trim().length >= 2 && !missingSealedMethod
    : details.trim().length > 0

  const step1Ready =
    !blocked &&
    !buyAdBlocked &&
    priceE6 > 0n &&
    priceE6 <= MAX_FIAT_PRICE_E6 &&
    totalRaw > 0n &&
    minRaw > 0n &&
    maxRaw > 0n &&
    minRaw <= maxRaw &&
    maxRaw <= totalRaw &&
    (balance === undefined || requiredUsdc <= balance)

  const step2Ready =
    bits.length > 0 &&
    ttlHours >= 1 &&
    ttlHours <= 168 &&
    (!(useSealedVault || !isSell) || publicTermsBytes <= PUBLIC_TERMS_MAX_BYTES)

  const ready =
    !switchesLoading &&
    step1Ready &&
    step2Ready &&
    !problem &&
    (!isSell || sellDetailsReady)

  const updateActiveDraft = (
    patch: Partial<{
      holderName: string
      accountNumber: string
      bankOrBranch: string
      branchName: string
      routingNumber: string
      notes: string
    }>,
  ) => {
    if (activeVaultBit === undefined) return
    setMethodDrafts((prev) => {
      const cur = prev[activeVaultBit] ?? {
        holderName,
        accountNumber: '',
        bankOrBranch: '',
        branchName: '',
        routingNumber: '',
        notes: '',
      }
      const next = { ...cur, ...patch }
      return { ...prev, [activeVaultBit]: next }
    })
    if (patch.holderName !== undefined) {
      setHolderName(patch.holderName)
    }
  }

  const toggle = (bit: number) => {
    const removing = bits.includes(bit)
    const nextBits = removing ? bits.filter((x) => x !== bit) : [...bits, bit]
    setBits(nextBits)
    if (nextBits.length > 0 && activeVaultIdx >= nextBits.length) {
      setActiveVaultIdx(nextBits.length - 1)
    }

    if (isSell) {
      if (!removing) {
        const match = savedMethods.find((sm) => sm.methodBit === bit)
        setMethodDrafts((prev) => {
          if (prev[bit]?.accountNumber) return prev
          return {
            ...prev,
            [bit]: match
              ? {
                  holderName: match.holderName,
                  accountNumber: match.accountNumber,
                  bankOrBranch: match.bankOrBranch,
                  branchName: match.branchName ?? '',
                  routingNumber: match.routingNumber ?? '',
                  notes: match.notes,
                }
              : {
                  holderName: holderName || savedMethods[0]?.holderName || '',
                  accountNumber: '',
                  bankOrBranch: '',
                  branchName: '',
                  routingNumber: '',
                  notes: '',
                },
          }
        })
        if (match && !holderName) setHolderName(match.holderName)
      }
      if (!useSealedVault) {
        const picked: SavedPaymentMethod[] = []
        for (const b of nextBits) {
          const match = savedMethods.find((sm) => sm.methodBit === b)
          if (match) picked.push(match)
        }
        if (picked.length > 0) {
          setHolderName(picked[0]!.holderName)
          const block = picked.map((m) => formatSavedMethodLine(m, true)).join('\n')
          setDetails(truncateUtf8(block, DETAILS_MAX_BYTES))
        }
      }
    }
  }

  const applySavedMethod = (item: SavedPaymentMethod) => {
    setHolderName(item.holderName)
    setMethodDrafts((prev) => ({
      ...prev,
      [item.methodBit]: {
        holderName: item.holderName,
        accountNumber: item.accountNumber,
        bankOrBranch: item.bankOrBranch,
        branchName: item.branchName ?? '',
        routingNumber: item.routingNumber ?? '',
        notes: item.notes,
      },
    }))
    const idx = bits.indexOf(item.methodBit)
    if (idx >= 0) setActiveVaultIdx(idx)
    if (!useSealedVault) {
      const matchingForOtherBits = bits
        .filter((b) => b !== item.methodBit)
        .map((b) => savedMethods.find((sm) => sm.methodBit === b))
        .filter((x): x is SavedPaymentMethod => !!x)
      const combined = [item, ...matchingForOtherBits]
      const block = combined.map((m) => formatSavedMethodLine(m, true)).join('\n')
      setDetails(truncateUtf8(block, DETAILS_MAX_BYTES))
    }
  }

  const submit = async () => {
    const escrow = getEscrowConfig(asset).escrowAddress
    if (!ready || !escrow || !address) return
    if (requiredUsdc > 0n && (allowance ?? 0n) < requiredUsdc) {
      const ok = await approveUsdc(requiredUsdc)
      if (!ok) return
    }

    const trimmedPublicTerms = publicTerms.trim()
    const onchainPublicTerms = truncateUtf8(trimmedPublicTerms, DETAILS_MAX_BYTES)
    let modeArg: number = DETAILS_MODE.PLAIN
    let hashArg: `0x${string}` = ZERO_BYTES32
    let detailsArg = isSell ? details.trim() : onchainPublicTerms
    let sealedBlobId: string | null = null

    if (sealedEnabled) {
      modeArg = DETAILS_MODE.AUTO
      if (isSell) {
        setSealing(true)
        try {
          const res = await sealDetails({
            kind: 'ad_details',
            holderName: effectiveHolderName,
            accountDetails: serializedVaultDetails.trim(),
            notes: trimmedPublicTerms,
          })
          sealedBlobId = res.id
          hashArg = res.contentHash
          detailsArg = onchainPublicTerms
        } catch (err) {
          toast.error(err instanceof BackendApiError ? err.message : 'Wallet sign-in or vault encryption was cancelled.')
          setSealing(false)
          return
        }
        setSealing(false)
      } else {
        hashArg = keccak256(toBytes(`buy-ad-mode2:${address.toLowerCase()}:${trimmedPublicTerms}`))
        detailsArg = onchainPublicTerms
      }
    }

    const receipt = await runWithReceipt('createAd', 'Post ad', () =>
      writeContractAsync({
        address: escrow,
        abi: p2pEscrowAbi,
        functionName: 'createAd',
        args: [
          side,
          currencyToHex(country.currency),
          priceE6,
          totalRaw,
          minRaw,
          maxRaw,
          bitsToMask(bits),
          windowMin,
          minTaker,
          ttlHours,
          modeArg,
          hashArg,
          detailsArg,
        ],
        chainId: CHAIN_ID,
      }),
    )
    if (receipt) {
      setActiveMarketAsset(asset)
      const needsExtendedTerms = trimmedPublicTerms.length > 0 && publicTermsBytes > DETAILS_MAX_BYTES
      if (sealedBlobId || needsExtendedTerms) {
        let minedRawId: bigint | undefined
        try {
          const parsed = parseEventLogs({
            abi: p2pEscrowAbi,
            eventName: 'AdCreated',
            logs: receipt.logs,
          })
          minedRawId = parsed[0]?.args.adId
        } catch {
          minedRawId = undefined
        }
        if (minedRawId === undefined && publicClient) {
          const adIds = await publicClient
            .readContract({
              address: escrow,
              abi: p2pEscrowAbi,
              functionName: 'getUserAdIds',
              args: [address],
            })
            .catch(() => [] as readonly bigint[])
          minedRawId = adIds[adIds.length - 1]
        }
        if (minedRawId !== undefined) {
          const scopedAdId = encodeScopedId(asset, minedRawId)
          if (sealedBlobId) {
            await bindAdDetails(sealedBlobId, scopedAdId)
          }
          if (needsExtendedTerms) {
            await apiFetch(`/ads/${scopedAdId.toString()}/terms`, {
              method: 'POST',
              body: { terms: trimmedPublicTerms },
            }).catch(() => undefined)
          }
        }
      }
      onDone()
    }
  }

  const stepTitles = [
    { n: 1 as const, label: 'Market & Price' },
    { n: 2 as const, label: 'Payment & Rules' },
    { n: 3 as const, label: 'Details & Confirm' },
  ]

  return (
    <div className="space-y-4">
      {/* 3-Step Wizard Progress Indicator */}
      <div className="grid grid-cols-3 gap-2">
        {stepTitles.map((s) => {
          const active = step === s.n
          const done = step > s.n
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => {
                if (s.n === 1) setStep(1)
                else if (s.n === 2 && step1Ready) setStep(2)
                else if (s.n === 3 && step1Ready && step2Ready) setStep(3)
              }}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                active
                  ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                  : done
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
              }`}
            >
              <span
                className={`p2p-mono flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  active
                    ? 'bg-[#FF5A00] text-white'
                    : done
                      ? 'bg-emerald-500 text-white'
                      : 'border border-[var(--p2p-border)] text-[var(--p2p-muted)]'
                }`}
              >
                {done ? <Check className="size-3" /> : s.n}
              </span>
              <span className="truncate">{s.label}</span>
            </button>
          )
        })}
      </div>

      {/* ================= STEP 1: MARKET & PRICING ================= */}
      {step === 1 && (
        <div className="space-y-4">
          <div role="tablist" className="grid grid-cols-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-1">
            {[
              { v: SIDE_SELL, label: `Sell ${asset} (Lock Escrow)` },
              { v: SIDE_BUY, label: `Buy ${asset}` },
            ].map((o) => {
              const active = side === o.v
              return (
                <button
                  key={o.v}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSide(o.v)}
                  className={`min-h-10 rounded-md text-xs font-bold transition-colors sm:text-sm ${
                    active ? 'bg-[#FF5A00] text-[#FFFFFF]' : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                  }`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>

          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
              Cryptocurrency Asset
            </span>
            <div className="grid grid-cols-2 gap-2">
              {VISIBLE_P2P_ASSETS.map((a) => {
                const active = asset === a
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => {
                      if (a !== asset) {
                        setAsset(a)
                        setTotal('')
                        setMin('')
                        setMax('')
                      }
                    }}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg border py-2 text-xs font-bold transition-colors ${
                      active
                        ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                        : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)] hover:border-[#FF5A00]'
                    }`}
                  >
                    <CoinLogo symbol={a} size={15} />
                    <span>{a}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
              Fiat Market
            </span>
            <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Currency">
              {COUNTRIES.map((c) => {
                const active = c.code === countryCode
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => {
                      setCountryCode(c.code)
                      setBits([])
                    }}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                        : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                    }`}
                  >
                    <CountryFlag code={c.code} size={14} />
                    {c.currency}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Price per 1 {asset} ({country.currency})
              </span>
              <div className="p2p-input flex items-center rounded-lg px-3 py-2.5">
                <input
                  inputMode="decimal"
                  value={price}
                  onChange={decimalInput(setPrice, 4)}
                  placeholder="0.00"
                  className="p2p-mono w-full bg-transparent text-base font-bold text-[var(--p2p-ink)] outline-none"
                />
                <span className="text-xs font-bold text-[var(--p2p-muted)]">{country.currency}</span>
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                <span>{isSell ? `${asset} to Lock` : 'Total Buy Target'}</span>
                {balance !== undefined && (
                  <span className="p2p-mono normal-case text-[#FF5A00]">
                    Bal: {formatUsdcAmount(balance, undefined, asset)}
                  </span>
                )}
              </span>
              <div className="p2p-input flex items-center rounded-lg px-3 py-2.5">
                <input
                  inputMode="decimal"
                  value={total}
                  onChange={decimalInput(setTotal, tokenDecimals)}
                  placeholder={asset === 'cirBTC' ? '0.01' : asset === 'WETH' ? '0.1' : '100.00'}
                  className="p2p-mono w-full bg-transparent text-base font-bold text-[var(--p2p-ink)] outline-none"
                />
                {isSell && balance !== undefined && (
                  <button
                    type="button"
                    onClick={fillMaxTotal}
                    className="mr-2 text-xs font-bold text-[#FF5A00] hover:opacity-80"
                  >
                    Max
                  </button>
                )}
                <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--p2p-ink)]">
                  <CoinLogo symbol={asset} size={14} /> {asset}
                </span>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Min Order ({asset})
              </span>
              <input
                inputMode="decimal"
                value={min}
                onChange={decimalInput(setMin, tokenDecimals)}
                placeholder={asset === 'cirBTC' ? '0.001' : asset === 'WETH' ? '0.01' : '10'}
                className="p2p-input p2p-mono w-full rounded-lg px-3 py-2.5 text-sm font-semibold"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Max Order ({asset})
              </span>
              <input
                inputMode="decimal"
                value={max}
                onChange={decimalInput(setMax, tokenDecimals)}
                placeholder={asset === 'cirBTC' ? '0.01' : asset === 'WETH' ? '0.1' : '500'}
                className="p2p-input p2p-mono w-full rounded-lg px-3 py-2.5 text-sm font-semibold"
              />
            </label>
          </div>

          {lowNativeGas && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] p-3 text-xs text-[var(--p2p-warn-ink)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Low native USDC gas balance ({formatUsdcAmount(nativeUsdcBalance ?? 0n)} USDC). Keep at least 0.05–0.10 USDC free on Arc for transaction gas.
              </span>
            </div>
          )}

          {(step1Problem || blocked) && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] p-3 text-xs text-[#FF5A00]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{blocked ?? step1Problem}</span>
            </div>
          )}

          <button
            type="button"
            disabled={!step1Ready}
            onClick={() => setStep(2)}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-sm font-bold text-[#FFFFFF] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next: Payment &amp; Rules <ArrowRight className="size-4" />
          </button>
        </div>
      )}

      {/* ================= STEP 2: PAYMENT & RULES ================= */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
              Accepted Payment Methods ({country.name})
            </span>
            <div className="flex flex-wrap gap-2">
              {methods.map((m) => {
                const active = bits.includes(m.bit)
                const savedForBit = savedMethods.find((sm) => sm.methodBit === m.bit)
                return (
                  <button
                    key={m.bit}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle(m.bit)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[var(--p2p-ink)]'
                        : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                    }`}
                    style={{ borderLeft: '3px solid #FF5A00' }}
                  >
                    <MethodLogo name={m.name} size={14} />
                    <span>{m.name}</span>
                    {savedForBit && (
                      <span className="p2p-mono rounded bg-[#FF5A00]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#FF5A00]">
                        ••{savedForBit.accountNumber.slice(-4)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Payment Window
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {[15, 30, 45, 60].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setWindowMin(m)}
                    className={`p2p-mono rounded-lg border py-2 text-xs font-semibold transition-colors ${
                      windowMin === m
                        ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                        : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Ad Expiry (TTL)
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {TTL_OPTIONS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setTtlHours(h)}
                    className={`p2p-mono rounded-lg border py-2 text-xs font-semibold transition-colors ${
                      ttlHours === h
                        ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                        : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                    }`}
                  >
                    {ttlLabel(h).split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
              Counterparty Requirement
            </span>
            <div className="flex flex-wrap gap-1.5">
              {MIN_TAKER_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMinTaker(n)}
                  className={`p2p-mono rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    minTaker === n
                      ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                      : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                  }`}
                >
                  {n === 0 ? 'Anyone' : `${n}+ trades`}
                </button>
              ))}
            </div>
          </div>

          {/* Public Maker Terms — Separate & Public (NOT encrypted), shown as Advertisers' Terms */}
          {(useSealedVault || !isSell) && (
            <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--p2p-ink)]">
                  Public Maker Terms (Advertisers&apos; Terms — Optional)
                </span>
                <span
                  className={`p2p-mono text-[11px] ${
                    publicTermsBytes > PUBLIC_TERMS_MAX_BYTES ? 'font-bold text-red-400' : 'text-[var(--p2p-muted)]'
                  }`}
                >
                  {publicTermsBytes}/{PUBLIC_TERMS_MAX_BYTES}B
                </span>
              </div>
              <textarea
                value={publicTerms}
                onChange={(e) => setPublicTerms(e.target.value)}
                rows={4}
                placeholder="e.g. No third-party payments accepted. Send from your verified personal account only. Do not mention crypto in bank remarks."
                className="p2p-input w-full resize-none rounded-lg !bg-[var(--p2p-surface-solid)] px-3 py-2.5 text-xs leading-relaxed text-[var(--p2p-ink)]"
              />
              {publicTermsBytes > PUBLIC_TERMS_MAX_BYTES && (
                <p className="text-[11px] font-semibold text-red-400">
                  Public maker terms exceed {PUBLIC_TERMS_MAX_BYTES} bytes. Please shorten slightly.
                </p>
              )}
              <p className="text-[11px] leading-relaxed text-[var(--p2p-muted)]">
                Displayed publicly as <strong className="text-[var(--p2p-ink)]">Advertisers&apos; Terms</strong> before a
                counterparty opens an order (stored onchain, not encrypted). Never put bank account or mobile wallet
                numbers here — your payment method details are encrypted separately in the next step.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-bold text-[var(--p2p-ink)] hover:border-[#FF5A00]"
            >
              <ArrowLeft className="size-4" /> Back
            </button>
            <button
              type="button"
              disabled={!step2Ready}
              onClick={() => setStep(3)}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next: Details &amp; Confirm <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* ================= STEP 3: DETAILS & CONFIRM ================= */}
      {step === 3 && (
        <div className="space-y-4">
          {isSell && savedMethods.some((sm) => bits.includes(sm.methodBit)) && (
            <div className="rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-bold uppercase tracking-wider text-[#FF5A00]">
                  Auto-Filled from Saved Payment Methods
                </span>
                <span className="text-[var(--p2p-muted)]">Tap to switch account</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {savedMethods
                  .filter((sm) => bits.includes(sm.methodBit))
                  .map((sm) => {
                    const draft = methodDrafts[sm.methodBit]
                    const included = useSealedVault
                      ? draft?.accountNumber === sm.accountNumber
                      : details.includes(sm.accountNumber)
                    return (
                      <button
                        key={sm.id}
                        type="button"
                        onClick={() => applySavedMethod(sm)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                          included
                            ? 'border-[#FF5A00] bg-[#FF5A00] text-white'
                            : 'border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-ink)] hover:border-[#FF5A00]'
                        }`}
                      >
                        <MethodLogo name={sm.methodName} size={14} />
                        <span>{sm.methodName}</span>
                        <span className="p2p-mono text-[11px] opacity-90">••{sm.accountNumber.slice(-4)}</span>
                        {included && <Check className="size-3" />}
                      </button>
                    )
                  })}
              </div>
            </div>
          )}

          {useSealedVault ? (
            <div className="space-y-3 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#FF5A00]">
                  <Lock className="size-3.5" /> Encrypted Vault Details (Mode 2 Auto-Reveal)
                </span>
                <AppLink to="/privacy" className="text-[11px] font-semibold text-[#FF5A00] underline">
                  Operator encryption notice
                </AppLink>
              </div>
              <p className="text-[11px] text-[var(--p2p-muted)]">
                Your receiving accounts are encrypted offchain (AES-256-GCM) and revealed only to an active order&apos;s
                buyer and arbiter. Only the ciphertext hash goes onchain.
              </p>

              {/* Arrow Carousel Header for Multi-Method Vault Details */}
              {activeVaultMethod && activeVaultDraft && (
                <div className="space-y-3 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-3.5">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--p2p-border)] pb-2.5">
                    <div className="flex items-center gap-2">
                      <MethodLogo name={activeVaultMethod.name} size={18} />
                      <span className="text-xs font-bold text-[var(--p2p-ink)]">{activeVaultMethod.name}</span>
                      <span className="p2p-mono rounded bg-[var(--p2p-tint)] px-1.5 py-0.5 text-[10px] font-bold text-[#FF5A00]">
                        {safeVaultIdx + 1} / {bits.length}
                      </span>
                    </div>
                    {bits.length > 1 && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Previous payment method"
                          onClick={() => setActiveVaultIdx((i) => (i - 1 + bits.length) % bits.length)}
                          className="inline-flex size-7 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)] hover:border-[#FF5A00]"
                        >
                          <ChevronLeft className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Next payment method"
                          onClick={() => setActiveVaultIdx((i) => (i + 1) % bits.length)}
                          className="inline-flex size-7 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)] hover:border-[#FF5A00]"
                        >
                          <ChevronRight className="size-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid items-end gap-2.5 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                        Account Holder Name (KYC)
                      </span>
                      <input
                        value={activeVaultDraft.holderName}
                        onChange={(e) => updateActiveDraft({ holderName: e.target.value.slice(0, 80) })}
                        placeholder="Full name on your bank / mobile wallet"
                        className="p2p-input h-10 w-full rounded-lg px-3 text-xs font-medium"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                        {activeVaultMethod.name === 'Bank transfer'
                          ? 'Bank Account Number / IBAN *'
                          : `${activeVaultMethod.name} Number / ID *`}
                      </span>
                      <input
                        value={activeVaultDraft.accountNumber}
                        onChange={(e) => updateActiveDraft({ accountNumber: e.target.value.slice(0, 160) })}
                        placeholder={
                          activeVaultMethod.name === 'Bank transfer'
                            ? 'e.g. 01234567896'
                            : activeVaultMethod.name === 'UPI'
                              ? 'e.g. name@okaxis'
                              : 'e.g. 017XXXXXXXX'
                        }
                        className="p2p-input p2p-mono h-10 w-full rounded-lg px-3 text-xs font-bold"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                        {activeVaultMethod.name === 'Bank transfer' ? 'Bank Name' : 'Account Type'}
                      </span>
                      <input
                        value={activeVaultDraft.bankOrBranch}
                        onChange={(e) => updateActiveDraft({ bankOrBranch: e.target.value.slice(0, 120) })}
                        placeholder={activeVaultMethod.name === 'Bank transfer' ? 'e.g. The City Bank' : 'e.g. Personal'}
                        className="p2p-input h-10 w-full rounded-lg px-3 text-xs"
                      />
                    </label>

                    {activeVaultMethod.name === 'Bank transfer' && (
                      <>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                            Branch Name (Optional)
                          </span>
                          <input
                            value={activeVaultDraft.branchName}
                            onChange={(e) => updateActiveDraft({ branchName: e.target.value.slice(0, 120) })}
                            placeholder="e.g. Gulshan Branch"
                            className="p2p-input h-10 w-full rounded-lg px-3 text-xs"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                            Routing Number (Optional)
                          </span>
                          <input
                            value={activeVaultDraft.routingNumber}
                            onChange={(e) => updateActiveDraft({ routingNumber: e.target.value.slice(0, 60) })}
                            placeholder="e.g. 225261729"
                            className="p2p-input p2p-mono h-10 w-full rounded-lg px-3 text-xs"
                          />
                        </label>
                      </>
                    )}

                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                        Method Remarks (Optional — Shown Only on {activeVaultMethod.name})
                      </span>
                      <input
                        value={activeVaultDraft.notes}
                        onChange={(e) => updateActiveDraft({ notes: e.target.value.slice(0, 160) })}
                        placeholder="e.g. Send Money only"
                        className="p2p-input h-10 w-full rounded-lg px-3 text-xs"
                      />
                    </label>
                  </div>

                  {missingSealedMethod && (
                    <p className="text-[11px] font-semibold text-[#FF5A00]">
                      Use the arrows above to ensure every selected payment method has an account number.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : isSell ? (
            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                <span>Receiving Account Details</span>
                <span className="p2p-mono normal-case">
                  {detailBytes}/{DETAILS_MAX_BYTES}B
                </span>
              </span>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={2}
                placeholder="e.g. bKash Personal 01XXXXXXXXX (Account Holder Name) or name@upi"
                className="p2p-input p2p-mono w-full resize-none rounded-lg px-3 py-2 text-xs"
              />
            </label>
          ) : null}

          {(useSealedVault || !isSell) && publicTerms.trim() && (
            <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--p2p-muted)]">
                  Public Advertisers&apos; Terms (Not Encrypted)
                </span>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="text-[11px] font-bold text-[#FF5A00] hover:underline"
                >
                  Edit
                </button>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[var(--p2p-ink)]">{publicTerms}</p>
            </div>
          )}

          <div className="space-y-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--p2p-muted)]">Ad Summary</span>
              <span className="p2p-mono font-bold text-[var(--p2p-ink)]">
                {isSell ? 'SELL' : 'BUY'} {total || '0'} {asset} @ {price || '0'} {country.currency}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--p2p-muted)]">Listing fee (per ad, non-refundable)</span>
              <span className="p2p-mono font-bold text-[#FF5A00]">
                Listing fee {formatUsdcAmount(listingFee, undefined, asset)} {asset}
              </span>
            </div>
            <div className="flex items-start gap-2.5 border-t border-[var(--p2p-border)] pt-2 text-[var(--p2p-muted)]">
              {account?.merchant ? (
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#FF5A00]" />
              ) : (
                <Lock className="mt-0.5 size-4 shrink-0 text-[#FF5A00]" />
              )}
              <span>
                {isSell
                  ? `Total approval & pull: ${formatUsdcAmount(requiredUsdc, undefined, asset)} ${asset} (${totalRaw > 0n ? formatUsdcAmount(totalRaw, undefined, asset) : '0.00'} ${asset} escrow + ${formatUsdcAmount(listingFee, undefined, asset)} ${asset} listing fee). Refreshing ads & trading are free.`
                  : account?.merchant
                    ? `Verified Merchant active — ${formatUsdcAmount(listingFee, undefined, asset)} ${asset} listing fee pulled on creation; refreshing & trades are free.`
                    : `Buy Ads require Merchant Margin >= ${formatUsdcAmount(minMerchantMargin, undefined, asset)} ${asset} or ${BUY_AD_MIN_COMPLETED}+ qualifying trades (>= 10 ${asset} each with different counterparties), plus ${formatUsdcAmount(listingFee, undefined, asset)} ${asset} listing fee.`}
              </span>
            </div>
          </div>

          {lowNativeGas && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] p-3 text-xs text-[var(--p2p-warn-ink)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Low native USDC gas balance ({formatUsdcAmount(nativeUsdcBalance ?? 0n)} USDC). Keep at least 0.05–0.10 USDC free on Arc for transaction gas.
              </span>
            </div>
          )}

          {(problem || blocked) && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] p-3 text-xs text-[#FF5A00]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{blocked ?? problem}</span>
            </div>
          )}

          <div className="grid grid-cols-[auto_1fr] gap-2.5">
            <button
              type="button"
              disabled={busy || sealing}
              onClick={() => setStep(2)}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-bold text-[var(--p2p-ink)] hover:border-[#FF5A00] disabled:opacity-40"
            >
              <ArrowLeft className="size-4" /> Back
            </button>
            {isConnected ? (
              <button
                type="button"
                disabled={!ready || busy || sealing}
                onClick={() => void submit()}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
              >
                {(busy || sealing) && <Loader2 className="size-4 animate-spin" />}
                {sealing
                  ? 'Encrypting Details in Vault...'
                  : pendingKey === 'approve'
                    ? `Approve ${asset} in Wallet...`
                    : busy
                      ? 'Confirming in Wallet...'
                      : isSell
                        ? `Lock ${totalRaw > 0n ? formatUsdcAmount(totalRaw, undefined, asset) : '0.00'} ${asset} (+${formatUsdcAmount(listingFee, undefined, asset)} Fee) & Post`
                        : `Post Buy Ad (${formatUsdcAmount(listingFee, undefined, asset)} ${asset} Fee)`}
              </button>
            ) : (
              <ConnectWalletCustom>
                {({ show }) => (
                  <button
                    type="button"
                    onClick={show}
                    className="min-h-11 w-full rounded-lg bg-[#FF5A00] px-5 text-sm font-bold text-[#FFFFFF] hover:opacity-90"
                  >
                    Connect Wallet
                  </button>
                )}
              </ConnectWalletCustom>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
