import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount, usePublicClient } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, Lock, ShieldCheck, X } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  BUY_AD_MIN_COMPLETED,
  CHAIN_ID,
  COUNTRIES,
  DEFAULT_TTL_HOURS,
  DETAILS_MAX_BYTES,
  DETAILS_MODE,
  ESCROW_ADDRESS,
  MERCHANT_MARGIN,
  MIN_TAKER_OPTIONS,
  SIDE_BUY,
  SIDE_SELL,
  TTL_OPTIONS,
  ZERO_BYTES32,
  bitsToMask,
  currencyToHex,
  formatUsdcAmount,
  methodsForCountry,
} from '@/lib/p2p'
import { parseUnitsExact } from '@/onchain-money'
import { useListingFee, usePrivacySwitches, useUsdcAllowance, useUsdcBalance } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { AppLink } from '@/components/AppLink'
import { CountryFlag } from '@/components/logos'
import { useEligibility } from '@/hooks/useEligibility'
import { BackendApiError } from '@/lib/api'
import { useVaultActions } from '@/hooks/useVault'

const safe = (v: string): bigint => {
  try {
    return v ? parseUnitsExact(v, 6) : 0n
  } catch {
    return 0n
  }
}

const decimalInput = (setter: (v: string) => void, places: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
  const v = e.target.value.replace(/[^0-9.]/g, '')
  if (new RegExp(`^\\d*\\.?\\d{0,${places}}$`).test(v)) setter(v)
}

const ttlLabel = (h: number) => (h >= 24 && h % 24 === 0 ? `${h / 24}d (${h}h)` : `${h}h`)

