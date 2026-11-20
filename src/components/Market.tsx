import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { ChevronDown, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useAds, useAccounts, useMyAccount, useNow, type AdWithId } from '@/hooks/useEscrow'
import {
  COUNTRIES,
  SIDE_BUY,
  SIDE_SELL,
  fiatFor,
  formatPrice,
  formatUsdcAmount,
  hexToCurrency,
  isAdExpired,
  methodsForCountry,
  sameAddr,
} from '@/lib/p2p'
import { parseUnitsExact } from '@/onchain-money'
import { CountryFlag } from '@/components/logos'
import { AdCard } from '@/components/AdCard'
import { MobileOrderSheet } from '@/components/TradeSheet'

function parseFiatFilter(raw: string): bigint | null {
  if (!raw) return null
  try {
    return parseUnitsExact(raw, 6)
  } catch {
    return null
  }
}

export function Market({
  deepAd,
  deepAmount,
  onClearDeepTrade,
  onOpenedOrder,
  onPostAd,
}: {
  deepAd?: AdWithId
  deepAmount?: string
  onClearDeepTrade: () => void
  onOpenedOrder: (orderId: bigint) => void
  onPostAd: () => void
}) {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const { ads, isLoading } = useAds()
  const viewerAccount = useMyAccount()
  const now = useNow()

  const [mode, setMode] = useState<'buy' | 'sell'>('buy')
  const [countryCode, setCountryCode] = useState('BD')
  const [method, setMethod] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [merchantsOnly, setMerchantsOnly] = useState(false)
  const [expandedId, setExpandedId] = useState<bigint | null>(null)
  const [mobileSheetAd, setMobileSheetAd] = useState<AdWithId | null>(null)

  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [mobileFilterPanel, setMobileFilterPanel] = useState<'currency' | 'amount' | 'payment' | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const currencyRef = useRef<HTMLDivElement>(null)
  const paymentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (currencyRef.current && !currencyRef.current.contains(e.target as Node)) setCurrencyOpen(false)
      if (paymentRef.current && !paymentRef.current.contains(e.target as Node)) setPaymentOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const deepCountryCode = deepAd
    ? COUNTRIES.find((c) => c.currency === hexToCurrency(deepAd.currency))?.code
    : undefined
  const activeMode: 'buy' | 'sell' = deepAd ? (deepAd.side === SIDE_SELL ? 'buy' : 'sell') : mode
  const activeCountryCode = deepCountryCode ?? countryCode
  const activeExpandedId = expandedId ?? deepAd?.id ?? null
  const activeMobileAd = mobileSheetAd ?? deepAd ?? null

  const country = COUNTRIES.find((c) => c.code === activeCountryCode) ?? COUNTRIES[0]
  const currencyCode = country.currency
  const wantedSide = activeMode === 'buy' ? SIDE_SELL : SIDE_BUY
  const countryMethods = methodsForCountry(country.code)
  const selectedMethod = method !== null ? countryMethods.find((m) => m.bit === method) : undefined

  const live = useMemo(
    () => ads.filter((ad) => !ad.paused && !ad.closed && ad.available > 0n && !isAdExpired(ad.expiresAt, now)),
    [ads, now],
  )

  const bestByCurrency = useMemo(() => {
    const map = new Map<string, bigint>()
    for (const ad of live) {
      if (ad.side !== wantedSide) continue
      const cur = hexToCurrency(ad.currency)
      const prev = map.get(cur)
      const better = prev === undefined || (activeMode === 'buy' ? ad.priceE6 < prev : ad.priceE6 > prev)
      if (better) map.set(cur, ad.priceE6)
    }
    return map
  }, [live, wantedSide, activeMode])

  const hereAds = live.filter((ad) => hexToCurrency(ad.currency) === currencyCode)
  const sellAds = hereAds.filter((ad) => ad.side === SIDE_SELL)
  const buyAds = hereAds.filter((ad) => ad.side === SIDE_BUY)
  const stats = {
    bestBuy: sellAds.length ? sellAds.reduce((m, a) => (a.priceE6 < m ? a.priceE6 : m), sellAds[0].priceE6) : null,
    bestSell: buyAds.length ? buyAds.reduce((m, a) => (a.priceE6 > m ? a.priceE6 : m), buyAds[0].priceE6) : null,
    liquidity: sellAds.reduce((sum, a) => sum + a.available, 0n),
    liveAds: hereAds.length,
  }

  const fiatFilter = parseFiatFilter(amount)
  const filtered = hereAds
    .filter((ad) => ad.side === wantedSide)
    .filter((ad) => !merchantsOnly || ad.merchantAd)
    .filter((ad) => method === null || (ad.paymentMask & (1 << method)) !== 0)
    .filter((ad) => {
      if (fiatFilter === null) return true
      const lo = fiatFor(ad.minAmount > ad.available ? ad.available : ad.minAmount, ad.priceE6)
      const hi = fiatFor(ad.maxAmount > ad.available ? ad.available : ad.maxAmount, ad.priceE6)
      return fiatFilter >= lo && fiatFilter <= hi
    })
    .sort((a, b) => (activeMode === 'buy' ? Number(a.priceE6 - b.priceE6) : Number(b.priceE6 - a.priceE6)))

  const accounts = useAccounts(filtered.map((a) => a.maker))

  const triggerRefresh = () => {
    setRefreshing(true)
    void queryClient.invalidateQueries().finally(() => {
      setTimeout(() => setRefreshing(false), 450)
    })
  }

  const handleToggleExpand = (next: AdWithId | null) => {
    if (!next) {
      setExpandedId(null)
      onClearDeepTrade()
    } else {
      setExpandedId(next.id)
    }
  }

  const closeMobileSheet = () => {
    setMobileSheetAd(null)
    onClearDeepTrade()
  }

  return (
    <div className="space-y-4">
      {/* =====================================================================
          MOBILE STICKY HEADER & HORIZONTAL FILTER RIBBON (< 768px)
         ===================================================================== */}
      <section className="p2p-card rounded-2xl p-3.5 md:hidden">
        {/* Top Row: Buy | Sell Large Text Toggle + Fiat Pill + Post Ad */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--p2p-border)] pb-2.5">
          <div role="tablist" aria-label="Trade direction" className="flex items-center gap-5">
            {(['buy', 'sell'] as const).map((m) => {
              const active = activeMode === m
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    onClearDeepTrade()
                    setMode(m)
                  }}
                  className={`relative pb-2 text-lg font-bold transition-colors ${
                    active ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)]'
                  }`}
                >
                  {m === 'buy' ? 'Buy' : 'Sell'}
                  {active && <span className="absolute inset-x-0 -bottom-[11px] h-[3px] rounded-full bg-[#FF5A00]" />}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileFilterPanel((p) => (p === 'currency' ? null : 'currency'))}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-xs font-bold text-[var(--p2p-ink)]"
            >
              <CountryFlag code={country.code} size={14} />
              <span>{country.currency}</span>
              <ChevronDown className="size-3.5 text-[var(--p2p-muted)]" />
            </button>

            <button
              type="button"
              onClick={onPostAd}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-[#FF5A00] bg-[var(--p2p-tint)] px-3 text-xs font-bold text-[#FF5A00]"
            >
              <Plus className="size-3.5" /> Ad
            </button>
          </div>
        </div>

        {/* Horizontal Scrollable Filter Ribbon (no scrollbar visible) */}
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pt-3">
          <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-3 text-xs font-bold text-[var(--p2p-ink)]">
            <TokenUSDC variant="branded" size={14} /> USDC
          </span>

          <button
            type="button"
            onClick={() => setMobileFilterPanel((p) => (p === 'amount' ? null : 'amount'))}
            className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold ${
              amount
                ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
            }`}
          >
            <span className="p2p-mono">{amount ? `${country.symbol}${amount}` : 'Amount'}</span>
            <ChevronDown className="size-3" />
          </button>

          <button
            type="button"
            onClick={() => setMobileFilterPanel((p) => (p === 'payment' ? null : 'payment'))}
            className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold ${
              selectedMethod
                ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
            }`}
          >
            <span>Payment: {selectedMethod ? selectedMethod.name : 'All'}</span>
            <ChevronDown className="size-3" />
          </button>

          <button
            type="button"
            aria-pressed={merchantsOnly}
            onClick={() => setMerchantsOnly((v) => !v)}
            className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold ${
              merchantsOnly
                ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
            }`}
          >
            <ShieldCheck className="size-3.5 text-[#FF5A00]" />
            Verified Shield Only
          </button>
        </div>

        {/* Expandable Mobile Filter Drawer (Currency / Amount / Payment) */}
        {mobileFilterPanel === 'currency' && (
          <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-[var(--p2p-border)] pt-3">
            {COUNTRIES.map((c) => {
              const active = c.code === country.code
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => {
                    onClearDeepTrade()
                    setCountryCode(c.code)
                    setMethod(null)
                    setMobileFilterPanel(null)
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold ${
                    active
                      ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                      : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]'
                  }`}
                >
                  <CountryFlag code={c.code} size={16} />
                  <span>
                    {c.currency} ({c.symbol})
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {mobileFilterPanel === 'amount' && (
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--p2p-border)] pt-3">
            <div className="p2p-input flex h-10 flex-1 items-center rounded-xl px-3">
              <span className="mr-1.5 text-xs font-bold text-[var(--p2p-muted)]">{country.symbol}</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, '')
                  if (/^\d*\.?\d{0,2}$/.test(v)) setAmount(v)
                }}
                placeholder={`Enter ${country.currency} amount`}
                className="p2p-mono w-full bg-transparent text-xs font-bold text-[var(--p2p-ink)] outline-none"
              />
              {amount && (
                <button type="button" onClick={() => setAmount('')} className="text-[var(--p2p-muted)]">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setMobileFilterPanel(null)}
              className="h-10 rounded-xl bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF]"
            >
              Done
            </button>
          </div>
        )}

        {mobileFilterPanel === 'payment' && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--p2p-border)] pt-3">
            <button
              type="button"
              onClick={() => {
                setMethod(null)
                setMobileFilterPanel(null)
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                method === null
                  ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                  : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]'
              }`}
            >
              All Payments
            </button>
            {countryMethods.map((m) => {
              const active = method === m.bit
              return (
                <button
                  key={m.bit}
                  type="button"
                  onClick={() => {
                    setMethod(m.bit)
                    setMobileFilterPanel(null)
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    active
                      ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                      : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]'
                  }`}
                  style={{ borderLeft: '3px solid #FF5A00' }}
                >
                  {m.name}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* =====================================================================
          DESKTOP CONTROL & FILTER BAR (>= 768px)
         ===================================================================== */}
      <section className="p2p-card relative z-20 hidden rounded-xl p-4 md:block">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left Group: Buy / Sell Segmented Toggle + Asset Chip */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div
              role="tablist"
              aria-label="Trade direction"
              className="inline-flex rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-1"
            >
              {(['buy', 'sell'] as const).map((m) => {
                const active = activeMode === m
                return (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      onClearDeepTrade()
                      setMode(m)
                      setExpandedId(null)
                    }}
                    className={`min-h-9 rounded-md px-5 text-sm font-bold transition-colors ${
                      active
                        ? 'bg-[#FF5A00] text-[#FFFFFF]'
                        : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                    }`}
                  >
                    {m === 'buy' ? 'Buy USDC' : 'Sell USDC'}
                  </button>
                )
              })}
            </div>

            <span className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] px-3.5 text-xs font-bold text-[var(--p2p-ink)]">
              <TokenUSDC variant="branded" size={16} />
              USDC
            </span>
          </div>

          {/* Center Group: Combined Amount + Fiat Dropdown & Payment Method Dropdown */}
          <div className="flex flex-1 flex-wrap items-center gap-2.5 lg:justify-center">
            <div ref={currencyRef} className="relative flex min-w-[230px] flex-1 sm:max-w-xs">
              <div className="p2p-input flex min-h-11 w-full items-center rounded-lg">
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, '')
                    if (/^\d*\.?\d{0,2}$/.test(v)) setAmount(v)
                  }}
                  placeholder="Transaction amount"
                  aria-label={`Filter by amount in ${country.currency}`}
                  className="p2p-mono w-full bg-transparent px-3 text-sm font-semibold text-[var(--p2p-ink)] outline-none placeholder:font-sans placeholder:font-normal placeholder:text-[var(--p2p-muted)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setCurrencyOpen((o) => !o)
                    setPaymentOpen(false)
                  }}
                  aria-expanded={currencyOpen}
                  className="flex h-full shrink-0 items-center gap-1.5 border-l border-[var(--p2p-border)] px-3 py-2 text-xs font-bold text-[var(--p2p-ink)] hover:text-[#FF5A00]"
                >
                  <CountryFlag code={country.code} size={16} />
                  <span>
                    {country.currency} {country.symbol}
                  </span>
                  <ChevronDown className="size-3.5 text-[var(--p2p-muted)]" />
                </button>
              </div>

              {currencyOpen && (
                <ul
                  role="listbox"
                  className="p2p-glass-popover absolute right-0 top-full z-30 mt-1.5 max-h-72 w-60 overflow-y-auto rounded-xl p-1.5"
                >
                  {COUNTRIES.map((c) => {
                    const active = c.code === country.code
                    const best = bestByCurrency.get(c.currency)
                    return (
                      <li key={c.code}>
                        <button
                          type="button"
                          onClick={() => {
                            onClearDeepTrade()
                            setCountryCode(c.code)
                            setMethod(null)
                            setExpandedId(null)
                            setCurrencyOpen(false)
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                            active
                              ? 'bg-[var(--p2p-tint)] font-bold text-[#FF5A00]'
                              : 'text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)]'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <CountryFlag code={c.code} size={18} />
                            <span>
                              {c.currency} <span className="text-[var(--p2p-muted)]">({c.symbol})</span>
                            </span>
                          </span>
                          <span className="p2p-mono text-[11px] text-[var(--p2p-muted)]">
                            {best !== undefined ? `${c.symbol}${formatPrice(best)}` : c.name}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div ref={paymentRef} className="relative min-w-[180px] flex-1 sm:max-w-[210px]">
              <button
                type="button"
                onClick={() => {
                  setPaymentOpen((o) => !o)
                  setCurrencyOpen(false)
                }}
                aria-expanded={paymentOpen}
                className="p2p-input flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-xs font-semibold text-[var(--p2p-ink)]"
              >
                <span className="flex items-center gap-2 truncate">
                  <span className="h-3.5 w-[3px] shrink-0 rounded-full bg-[#FF5A00]" />
                  <span className="truncate">{selectedMethod ? selectedMethod.name : 'All Payments'}</span>
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-[var(--p2p-muted)]" />
              </button>

              {paymentOpen && (
                <ul
                  role="listbox"
                  className="p2p-glass-popover absolute left-0 top-full z-30 mt-1.5 max-h-72 w-56 overflow-y-auto rounded-xl p-1.5"
                >
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setMethod(null)
                        setPaymentOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                        method === null
                          ? 'bg-[var(--p2p-tint)] font-bold text-[#FF5A00]'
                          : 'text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)]'
                      }`}
                    >
                      <span className="h-3 w-[3px] rounded-full bg-[#FF5A00]" />
                      All Payments
                    </button>
                  </li>
                  {countryMethods.map((m) => {
                    const active = method === m.bit
                    return (
                      <li key={m.bit}>
                        <button
                          type="button"
                          onClick={() => {
                            setMethod(m.bit)
                            setPaymentOpen(false)
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                            active
                              ? 'bg-[var(--p2p-tint)] font-bold text-[#FF5A00]'
                              : 'text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)]'
                          }`}
                        >
                          <span className="h-3 w-[3px] rounded-full bg-[#FF5A00]" />
                          {m.name}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Right Action Group */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={triggerRefresh}
              title="Live auto-refresh active (click to refresh now)"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-xs font-medium text-[var(--p2p-muted)] transition-colors hover:border-[var(--p2p-border-active)] hover:text-[var(--p2p-ink)]"
            >
              <RefreshCw className={`size-3.5 text-[#FF5A00] ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden xl:inline">Auto-refresh</span>
            </button>

            <button
              type="button"
              aria-pressed={merchantsOnly}
              onClick={() => setMerchantsOnly((v) => !v)}
              title="Show Verified Merchants Only (100+ USDC staked)"
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                merchantsOnly
                  ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                  : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
              }`}
            >
              <ShieldCheck className="size-3.5 text-[#FF5A00]" />
              <span>Merchants Only</span>
            </button>

            <button
              type="button"
              onClick={onPostAd}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[#FF5A00] bg-transparent px-3.5 text-xs font-bold text-[#FF5A00] transition-colors hover:bg-[var(--p2p-tint)]"
            >
              <Plus className="size-4" /> Post Ad
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 border-t border-[var(--p2p-border)] pt-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-[var(--p2p-muted)]">
              Market: <strong className="text-[var(--p2p-ink)]">{country.name} ({country.currency})</strong>
            </span>
            <span className="text-[var(--p2p-muted)]">
              Best Buy:{' '}
              <span className="p2p-mono font-semibold text-[var(--p2p-ink)]">
                {stats.bestBuy ? `${country.symbol}${formatPrice(stats.bestBuy)}` : '—'}
              </span>
            </span>
            <span className="text-[var(--p2p-muted)]">
              Best Sell:{' '}
              <span className="p2p-mono font-semibold text-[var(--p2p-ink)]">
                {stats.bestSell ? `${country.symbol}${formatPrice(stats.bestSell)}` : '—'}
              </span>
            </span>
            <span className="text-[var(--p2p-muted)]">
              Escrow Liquidity:{' '}
              <span className="p2p-mono font-semibold text-[#FF5A00]">{formatUsdcAmount(stats.liquidity)} USDC</span>
            </span>
          </div>
          <span className="p2p-mono text-[11px] text-[var(--p2p-muted)]">
            {filtered.length} active {filtered.length === 1 ? 'offer' : 'offers'} • 0.05 USDC/ad listing • 0 trade fee
          </span>
        </div>
      </section>

      {/* =====================================================================
          OFFER LIST: MOBILE STACKED CARDS (< 768px) & DESKTOP 5-COL TABLE (>= 768px)
         ===================================================================== */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p2p-card h-28 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p2p-card rounded-xl px-6 py-14 text-center">
          <p className="text-base font-bold text-[var(--p2p-ink)]">
            No {activeMode === 'buy' ? 'sell' : 'buy'} offers for {country.currency} match your filters
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--p2p-muted)]">
            Switch currency/payment filters above, or post the first {country.currency} offer on Arc Testnet with your preferred rate and payment method.
          </p>
          <button
            type="button"
            onClick={onPostAd}
            className="mt-5 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" /> Post {country.currency} Ad
          </button>
        </div>
      ) : (
        <>
          {/* Mobile Offer Cards (< 768px) */}
          <ul className="space-y-3 md:hidden">
            {filtered.map((ad) => (
              <AdCard
                key={`mob-${activeMode}-${country.code}-${ad.id.toString()}`}
                ad={ad}
                country={country}
                mode={activeMode}
                account={accounts.get(ad.maker.toLowerCase())}
                viewerAccount={viewerAccount}
                own={sameAddr(ad.maker, address)}
                expanded={false}
                onToggleExpand={handleToggleExpand}
                onMobileSelect={setMobileSheetAd}
                onOpened={onOpenedOrder}
              />
            ))}
          </ul>

          {/* Desktop 5-Column Offer Book Table (>= 768px) */}
          <section className="p2p-card relative z-10 hidden overflow-hidden rounded-xl md:block">
            <div className="grid border-b border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-5 py-3 text-xs font-medium text-[var(--p2p-muted)] md:grid-cols-[minmax(0,1.45fr)_minmax(0,1.05fr)_minmax(0,1.35fr)_minmax(0,1.15fr)_150px]">
              <span>Advertiser</span>
              <span>Price</span>
              <span>Available / Order Limit</span>
              <span>Payment</span>
              <span className="text-right">
                Trade{' '}
                <span className="ml-1 rounded bg-[var(--p2p-tint)] px-1.5 py-0.5 text-[10px] font-bold text-[#FF5A00]">
                  Escrow
                </span>
              </span>
            </div>
            <ul>
              {filtered.map((ad) => (
                <AdCard
                  key={`desk-${activeMode}-${country.code}-${ad.id.toString()}`}
                  ad={ad}
                  country={country}
                  mode={activeMode}
                  account={accounts.get(ad.maker.toLowerCase())}
                  viewerAccount={viewerAccount}
                  own={sameAddr(ad.maker, address)}
                  expanded={activeExpandedId === ad.id}
                  initialUsdc={deepAd?.id === ad.id ? deepAmount : undefined}
                  onToggleExpand={handleToggleExpand}
                  onMobileSelect={setMobileSheetAd}
                  onOpened={onOpenedOrder}
                />
              ))}
            </ul>
          </section>
        </>
      )}

      {/* Mobile Slide-Up Bottom Sheet */}
      <MobileOrderSheet
        ad={activeMobileAd}
        initialUsdc={deepAd?.id === activeMobileAd?.id ? deepAmount : undefined}
        onClose={closeMobileSheet}
        onOpened={(orderId) => {
          setMobileSheetAd(null)
          onOpenedOrder(orderId)
        }}
      />
    </div>
  )
}
