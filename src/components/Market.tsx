import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { ChevronDown, Filter, Plus, RefreshCw, X } from 'lucide-react'
import {
  useAccounts,
  useAds,
  useMyAccount,
  useNow,
  useOrders,
  useP2pAsset,
  useUsdcBalance,
  useVerifications,
  type AdWithId,
} from '@/hooks/useEscrow'
import {
  COUNTRIES,
  P2P_ASSETS,
  SIDE_BUY,
  SIDE_SELL,
  STATUS,
  fiatFor,
  formatPrice,
  hexToCurrency,
  isAdExpired,
  isUncapped,
  methodsForCountry,
  sameAddr,
  tier0CapFor,
} from '@/lib/p2p'
import { parseUnitsExact } from '@/onchain-money'
import { CoinLogo, CountryFlag } from '@/components/logos'
import { AdCard } from '@/components/AdCard'
import { MarketFilterSheet } from '@/components/MarketFilterSheet'
import { TradePopupModal } from '@/components/TradeSheet'
import {
  loadSavedP2pFilter,
  persistP2pFilter,
  useMyRelations,
  useTraderProfiles,
  type SavedP2pFilterState,
} from '@/hooks/useSocial'

function parseFiatFilter(raw: string): bigint | null {
  if (!raw) return null
  try {
    return parseUnitsExact(raw, 6)
  } catch {
    return null
  }
}