export function PostAdSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
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
              <PostAdForm onDone={onClose} />
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function PostAdForm({ onDone }: { onDone: () => void }) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const balance = useUsdcBalance()
  const allowance = useUsdcAllowance()
  const listingFee = useListingFee()
  const { sealedEnabled, isLoading: switchesLoading } = usePrivacySwitches()
  const { sealDetails, bindAdDetails } = useVaultActions()
  const { run, approveUsdc, writeContractAsync, pendingKey, busy } = useTx()
  const { blocked, account } = useEligibility()

  const [side, setSide] = useState<number>(SIDE_SELL)
  const [countryCode, setCountryCode] = useState('BD')
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
  const [minTaker, setMinTaker] = useState(0)
  const [sealing, setSealing] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const country = COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0]
  const methods = methodsForCountry(country.code)
  const priceE6 = safe(price)
  const totalRaw = safe(total)
  const minRaw = safe(min)
  const maxRaw = safe(max)
  const isSell = side === SIDE_SELL
  const useSealedVault = sealedEnabled && isSell
  const onchainText = useSealedVault ? publicTerms : details
  const detailBytes = useMemo(() => new TextEncoder().encode(onchainText).length, [onchainText])
  const requiredUsdc = (isSell ? totalRaw : 0n) + listingFee

  const buyAdBlocked =
    !isSell &&
    isConnected &&
    !!account &&
    !account.merchant &&
    account.ordersCompleted < BUY_AD_MIN_COMPLETED

  let problem: string | null = null
  if (buyAdBlocked) {
    problem = `Buy ads require Merchant Margin >= ${formatUsdcAmount(MERCHANT_MARGIN, 0)} USDC or ${BUY_AD_MIN_COMPLETED}+ completed trades (you have ${account.ordersCompleted}).`
  } else if (!isSell && isConnected && balance !== undefined && listingFee > balance) {
    problem = `Insufficient wallet balance for the ${formatUsdcAmount(listingFee)} USDC listing fee (${formatUsdcAmount(balance)} USDC available).`
  } else if (totalRaw > 0n && minRaw > 0n && maxRaw > 0n) {
    if (minRaw > maxRaw) problem = 'Minimum order cannot exceed maximum order.'
    else if (maxRaw > totalRaw) problem = 'Maximum order cannot exceed total amount.'
    else if (balance !== undefined && requiredUsdc > balance)
      problem = `Insufficient wallet balance (${formatUsdcAmount(balance)} USDC available; ${formatUsdcAmount(requiredUsdc)} USDC needed with listing fee).`
  }
  if (!problem && detailBytes > DETAILS_MAX_BYTES) {
    problem = useSealedVault ? 'Public maker terms exceed 200 bytes.' : 'Payment details exceed 200 bytes.'
  }
  if (!problem && useSealedVault && details.trim().length > 400) {
    problem = 'Encrypted receiving details exceed 400 characters.'
  }

  const sellDetailsReady = useSealedVault
    ? holderName.trim().length >= 2 && details.trim().length >= 2
    : details.trim().length > 0

  const step1Ready =
    !blocked &&
    !buyAdBlocked &&
    priceE6 > 0n &&
    totalRaw > 0n &&
    minRaw > 0n &&
    maxRaw > 0n &&
    minRaw <= maxRaw &&
    maxRaw <= totalRaw &&
    (balance === undefined || requiredUsdc <= balance)

  const step2Ready = bits.length > 0 && ttlHours >= 1 && ttlHours <= 168

  const ready =
    !switchesLoading &&
    step1Ready &&
    step2Ready &&
    !problem &&
    (!isSell || sellDetailsReady)

  const toggle = (bit: number) =>
    setBits((b) => (b.includes(bit) ? b.filter((x) => x !== bit) : [...b, bit]))

  const submit = async () => {
    const escrow = ESCROW_ADDRESS
    if (!ready || !escrow || !address) return
    if (requiredUsdc > 0n && (allowance ?? 0n) < requiredUsdc) {
      const ok = await approveUsdc(requiredUsdc)
      if (!ok) return
    }

    let modeArg: number = DETAILS_MODE.PLAIN
    let hashArg: `0x${string}` = ZERO_BYTES32
    let detailsArg = details.trim()
    let sealedBlobId: string | null = null

    if (sealedEnabled) {
      modeArg = DETAILS_MODE.AUTO
      if (isSell) {
        setSealing(true)
        try {
          const res = await sealDetails({
            kind: 'ad_details',
            holderName: holderName.trim(),
            accountDetails: details.trim(),
            notes: publicTerms.trim(),
          })
          sealedBlobId = res.id
          hashArg = res.contentHash
          detailsArg = publicTerms.trim()
        } catch (err) {
          toast.error(err instanceof BackendApiError ? err.message : 'Wallet sign-in or vault encryption was cancelled.')
          setSealing(false)
          return
        }
        setSealing(false)
      } else {
        hashArg = keccak256(toBytes(`buy-ad-mode2:${address.toLowerCase()}:${details.trim()}`))
        detailsArg = details.trim()
      }
    }

    const ok = await run('createAd', 'Post ad', () =>
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
    if (ok) {
      if (sealedBlobId && publicClient) {
        void publicClient
          .readContract({
            address: escrow,
            abi: p2pEscrowAbi,
            functionName: 'getUserAdIds',
            args: [address],
          })
          .then((adIds) => {
            const latest = adIds[adIds.length - 1]
            if (latest !== undefined) return bindAdDetails(sealedBlobId!, latest)
          })
          .catch(() => undefined)
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
              { v: SIDE_SELL, label: 'Sell USDC (Lock Escrow)' },
              { v: SIDE_BUY, label: 'Buy USDC' },
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
                Price per 1 USDC ({country.currency})
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
                <span>{isSell ? 'USDC to Lock' : 'Total Buy Target'}</span>
                {balance !== undefined && (
                  <span className="p2p-mono normal-case text-[#FF5A00]">Bal: {formatUsdcAmount(balance)}</span>
                )}
              </span>
              <div className="p2p-input flex items-center rounded-lg px-3 py-2.5">
                <input
                  inputMode="decimal"
                  value={total}
                  onChange={decimalInput(setTotal, 6)}
                  placeholder="100.00"
                  className="p2p-mono w-full bg-transparent text-base font-bold text-[var(--p2p-ink)] outline-none"
                />
                <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--p2p-ink)]">
                  <TokenUSDC variant="branded" size={14} /> USDC
                </span>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Min Order (USDC)
              </span>
              <input
                inputMode="decimal"
                value={min}
                onChange={decimalInput(setMin, 6)}
                placeholder="10"
                className="p2p-input p2p-mono w-full rounded-lg px-3 py-2.5 text-sm font-semibold"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Max Order (USDC)
              </span>
              <input
                inputMode="decimal"
                value={max}
                onChange={decimalInput(setMax, 6)}
                placeholder="500"
                className="p2p-input p2p-mono w-full rounded-lg px-3 py-2.5 text-sm font-semibold"
              />
            </label>
          </div>

          {(problem || blocked) && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] p-3 text-xs text-[#FF5A00]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{blocked ?? problem}</span>
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
                return (
                  <button
                    key={m.bit}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle(m.bit)}
                    className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[var(--p2p-ink)]'
                        : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                    }`}
                    style={{ borderLeft: '3px solid #FF5A00' }}
                  >
                    {m.name}
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
                Your account number is encrypted offchain (AES-256-GCM) and revealed only to an active order&apos;s buyer
                and arbiter. Only the ciphertext hash goes onchain.
              </p>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                  Account Holder Full Name (Matched Against KYC)
                </span>
                <input
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value.slice(0, 80))}
                  placeholder="Full name on your bank / mobile wallet"
                  className="p2p-input h-10 w-full rounded-lg px-3 text-xs font-medium"
                />
              </label>
              <label className="block">
                <span className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                  <span>Receiving Account / UPI / Wallet Number</span>
                  <span className="p2p-mono normal-case">{details.length}/400</span>
                </span>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value.slice(0, 400))}
                  rows={2}
                  placeholder="e.g. bKash Personal 01XXXXXXXXX or name@okaxis"
                  className="p2p-input p2p-mono w-full resize-none rounded-lg px-3 py-2 text-xs"
                />
              </label>
              <label className="block">
                <span className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                  <span>Public Maker Terms (Optional — Never Put Account Numbers Here)</span>
                  <span className="p2p-mono normal-case">
                    {detailBytes}/{DETAILS_MAX_BYTES}B
                  </span>
                </span>
                <input
                  value={publicTerms}
                  onChange={(e) => setPublicTerms(e.target.value)}
                  placeholder="e.g. Send from verified personal account only; no remarks"
                  className="p2p-input h-10 w-full rounded-lg px-3 text-xs"
                />
              </label>
            </div>
          ) : (
            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                <span>{isSell ? 'Receiving Account Details' : 'Terms / Note for Sellers (Optional)'}</span>
                <span className="p2p-mono normal-case">
                  {detailBytes}/{DETAILS_MAX_BYTES}B
                </span>
              </span>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={2}
                placeholder={
                  isSell
                    ? 'e.g. bKash Personal 01XXXXXXXXX (Account Holder Name) or name@upi'
                    : 'e.g. Instant payment from verified account'
                }
                className="p2p-input p2p-mono w-full resize-none rounded-lg px-3 py-2 text-xs"
              />
            </label>
          )}

          <div className="space-y-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--p2p-muted)]">Ad Summary</span>
              <span className="p2p-mono font-bold text-[var(--p2p-ink)]">
                {isSell ? 'SELL' : 'BUY'} {total || '0'} USDC @ {price || '0'} {country.currency}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--p2p-muted)]">Listing fee (per ad, non-refundable)</span>
              <span className="p2p-mono font-bold text-[#FF5A00]">
                Listing fee {formatUsdcAmount(listingFee)} USDC
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
                  ? `Total approval & pull: ${formatUsdcAmount(requiredUsdc)} USDC (${totalRaw > 0n ? formatUsdcAmount(totalRaw) : '0.00'} USDC escrow + ${formatUsdcAmount(listingFee)} USDC listing fee). Refreshing ads & trading are free.`
                  : account?.merchant
                    ? `Verified Merchant active — ${formatUsdcAmount(listingFee)} USDC listing fee pulled on creation; refreshing & trades are free.`
                    : `Buy Ads require Merchant Margin >= 100 USDC or ${BUY_AD_MIN_COMPLETED}+ completed trades, plus ${formatUsdcAmount(listingFee)} USDC listing fee.`}
              </span>
            </div>
          </div>

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
                    ? 'Approve USDC in Wallet...'
                    : busy
                      ? 'Confirming in Wallet...'
                      : isSell
                        ? `Lock ${totalRaw > 0n ? formatUsdcAmount(totalRaw) : '0.00'} USDC (+${formatUsdcAmount(listingFee)} Fee) & Post`
                        : `Post Buy Ad (${formatUsdcAmount(listingFee)} USDC Fee)`}
              </button>
            ) : (
              <ConnectKitButton.Custom>
                {({ show }) => (
                  <button
                    type="button"
                    onClick={show}
                    className="min-h-11 w-full rounded-lg bg-[#FF5A00] px-5 text-sm font-bold text-[#FFFFFF] hover:opacity-90"
                  >
                    Connect Wallet
                  </button>
                )}
              </ConnectKitButton.Custom>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