export function Market({
  initialMode,
  initialCurrency,
  deepAd,
  deepAmount,
  onClearDeepTrade,
  onOpenedOrder,
  onPostAd,
  onOpenTrader,
}: {
  initialMode?: 'buy' | 'sell'
  initialCurrency?: string
  deepAd?: AdWithId
  deepAmount?: string
  onClearDeepTrade: () => void
  onOpenedOrder: (orderId: bigint) => void
  onPostAd: () => void
  onOpenTrader?: (wallet: string) => void
}) {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const [selectedAsset, setSelectedAsset] = useP2pAsset()
  const activeAsset = deepAd ? deepAd.asset : selectedAsset
  const { ads, isLoading } = useAds(activeAsset)
  const { orders } = useOrders()
  const viewerAccount = useMyAccount(activeAsset)
  const viewerBalance = useUsdcBalance(activeAsset)
  const { followingSet, blockedSet } = useMyRelations()
  const now = useNow()

  const [mode, setMode] = useState<'buy' | 'sell'>(initialMode ?? 'buy')
  const [countryCode, setCountryCode] = useState(
    () => COUNTRIES.find((c) => c.currency === initialCurrency)?.code ?? 'BD',
  )
  const [method, setMethod] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [filterState, setFilterState] = useState<SavedP2pFilterState>(() => loadSavedP2pFilter())
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [selectedAd, setSelectedAd] = useState<AdWithId | null>(null)

  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [mobileQuickPanel, setMobileQuickPanel] = useState<'asset' | 'currency' | 'amount' | 'payment' | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const currencyRef = useRef<HTMLDivElement>(null)
  const paymentRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (currencyRef.current && !currencyRef.current.contains(e.target as Node)) setCurrencyOpen(false)
      if (paymentRef.current && !paymentRef.current.contains(e.target as Node)) setPaymentOpen(false)
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const deepCountryCode = deepAd
    ? COUNTRIES.find((c) => c.currency === hexToCurrency(deepAd.currency))?.code
    : undefined
  const activeMode: 'buy' | 'sell' = deepAd ? (deepAd.side === SIDE_SELL ? 'buy' : 'sell') : mode
  const activeCountryCode = deepCountryCode ?? countryCode
  const activePopupAd = selectedAd ?? deepAd ?? null

  const country = COUNTRIES.find((c) => c.code === activeCountryCode) ?? COUNTRIES[0]!
  const wantedSide = activeMode === 'buy' ? SIDE_SELL : SIDE_BUY
  const countryMethods = methodsForCountry(country.code)
  const selectedMethod = method !== null ? countryMethods.find((m) => m.bit === method) : undefined

  const tradedCounterparties = useMemo(() => {
    const set = new Set<string>()
    if (!address) return set
    const me = address.toLowerCase()
    for (const o of orders) {
      if (o.status !== STATUS.COMPLETED && o.status !== STATUS.RESOLVED_BUYER) continue
      if (o.buyer.toLowerCase() === me) set.add(o.seller.toLowerCase())
      if (o.seller.toLowerCase() === me) set.add(o.buyer.toLowerCase())
    }
    return set
  }, [orders, address])

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

  const hereAds = useMemo(() => {
    const targetCurrency = (COUNTRIES.find((c) => c.code === activeCountryCode) ?? COUNTRIES[0]!).currency
    return live.filter((ad) => hexToCurrency(ad.currency) === targetCurrency)
  }, [live, activeCountryCode])

  const makerAddresses = useMemo(() => hereAds.map((a) => a.maker), [hereAds])
  const verifications = useVerifications(makerAddresses)
  const accounts = useAccounts(makerAddresses, activeAsset)
  const traderProfiles = useTraderProfiles(makerAddresses)

  const fiatFilter = parseFiatFilter(amount)
  const userCap = viewerAccount ? viewerAccount.orderCap : tier0CapFor(activeAsset)
  const viewerCompleted = viewerAccount ? viewerAccount.ordersCompleted : 0

  const filtered = useMemo(() => {
    const list = hereAds
      .filter((ad) => ad.side === wantedSide)
      .filter((ad) => !blockedSet.has(ad.maker.toLowerCase()))
      .filter((ad) => !filterState.merchantsOnly || ad.merchantAd)
      .filter((ad) => {
        const kycOk =
          verifications.get(ad.maker.toLowerCase())?.verified === true ||
          traderProfiles.get(ad.maker.toLowerCase())?.kycApproved === true
        if (filterState.kycOnly && !kycOk) return false
        if (filterState.noVerificationOnly && ad.minTakerCompleted > 0) return false
        return true
      })
      .filter((ad) => !filterState.beginnerFriendlyOnly || ad.minTakerCompleted === 0)
      .filter((ad) => !filterState.tradedWithOnly || tradedCounterparties.has(ad.maker.toLowerCase()))
      .filter((ad) => !filterState.followedOnly || followingSet.has(ad.maker.toLowerCase()))
      .filter((ad) => filterState.windowLimitMin === null || ad.windowMinutes <= filterState.windowLimitMin)
      .filter((ad) => {
        if (!filterState.tradableOnly) return true
        if (viewerCompleted < ad.minTakerCompleted) return false
        const minReq = ad.minAmount > ad.available ? ad.available : ad.minAmount
        if (!isUncapped(userCap) && minReq > userCap) return false
        if (activeMode === 'sell' && viewerBalance !== undefined && viewerBalance < minReq) return false
        return true
      })
      .filter((ad) => method === null || (ad.paymentMask & (1 << method)) !== 0)
      .filter((ad) => {
        if (fiatFilter === null) return true
        const lo = fiatFor(ad.minAmount > ad.available ? ad.available : ad.minAmount, ad.priceE6, ad.asset)
        const hi = fiatFor(ad.maxAmount > ad.available ? ad.available : ad.maxAmount, ad.priceE6, ad.asset)
        return fiatFilter >= lo && fiatFilter <= hi
      })

    return [...list].sort((a, b) => {
      if (filterState.sortBy === 'trades') {
        const ta = accounts.get(a.maker.toLowerCase())?.ordersCompleted ?? 0
        const tb = accounts.get(b.maker.toLowerCase())?.ordersCompleted ?? 0
        if (tb !== ta) return tb - ta
      } else if (filterState.sortBy === 'completion') {
        const accA = accounts.get(a.maker.toLowerCase())
        const accB = accounts.get(b.maker.toLowerCase())
        const ca = accA && accA.ordersCreated > 0 ? accA.ordersCompleted / accA.ordersCreated : 1
        const cb = accB && accB.ordersCreated > 0 ? accB.ordersCompleted / accB.ordersCreated : 1
        if (cb !== ca) return cb - ca
      }
      return activeMode === 'buy' ? Number(a.priceE6 - b.priceE6) : Number(b.priceE6 - a.priceE6)
    })
  }, [
    hereAds,
    wantedSide,
    blockedSet,
    filterState,
    verifications,
    traderProfiles,
    tradedCounterparties,
    followingSet,
    viewerCompleted,
    userCap,
    activeMode,
    viewerBalance,
    method,
    fiatFilter,
    accounts,
  ])

  const hasActiveAdvancedFilter =
    filterState.tradableOnly ||
    filterState.merchantsOnly ||
    filterState.kycOnly ||
    filterState.noVerificationOnly ||
    filterState.beginnerFriendlyOnly ||
    filterState.tradedWithOnly ||
    filterState.followedOnly ||
    filterState.windowLimitMin !== null ||
    filterState.sortBy !== 'price'

  const triggerRefresh = () => {
    setRefreshing(true)
    void queryClient.invalidateQueries().finally(() => {
      setTimeout(() => setRefreshing(false), 450)
    })
  }

  const closeTradePopup = () => {
    setSelectedAd(null)
    onClearDeepTrade()
  }

  const sortLabels: Record<SavedP2pFilterState['sortBy'], string> = {
    price: 'Price',
    trades: 'Trades',
    completion: 'Completion',
  }

  return (
    <div className="space-y-3 md:space-y-4">
      {/* =====================================================================
          MOBILE MARKET BAR (< 768px — SS 1 Exact Pattern, No Banner)
         ===================================================================== */}
      <section className="space-y-3 md:hidden">
        {/* Row 1: Pill [Buy | Sell] on Left + [Currency ▾] & [+ Ad] on Right */}
        <div className="flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Trade direction"
            className="inline-flex rounded-full border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-0.5"
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
                  }}
                  className={`h-8 rounded-full px-5 text-xs font-extrabold transition-colors ${
                    active
                      ? 'bg-[#FF5A00] text-white'
                      : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                  }`}
                >
                  {m === 'buy' ? 'Buy' : 'Sell'}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPostAd}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#FF5A00]/60 bg-[var(--p2p-tint)] px-2.5 text-xs font-bold text-[#FF5A00]"
            >
              <Plus className="size-3.5" /> Ad
            </button>

            <button
              type="button"
              onClick={() => setMobileQuickPanel((p) => (p === 'currency' ? null : 'currency'))}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-3 text-xs font-bold text-[var(--p2p-ink)]"
            >
              <span>{country.currency}</span>
              <ChevronDown className="size-3.5 text-[var(--p2p-muted)]" />
            </button>
          </div>
        </div>

        {/* Row 2: [USDC/EURC ▾]  [Amount ▾]  [Payment ▾]  .......... [▽ Funnel] */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--p2p-border)] pb-2.5">
          <div className="flex items-center gap-4 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setMobileQuickPanel((p) => (p === 'asset' ? null : 'asset'))}
              className="inline-flex items-center gap-1.5 font-bold text-[var(--p2p-ink)]"
            >
              <CoinLogo symbol={activeAsset} size={16} />
              <span>{activeAsset}</span>
              <ChevronDown className="size-3.5 text-[var(--p2p-muted)]" />
            </button>

            <button
              type="button"
              onClick={() => setMobileQuickPanel((p) => (p === 'amount' ? null : 'amount'))}
              className={`inline-flex items-center gap-1 ${
                amount ? 'font-bold text-[#FF5A00]' : 'text-[var(--p2p-ink)]'
              }`}
            >
              <span>{amount ? `${country.symbol}${amount}` : 'Amount'}</span>
              <ChevronDown className="size-3.5 text-[var(--p2p-muted)]" />
            </button>

            <button
              type="button"
              onClick={() => setMobileQuickPanel((p) => (p === 'payment' ? null : 'payment'))}
              className={`inline-flex items-center gap-1 ${
                selectedMethod ? 'font-bold text-[#FF5A00]' : 'text-[var(--p2p-ink)]'
              }`}
            >
              <span className="max-w-[96px] truncate">{selectedMethod ? selectedMethod.name : 'Payment'}</span>
              <ChevronDown className="size-3.5 text-[var(--p2p-muted)]" />
            </button>
          </div>

          <button
            type="button"
            aria-label="Open filters"
            onClick={() => setFilterSheetOpen(true)}
            className="relative inline-flex size-8 items-center justify-center rounded-lg text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)]"
          >
            <Filter className="size-4" />
            {hasActiveAdvancedFilter && (
              <span className="absolute right-1 top-1 size-2 rounded-full bg-[#FF5A00]" />
            )}
          </button>
        </div>

        {/* Quick Mobile Inline Dropdowns */}
        {mobileQuickPanel === 'asset' && (
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-2.5">
            {P2P_ASSETS.map((a) => {
              const active = a === activeAsset
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    onClearDeepTrade()
                    setSelectedAsset(a)
                    setSelectedAd(null)
                    setMobileQuickPanel(null)
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-bold ${
                    active
                      ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                      : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]'
                  }`}
                >
                  <CoinLogo symbol={a} size={16} />
                  <span>{a}</span>
                </button>
              )
            })}
          </div>
        )}

        {mobileQuickPanel === 'currency' && (
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-2.5">
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
                    setMobileQuickPanel(null)
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold ${
                    active
                      ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                      : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]'
                  }`}
                >
                  <CountryFlag code={c.code} size={15} />
                  <span>
                    {c.currency} ({c.symbol})
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {mobileQuickPanel === 'amount' && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-2.5">
            <div className="p2p-input flex h-10 flex-1 items-center rounded-lg px-3">
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
              onClick={() => setMobileQuickPanel(null)}
              className="h-10 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white"
            >
              Confirm
            </button>
          </div>
        )}

        {mobileQuickPanel === 'payment' && (
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-2.5">
            <button
              type="button"
              onClick={() => {
                setMethod(null)
                setMobileQuickPanel(null)
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                method === null
                  ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                  : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]'
              }`}
            >
              All
            </button>
            {countryMethods.map((m) => {
              const active = method === m.bit
              return (
                <button
                  key={m.bit}
                  type="button"
                  onClick={() => {
                    setMethod(m.bit)
                    setMobileQuickPanel(null)
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    active
                      ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                      : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]'
                  }`}
                >
                  {m.name}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* =====================================================================
          DESKTOP CONTROL & FILTER BAR (>= 768px — SS 12 Pattern, No Banner)
         ===================================================================== */}
      <section className="p2p-card relative z-20 hidden rounded-xl p-4 space-y-3.5 md:block">
        {/* Top Row: [Buy | Sell] + USDC + Currency Tabs + Post Ad */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p2p-border)] pb-3">
          <div className="flex flex-wrap items-center gap-4">
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
                      setSelectedAd(null)
                    }}
                    className={`h-9 rounded-md px-5 text-xs font-extrabold transition-colors ${
                      active
                        ? 'bg-[#FF5A00] text-white'
                        : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                    }`}
                  >
                    {m === 'buy' ? 'Buy' : 'Sell'}
                  </button>
                )
              })}
            </div>

            {/* Cryptocurrency Tabs: USDC | EURC (Exact 2nd Screenshot Green-Marked Section) */}
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Cryptocurrency">
              {P2P_ASSETS.map((a) => {
                const active = activeAsset === a
                return (
                  <button
                    key={a}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      onClearDeepTrade()
                      setSelectedAsset(a)
                      setSelectedAd(null)
                    }}
                    className={`relative inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-extrabold transition-colors ${
                      active
                        ? 'bg-[var(--p2p-tint)] text-[#FF5A00]'
                        : 'text-[var(--p2p-muted)] hover:bg-[var(--p2p-input-bg)] hover:text-[var(--p2p-ink)]'
                    }`}
                  >
                    <CoinLogo symbol={a} size={17} />
                    <span>{a}</span>
                    {active && <span className="absolute inset-x-2 bottom-0 h-[2.5px] rounded-full bg-[#FF5A00]" />}
                  </button>
                )
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={onPostAd}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white hover:opacity-90"
          >
            <Plus className="size-4" /> Post Ad
          </button>
        </div>

        {/* Second Row: Amount + Fiat Dropdown | All Payments Dropdown | Funnel Filter ...... Sort By + Refresh */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Amount + Currency */}
            <div ref={currencyRef} className="relative w-64">
              <div className="p2p-input flex h-10 items-center rounded-lg">
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, '')
                    if (/^\d*\.?\d{0,2}$/.test(v)) setAmount(v)
                  }}
                  placeholder="Transaction amount"
                  className="p2p-mono w-full bg-transparent px-3 text-xs font-bold text-[var(--p2p-ink)] outline-none placeholder:font-sans placeholder:font-normal placeholder:text-[var(--p2p-muted)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setCurrencyOpen((o) => !o)
                    setPaymentOpen(false)
                  }}
                  className="flex h-full shrink-0 items-center gap-1.5 border-l border-[var(--p2p-border)] px-3 text-xs font-bold text-[var(--p2p-ink)]"
                >
                  <CountryFlag code={country.code} size={15} />
                  <span>{country.currency}</span>
                  <ChevronDown className="size-3.5 text-[var(--p2p-muted)]" />
                </button>
              </div>

              {currencyOpen && (
                <ul className="p2p-glass-popover absolute right-0 top-full z-30 mt-1.5 max-h-72 w-60 overflow-y-auto rounded-xl p-1.5">
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
                            setCurrencyOpen(false)
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs ${
                            active
                              ? 'bg-[var(--p2p-tint)] font-bold text-[#FF5A00]'
                              : 'text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)]'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <CountryFlag code={c.code} size={16} />
                            <span>{c.currency}</span>
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

            {/* Payment Method */}
            <div ref={paymentRef} className="relative w-48">
              <button
                type="button"
                onClick={() => {
                  setPaymentOpen((o) => !o)
                  setCurrencyOpen(false)
                }}
                className="p2p-input flex h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-xs font-semibold text-[var(--p2p-ink)]"
              >
                <span className="truncate">{selectedMethod ? selectedMethod.name : 'All payments'}</span>
                <ChevronDown className="size-3.5 shrink-0 text-[var(--p2p-muted)]" />
              </button>

              {paymentOpen && (
                <ul className="p2p-glass-popover absolute left-0 top-full z-30 mt-1.5 max-h-72 w-56 overflow-y-auto rounded-xl p-1.5">
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setMethod(null)
                        setPaymentOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${
                        method === null
                          ? 'bg-[var(--p2p-tint)] font-bold text-[#FF5A00]'
                          : 'text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)]'
                      }`}
                    >
                      All payments
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
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${
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

            {/* Funnel Filter Drawer Trigger */}
            <button
              type="button"
              onClick={() => setFilterSheetOpen(true)}
              className={`relative inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                hasActiveAdvancedFilter
                  ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                  : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)] hover:border-[#FF5A00]'
              }`}
            >
              <Filter className="size-3.5" />
              <span>Filter</span>
              {hasActiveAdvancedFilter && <span className="size-1.5 rounded-full bg-[#FF5A00]" />}
            </button>
          </div>

          {/* Right Group: Sort By + Refresh */}
          <div className="flex items-center gap-2">
            <div ref={sortRef} className="relative">
              <button
                type="button"
                onClick={() => setSortOpen((o) => !o)}
                className="p2p-input inline-flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-[var(--p2p-ink)]"
              >
                <span className="text-[var(--p2p-muted)]">Sort By</span>
                <span className="font-bold">{sortLabels[filterState.sortBy]}</span>
                <ChevronDown className="size-3.5 text-[var(--p2p-muted)]" />
              </button>

              {sortOpen && (
                <ul className="p2p-glass-popover absolute right-0 top-full z-30 mt-1.5 w-44 rounded-xl p-1.5">
                  {(['price', 'trades', 'completion'] as const).map((sKey) => {
                    const active = filterState.sortBy === sKey
                    return (
                      <li key={sKey}>
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...filterState, sortBy: sKey }
                            setFilterState(next)
                            persistP2pFilter(next)
                            setSortOpen(false)
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs ${
                            active
                              ? 'bg-[var(--p2p-tint)] font-bold text-[#FF5A00]'
                              : 'text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)]'
                          }`}
                        >
                          {sortLabels[sKey]}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <button
              type="button"
              onClick={triggerRefresh}
              title="Refresh offers"
              className="inline-flex size-10 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)] hover:border-[#FF5A00]"
            >
              <RefreshCw className={`size-4 text-[#FF5A00] ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </section>

      {/* =====================================================================
          OFFER LIST: MOBILE DIVIDER ROWS (< 768px) & DESKTOP 5-COL TABLE (>= 768px)
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
            No {activeMode === 'buy' ? 'sell' : 'buy'} {activeAsset} offers for {country.currency} match your filters
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--p2p-muted)]">
            Adjust or reset your filters, switch currency, or post a {activeAsset}/{country.currency} ad with your custom rate.
          </p>
          <button
            type="button"
            onClick={onPostAd}
            className="mt-5 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
          >
            <Plus className="size-4" /> Post {activeAsset} Ad
          </button>
        </div>
      ) : (
        <>
          {/* Mobile Flat Divider Rows (< 768px) */}
          <ul className="-mx-4 border-t border-[var(--p2p-border)] md:hidden">
            {filtered.map((ad) => (
              <AdCard
                key={`mob-${activeMode}-${country.code}-${ad.id.toString()}`}
                ad={ad}
                country={country}
                mode={activeMode}
                account={accounts.get(ad.maker.toLowerCase())}
                makerKyc={verifications.get(ad.maker.toLowerCase())}
                makerProfile={traderProfiles.get(ad.maker.toLowerCase())}
                viewerAccount={viewerAccount}
                own={sameAddr(ad.maker, address)}
                onSelectAd={setSelectedAd}
                onOpenTrader={onOpenTrader}
              />
            ))}
          </ul>

          {/* Desktop 5-Column Offer Book Table (>= 768px — SS 12) */}
          <section className="p2p-card relative z-10 hidden overflow-hidden rounded-xl md:block">
            <div className="grid border-b border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-5 py-3 text-xs font-medium text-[var(--p2p-muted)] md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_150px]">
              <span>Advertisers</span>
              <span>Price</span>
              <span>Available / Order Limit</span>
              <span>Payment</span>
              <span className="text-right">Trade</span>
            </div>
            <ul>
              {filtered.map((ad) => (
                <AdCard
                  key={`desk-${activeMode}-${country.code}-${ad.id.toString()}`}
                  ad={ad}
                  country={country}
                  mode={activeMode}
                  account={accounts.get(ad.maker.toLowerCase())}
                  makerKyc={verifications.get(ad.maker.toLowerCase())}
                  makerProfile={traderProfiles.get(ad.maker.toLowerCase())}
                  viewerAccount={viewerAccount}
                  own={sameAddr(ad.maker, address)}
                  onSelectAd={setSelectedAd}
                  onOpenTrader={onOpenTrader}
                />
              ))}
            </ul>
          </section>
        </>
      )}

      {/* Full-Screen / Drawer Advanced Filter Sheet (SS 4, 5, 6) */}
      <MarketFilterSheet
        key={filterSheetOpen ? 'open' : 'closed'}
        open={filterSheetOpen}
        countryCode={country.code}
        amount={amount}
        method={method}
        filterState={filterState}
        onClose={() => setFilterSheetOpen(false)}
        onApply={(next) => {
          onClearDeepTrade()
          setCountryCode(next.countryCode)
          setAmount(next.amount)
          setMethod(next.method)
          setFilterState(next.filterState)
          persistP2pFilter(next.filterState)
        }}
      />

      {/* Order Placement Screen / Modal (SS 3 Mobile / Centered Desktop) */}
      <TradePopupModal
        ad={activePopupAd}
        makerAccount={activePopupAd ? accounts.get(activePopupAd.maker.toLowerCase()) : undefined}
        initialUsdc={deepAd?.id === activePopupAd?.id ? deepAmount : undefined}
        onClose={closeTradePopup}
        onOpenTrader={(w) => {
          closeTradePopup()
          onOpenTrader?.(w)
        }}
        onOpened={(orderId) => {
          setSelectedAd(null)
          onOpenedOrder(orderId)
        }}
      />
    </div>
  )
}
