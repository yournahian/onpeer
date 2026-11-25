import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectWalletCustom } from '@/components/TelegramWalletModal'
import {
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquare,
  Plus,
  RotateCw,
  Search,
  Share2,
} from 'lucide-react'
import { toast } from 'sonner'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'
import {
  CHAIN_ID,
  COUNTRIES,
  DEFAULT_TTL_HOURS,
  P2P_ASSETS,
  SIDE_SELL,
  STATUS,
  STATUS_META,
  countryByCurrency,
  formatDuration,
  formatFiat,
  formatPrice,
  formatUsdcAmount,
  getEscrowConfig,
  hexToCurrency,
  isActiveStatus,
  isAdExpired,
  maskToMethods,
  sameAddr,
  type P2pAsset,
} from '@/lib/p2p'
import { buildShareLink } from '@/lib/share'
import { parseUnitsExact } from '@/onchain-money'
import {
  useAllAds,
  useNow,
  useOrderTxHashes,
  useOrders,
  type OrderWithId,
} from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { AppLink } from '@/components/AppLink'
import { traderLabel, useTraderProfiles, type PublicTraderSummary } from '@/hooks/useSocial'

function formatOrderTimestamp(sec: bigint): string {
  const ms = Number(sec) * 1000
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

function shortTxHash(hash: string): string {
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`
}

function EmptyCard({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div className="p2p-card rounded-xl px-6 py-14 text-center">
      <p className="text-base font-bold text-[var(--p2p-ink)]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--p2p-muted)]">{body}</p>
      {cta && <div className="mt-5">{cta}</div>}
    </div>
  )
}

function ConnectPrompt({ body }: { body: string }) {
  return (
    <EmptyCard
      title="Connect Your Wallet"
      body={body}
      cta={
        <ConnectWalletCustom>
          {({ show }) => (
            <button
              type="button"
              onClick={show}
              className="inline-flex min-h-10 items-center rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
            >
              Connect Wallet
            </button>
          )}
        </ConnectWalletCustom>
      }
    />
  )
}

function compactOrderStatusLabel(status: number): string {
  switch (status) {
    case STATUS.PENDING:
      return 'Unpaid'
    case STATUS.PAID:
      return 'Paid'
    case STATUS.COMPLETED:
    case STATUS.RESOLVED_BUYER:
      return 'Completed'
    case STATUS.CANCELLED:
    case STATUS.RESOLVED_SELLER:
      return 'Canceled'
    case STATUS.DISPUTED:
      return 'Disputed'
    case STATUS.SETTLED:
      return 'Settled'
    default:
      return STATUS_META[status]?.label ?? 'Unknown'
  }
}

export function MyOrders({
  onOpen,
  onOpenChat,
  onOpenTrader,
}: {
  onOpen: (id: bigint) => void
  onOpenChat?: (id: bigint) => void
  onOpenTrader?: (wallet: string) => void
}) {
  const { address, isConnected } = useAccount()
  const { orders, isLoading } = useOrders()
  const txHashes = useOrderTxHashes()

  const [topTab, setTopTab] = useState<'processing' | 'all' | 'pnl'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'canceled' | 'unpaid' | 'paid' | 'disputed'>('all')
  const [assetFilter, setAssetFilter] = useState<'ALL' | P2pAsset>('ALL')
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL')
  const [sideFilter, setSideFilter] = useState<'all' | 'buy' | 'sell'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchId, setSearchId] = useState('')

  const mine = useMemo(
    () => orders.filter((o) => sameAddr(o.buyer, address) || sameAddr(o.seller, address)),
    [orders, address],
  )
  const peerWallets = useMemo(() => mine.flatMap((o) => [o.buyer, o.seller]), [mine])
  const profilesMap = useTraderProfiles(peerWallets)

  const filteredOrders = useMemo(() => {
    const fromSec = dateFrom ? Math.floor(new Date(`${dateFrom}T00:00:00`).getTime() / 1000) : null
    const toSec = dateTo ? Math.floor(new Date(`${dateTo}T23:59:59`).getTime() / 1000) : null
    const q = searchId.trim().replace(/^#/, '')

    return mine.filter((o) => {
      if (topTab === 'processing') {
        if (!isActiveStatus(o.status)) return false
        if (statusFilter === 'unpaid' && o.status !== STATUS.PENDING) return false
        if (statusFilter === 'paid' && o.status !== STATUS.PAID) return false
        if (statusFilter === 'disputed' && o.status !== STATUS.DISPUTED) return false
      } else if (topTab === 'all') {
        if (
          statusFilter === 'completed' &&
          o.status !== STATUS.COMPLETED &&
          o.status !== STATUS.RESOLVED_BUYER &&
          o.status !== STATUS.SETTLED
        ) {
          return false
        }
        if (
          statusFilter === 'canceled' &&
          o.status !== STATUS.CANCELLED &&
          o.status !== STATUS.RESOLVED_SELLER
        ) {
          return false
        }
      }

      if (assetFilter !== 'ALL' && o.asset !== assetFilter) {
        return false
      }

      if (currencyFilter !== 'ALL' && hexToCurrency(o.currency) !== currencyFilter) {
        return false
      }

      const isBuyer = sameAddr(address, o.buyer)
      if (sideFilter === 'buy' && !isBuyer) return false
      if (sideFilter === 'sell' && isBuyer) return false

      const created = Number(o.createdAt)
      if (fromSec !== null && Number.isFinite(fromSec) && created < fromSec) return false
      if (toSec !== null && Number.isFinite(toSec) && created > toSec) return false

      if (q && !o.rawId.toString().includes(q) && !o.id.toString().includes(q)) return false

      return true
    })
  }, [mine, topTab, statusFilter, assetFilter, currencyFilter, sideFilter, dateFrom, dateTo, searchId, address])

  const pnlByCurrency = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string
        asset: P2pAsset
        currency: string
        buyCount: number
        buyAmount: bigint
        buyFiat: bigint
        sellCount: number
        sellAmount: bigint
        sellFiat: bigint
      }
    >()

    for (const o of mine) {
      if (o.status !== STATUS.COMPLETED && o.status !== STATUS.RESOLVED_BUYER) continue
      const cur = hexToCurrency(o.currency)
      const key = `${o.asset}:${cur}`
      const entry = map.get(key) ?? {
        key,
        asset: o.asset,
        currency: cur,
        buyCount: 0,
        buyAmount: 0n,
        buyFiat: 0n,
        sellCount: 0,
        sellAmount: 0n,
        sellFiat: 0n,
      }
      if (sameAddr(address, o.buyer)) {
        entry.buyCount++
        entry.buyAmount += o.amount
        entry.buyFiat += o.fiatAmountE6
      } else {
        entry.sellCount++
        entry.sellAmount += o.amount
        entry.sellFiat += o.fiatAmountE6
      }
      map.set(key, entry)
    }

    return Array.from(map.values())
  }, [mine, address])

  if (!isConnected) return <ConnectPrompt body="Connect your wallet to inspect active escrow trades and order history." />
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="p2p-card h-20 animate-pulse rounded-xl" />
        <div className="p2p-card h-20 animate-pulse rounded-xl" />
      </div>
    )
  }

  const resetFilters = () => {
    setStatusFilter('all')
    setAssetFilter('ALL')
    setCurrencyFilter('ALL')
    setSideFilter('all')
    setDateFrom('')
    setDateTo('')
    setSearchId('')
  }

  const copyOrderNumber = async (idStr: string) => {
    try {
      await navigator.clipboard.writeText(idStr)
      toast.success(`Order #${idStr} copied`)
    } catch {
      toast.error('Could not copy order number')
    }
  }

  const processingCount = mine.filter((o) => isActiveStatus(o.status)).length

  const subPills =
    topTab === 'processing'
      ? ([
          { id: 'all', label: 'All' },
          { id: 'unpaid', label: 'Unpaid' },
          { id: 'paid', label: 'Paid' },
          { id: 'disputed', label: 'Disputed' },
        ] as const)
      : ([
          { id: 'all', label: 'All' },
          { id: 'completed', label: 'Completed' },
          { id: 'canceled', label: 'Canceled' },
        ] as const)

  return (
    <div className="space-y-5">
      {/* Primary Tabs: Processing | All Orders | Profit & Loss Statement (SS 2) */}
      <div className="flex flex-wrap items-center gap-7 border-b border-[var(--p2p-border)]">
        {[
          { id: 'processing' as const, label: processingCount > 0 ? `Processing (${processingCount})` : 'Processing' },
          { id: 'all' as const, label: 'All Orders' },
          { id: 'pnl' as const, label: 'Profit & Loss Statement' },
        ].map((t) => {
          const active = topTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTopTab(t.id)
                setStatusFilter('all')
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

      {topTab === 'pnl' ? (
        <section className="space-y-4">
          {pnlByCurrency.length === 0 ? (
            <EmptyCard
              title="No Completed Trades Yet"
              body="Your completed Buy and Sell P2P volume and average exchange rates will appear here."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
              <div className="grid border-b border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-5 py-3 text-xs text-[var(--p2p-muted)] sm:grid-cols-5">
                <span>Pair</span>
                <span>Buy Volume</span>
                <span>Avg. Buy Price</span>
                <span>Sell Volume</span>
                <span>Avg. Sell Price</span>
              </div>
              <ul className="divide-y divide-[var(--p2p-border)]">
                {pnlByCurrency.map((row) => {
                  const unit = 10n ** BigInt(getEscrowConfig(row.asset).decimals)
                  const avgBuy = row.buyAmount > 0n ? (row.buyFiat * unit) / row.buyAmount : 0n
                  const avgSell = row.sellAmount > 0n ? (row.sellFiat * unit) / row.sellAmount : 0n
                  return (
                    <li key={row.key} className="grid gap-2 px-5 py-4 text-xs sm:grid-cols-5 sm:items-center">
                      <span className="font-bold text-[var(--p2p-ink)]">
                        {row.asset} / {row.currency}
                      </span>
                      <span className="p2p-mono text-[var(--p2p-ink)]">
                        {formatUsdcAmount(row.buyAmount, undefined, row.asset)} {row.asset} ({row.buyCount})
                      </span>
                      <span className="p2p-mono text-[var(--p2p-muted)]">
                        {avgBuy > 0n ? `${formatPrice(avgBuy)} ${row.currency}` : '—'}
                      </span>
                      <span className="p2p-mono text-[var(--p2p-ink)]">
                        {formatUsdcAmount(row.sellAmount, undefined, row.asset)} {row.asset} ({row.sellCount})
                      </span>
                      <span className="p2p-mono text-[var(--p2p-muted)]">
                        {avgSell > 0n ? `${formatPrice(avgSell)} ${row.currency}` : '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <>
          {/* Status Sub-Pills Row (SS 2 — without Appeal) */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-1">
              {subPills.map((p) => {
                const active = statusFilter === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setStatusFilter(p.id)}
                    className={`rounded-md px-4 py-1.5 text-xs font-bold transition-colors ${
                      active
                        ? 'bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)] shadow-sm'
                        : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Filter Controls Bar (SS 2: Coins | Currency | Order Type | Date Range | Search order no. | Reset) */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex h-10 items-center gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-3 text-xs">
              <span className="text-[var(--p2p-muted)]">Coins</span>
              <select
                value={assetFilter}
                onChange={(e) =>
                  setAssetFilter(
                    (P2P_ASSETS as readonly string[]).includes(e.target.value)
                      ? (e.target.value as P2pAsset)
                      : 'ALL',
                  )
                }
                className="bg-transparent font-bold text-[var(--p2p-ink)] outline-none"
              >
                <option value="ALL">All coins</option>
                {P2P_ASSETS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex h-10 items-center gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-3 text-xs">
              <span className="text-[var(--p2p-muted)]">Currency</span>
              <select
                value={currencyFilter}
                onChange={(e) => setCurrencyFilter(e.target.value)}
                className="bg-transparent font-bold text-[var(--p2p-ink)] outline-none"
              >
                <option value="ALL">All</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.currency}>
                    {c.currency}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex h-10 items-center gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-3 text-xs">
              <span className="text-[var(--p2p-muted)]">Order Type</span>
              <select
                value={sideFilter}
                onChange={(e) => setSideFilter(e.target.value === 'buy' ? 'buy' : e.target.value === 'sell' ? 'sell' : 'all')}
                className="bg-transparent font-bold text-[var(--p2p-ink)] outline-none"
              >
                <option value="all">All</option>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>

            <div className="flex h-10 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-3 text-xs">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="Start date"
                className="p2p-mono bg-transparent text-xs text-[var(--p2p-ink)] outline-none"
              />
              <span className="text-[var(--p2p-muted)]">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="End date"
                className="p2p-mono bg-transparent text-xs text-[var(--p2p-ink)] outline-none"
              />
            </div>

            <div className="flex h-10 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-3 text-xs sm:max-w-[230px]">
              <Search className="size-3.5 shrink-0 text-[var(--p2p-muted)]" />
              <input
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                placeholder="Search order no."
                className="p2p-mono w-full bg-transparent text-xs text-[var(--p2p-ink)] outline-none placeholder:font-sans placeholder:text-[var(--p2p-muted)]"
              />
            </div>

            <button
              type="button"
              onClick={resetFilters}
              className="h-10 px-2 text-xs font-bold text-[var(--p2p-ink)] hover:text-[#FF5A00]"
            >
              Reset
            </button>
          </div>

          {filteredOrders.length === 0 ? (
            <EmptyCard
              title="No Orders Match Your Filters"
              body={
                mine.length === 0
                  ? 'Pick an offer in P2P Trade to open your first escrow order.'
                  : 'Try clearing the filters or switching between Processing and All Orders.'
              }
            />
          ) : (
            <>
              {/* Desktop 6-Column Table (SS 2 — Tx Hash instead of Receipt, No Appeal) */}
              <div className="hidden overflow-hidden rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] md:block">
                <div className="grid border-b border-[var(--p2p-border)] px-5 py-3 text-xs text-[var(--p2p-muted)] md:grid-cols-[155px_150px_130px_165px_1fr_150px]">
                  <span>Type/Date</span>
                  <span>Order number</span>
                  <span>Price</span>
                  <span>Fiat / Crypto Amount</span>
                  <span>Counterparty</span>
                  <span>Status</span>
                </div>

                <ul className="divide-y divide-[var(--p2p-border)]">
                  {filteredOrders.map((o) => {
                    const idStr = o.id.toString()
                    const displayIdStr = o.rawId.toString()
                    const currency = hexToCurrency(o.currency)
                    const isBuyer = sameAddr(address, o.buyer)
                    const peerWallet = (isBuyer ? o.seller : o.buyer).toLowerCase()
                    const peerLabel = traderLabel(peerWallet, profilesMap.get(peerWallet))
                    const txHash = txHashes[idStr]
                    const txUrl = txHash
                      ? buildTxExplorerUrl(CHAIN_ID, txHash)
                      : buildAddressExplorerUrl(CHAIN_ID, getEscrowConfig(o.asset).escrowAddress)

                    return (
                      <li
                        key={idStr}
                        className="grid items-start gap-4 px-5 py-4 text-xs transition-colors hover:bg-[var(--p2p-row-hover)] md:grid-cols-[155px_150px_130px_165px_1fr_150px]"
                      >
                        {/* 1. Type / Date */}
                        <div className="space-y-1.5">
                          <p className="font-bold">
                            <span className={isBuyer ? 'text-[#FF5A00]' : 'text-red-400'}>
                              {isBuyer ? 'Buy' : 'Sell'}
                            </span>{' '}
                            <span className="text-[var(--p2p-ink)]">{o.asset}</span>
                          </p>
                          <p className="p2p-mono text-[11px] text-[var(--p2p-muted)]">
                            {formatOrderTimestamp(o.createdAt)}
                          </p>
                        </div>

                        {/* 2. Order Number */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpen(o.id)}
                            className="p2p-mono font-semibold text-[var(--p2p-ink)] underline decoration-[var(--p2p-muted)]/60 underline-offset-2 hover:text-[#FF5A00]"
                          >
                            {displayIdStr}
                          </button>
                          <button
                            type="button"
                            onClick={() => void copyOrderNumber(displayIdStr)}
                            aria-label={`Copy order ${displayIdStr}`}
                            className="rounded p-1 text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]"
                          >
                            <Copy className="size-3.5" />
                          </button>
                        </div>

                        {/* 3. Price */}
                        <div className="p2p-mono font-semibold text-[var(--p2p-ink)]">
                          {formatPrice(o.priceE6)} {currency}
                        </div>

                        {/* 4. Fiat / Crypto Amount */}
                        <div className="space-y-1.5">
                          <p className="p2p-mono font-semibold text-[var(--p2p-ink)]">
                            {formatFiat(o.fiatAmountE6, 0)} {currency}
                          </p>
                          <p className="p2p-mono text-[11px] text-[var(--p2p-muted)]">
                            {formatUsdcAmount(o.amount, undefined, o.asset)} {o.asset}
                          </p>
                        </div>

                        {/* 5. Counterparty + Chat Button */}
                        <div className="space-y-1.5">
                          <button
                            type="button"
                            onClick={() => (onOpenTrader ? onOpenTrader(peerWallet) : onOpen(o.id))}
                            className="block max-w-[200px] truncate font-semibold text-[var(--p2p-ink)] underline decoration-[var(--p2p-muted)]/60 underline-offset-2 hover:text-[#FF5A00]"
                          >
                            {peerLabel}
                          </button>
                          <button
                            type="button"
                            onClick={() => (onOpenChat ? onOpenChat(o.id) : onOpen(o.id))}
                            className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--p2p-ink)] hover:border-[#FF5A00] hover:text-[#FF5A00]"
                          >
                            <span>Chat</span>
                            <MessageSquare className="size-3" />
                          </button>
                        </div>

                        {/* 6. Status + Tx Hash (No Receipt, No Appeal) */}
                        <div className="space-y-1.5">
                          <button
                            type="button"
                            onClick={() => onOpen(o.id)}
                            className="block font-semibold text-[var(--p2p-ink)] underline decoration-[var(--p2p-muted)]/60 underline-offset-2 hover:text-[#FF5A00]"
                          >
                            {compactOrderStatusLabel(o.status)}
                          </button>
                          {txUrl && (
                            <a
                              href={txUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={txHash ?? 'View on Arc Explorer'}
                              className="p2p-mono inline-flex items-center gap-1 text-[11px] font-bold text-[#FF5A00] hover:underline"
                            >
                              <span>{txHash ? shortTxHash(txHash) : 'Tx Hash'}</span>
                              <ExternalLink className="size-3" />
                            </a>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {/* Mobile Stacked Order Cards (< 768px) */}
              <ul className="space-y-2.5 md:hidden">
                {filteredOrders.map((o) => {
                  const idStr = o.id.toString()
                  const displayIdStr = o.rawId.toString()
                  const currency = hexToCurrency(o.currency)
                  const country = countryByCurrency(currency)
                  const isBuyer = sameAddr(address, o.buyer)
                  const peerWallet = (isBuyer ? o.seller : o.buyer).toLowerCase()
                  const peerLabel = traderLabel(peerWallet, profilesMap.get(peerWallet))
                  const txHash = txHashes[idStr]
                  const txUrl = txHash
                    ? buildTxExplorerUrl(CHAIN_ID, txHash)
                    : buildAddressExplorerUrl(CHAIN_ID, getEscrowConfig(o.asset).escrowAddress)

                  return (
                    <li
                      key={idStr}
                      className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-4 space-y-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold">
                          <span className={isBuyer ? 'text-[#FF5A00]' : 'text-red-400'}>
                            {isBuyer ? 'Buy' : 'Sell'}
                          </span>{' '}
                          <span className="text-[var(--p2p-ink)]">{o.asset}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onOpen(o.id)}
                          className="inline-flex items-center gap-1 font-bold text-[var(--p2p-ink)]"
                        >
                          {compactOrderStatusLabel(o.status)} <ChevronRight className="size-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-[var(--p2p-muted)]">
                        <span>Amount</span>
                        <span className="p2p-mono font-bold text-[var(--p2p-ink)]">
                          {country?.symbol}
                          {formatFiat(o.fiatAmountE6, 0)} {currency} ({formatUsdcAmount(o.amount, undefined, o.asset)} {o.asset})
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[var(--p2p-muted)]">
                        <span>Order #{displayIdStr}</span>
                        <span className="p2p-mono">{formatOrderTimestamp(o.createdAt)}</span>
                      </div>

                      <div className="flex items-center justify-between border-t border-[var(--p2p-border)] pt-2.5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => (onOpenTrader ? onOpenTrader(peerWallet) : onOpen(o.id))}
                            className="font-bold text-[var(--p2p-ink)] underline"
                          >
                            {peerLabel}
                          </button>
                          <button
                            type="button"
                            onClick={() => (onOpenChat ? onOpenChat(o.id) : onOpen(o.id))}
                            className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--p2p-ink)]"
                          >
                            Chat <MessageSquare className="size-3" />
                          </button>
                        </div>

                        {txUrl && (
                          <a
                            href={txUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p2p-mono inline-flex items-center gap-1 text-[11px] font-bold text-[#FF5A00]"
                          >
                            {txHash ? shortTxHash(txHash) : 'Tx Hash'} <ExternalLink className="size-3" />
                          </a>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

function ArbiterOrderRow({
  order,
  profilesMap,
  onOpen,
}: {
  order: OrderWithId
  profilesMap: Map<string, PublicTraderSummary>
  onOpen: (id: bigint) => void
}) {
  const currency = hexToCurrency(order.currency)
  const country = countryByCurrency(currency)
  const buyerLabel = traderLabel(order.buyer, profilesMap.get(order.buyer.toLowerCase()))
  const sellerLabel = traderLabel(order.seller, profilesMap.get(order.seller.toLowerCase()))

  return (
    <li className="border-b border-[var(--p2p-border)] last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(order.id)}
        className="grid w-full gap-3 bg-[var(--p2p-canvas)] px-4 py-4 text-left transition-colors hover:bg-[var(--p2p-row-hover)] sm:px-5 md:grid-cols-[180px_1fr_1fr_1fr_auto] md:items-center"
      >
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#FF5A00]">
            Dispute Review
          </span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-[var(--p2p-ink)]">
            {buyerLabel} vs {sellerLabel}
          </span>
          <span className="p2p-mono mt-0.5 block text-[11px] text-[var(--p2p-muted)]">
            Order #{order.id.toString()}
          </span>
        </div>

        <div>
          <span className="block text-[11px] text-[var(--p2p-muted)]">Crypto Amount</span>
          <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">
            {formatUsdcAmount(order.amount, undefined, order.asset)} {order.asset}
          </span>
        </div>

        <div>
          <span className="block text-[11px] text-[var(--p2p-muted)]">Fiat Total</span>
          <span className="p2p-mono text-sm font-semibold text-[var(--p2p-ink)]">
            {country?.symbol}
            {formatFiat(order.fiatAmountE6)} {currency}
          </span>
        </div>

        <div>
          <span className="block text-[11px] text-[var(--p2p-muted)]">Rate</span>
          <span className="p2p-mono text-xs text-[var(--p2p-ink)]">
            {formatPrice(order.priceE6)} {currency}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 md:justify-end">
          <span className="inline-flex items-center gap-1.5 rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2.5 py-1 text-xs font-semibold text-[#FF5A00]">
            <span className="size-1.5 rounded-full bg-[#FF5A00]" />
            {STATUS_META[order.status]?.label ?? 'Disputed'}
          </span>
          <ChevronRight className="size-4 text-[var(--p2p-muted)]" />
        </div>
      </button>
    </li>
  )
}

export function ArbiterPanel({ onOpen }: { onOpen: (id: bigint) => void }) {
  const { orders, isLoading } = useOrders()
  const disputed = useMemo(() => orders.filter((o) => o.status === STATUS.DISPUTED), [orders])
  const peerWallets = useMemo(() => disputed.flatMap((o) => [o.buyer, o.seller]), [disputed])
  const profilesMap = useTraderProfiles(peerWallets)

  if (isLoading) return <div className="p2p-card h-24 animate-pulse rounded-xl" />

  return (
    <div className="space-y-4">
      <div className="p2p-card flex flex-wrap items-center justify-between gap-2 rounded-xl px-5 py-3.5 text-xs text-[var(--p2p-muted)]">
        <span>Inspect evidence and rule on open disputes directly, or open the full control room.</span>
        <AppLink to="/admin" className="font-bold text-[#FF5A00] hover:underline">
          Open Admin Control Room →
        </AppLink>
      </div>
      {disputed.length === 0 ? (
        <EmptyCard title="No Open Disputes" body="Disputed escrow orders awaiting arbitration will appear here." />
      ) : (
        <section className="p2p-card overflow-hidden rounded-xl !border-[#FF5A00]">
          <ul>
            {disputed.map((o) => (
              <ArbiterOrderRow key={o.id.toString()} order={o} profilesMap={profilesMap} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export function MyAds({ onPostAd }: { onPostAd: () => void }) {
  const { address, isConnected } = useAccount()
  const { ads, isLoading } = useAllAds()
  const now = useNow()
  const { run, writeContractAsync, pendingKey } = useTx()
  const [editing, setEditing] = useState<bigint | null>(null)
  const [newPrice, setNewPrice] = useState('')

  if (!isConnected) return <ConnectPrompt body="Connect your wallet to manage your Buy and Sell ads." />
  if (isLoading) return <div className="p2p-card h-24 animate-pulse rounded-xl" />

  const mine = ads.filter((a) => sameAddr(a.maker, address))
  if (mine.length === 0) {
    return (
      <EmptyCard
        title="You Have No Ads"
        body="Post a Buy or Sell offer with your custom exchange rate, payment methods, and expiry window."
        cta={
          <button
            type="button"
            onClick={onPostAd}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
          >
            <Plus className="size-4" /> Post Ad
          </button>
        }
      />
    )
  }

  const baseFor = (asset: P2pAsset) => ({
    address: getEscrowConfig(asset).escrowAddress,
    abi: p2pEscrowAbi,
    chainId: CHAIN_ID,
  }) as const

  const updatePrice = (ad: (typeof mine)[number], priceE6: bigint) =>
    run(`price-${ad.id}`, 'Update price', () =>
      writeContractAsync({ ...baseFor(ad.asset), functionName: 'setAdPrice', args: [ad.rawId, priceE6] }),
    )
  const setPaused = (ad: (typeof mine)[number], paused: boolean) =>
    run(`pause-${ad.id}`, paused ? 'Pause ad' : 'Resume ad', () =>
      writeContractAsync({ ...baseFor(ad.asset), functionName: 'setAdPaused', args: [ad.rawId, paused] }),
    )
  const refreshAd = (ad: (typeof mine)[number]) =>
    run(`refresh-${ad.id}`, 'Refresh ad expiry', () =>
      writeContractAsync({ ...baseFor(ad.asset), functionName: 'refreshAd', args: [ad.rawId, DEFAULT_TTL_HOURS] }),
    )
  const closeAd = (ad: (typeof mine)[number]) =>
    run(`close-${ad.id}`, 'Close ad', () =>
      writeContractAsync({ ...baseFor(ad.asset), functionName: 'closeAd', args: [ad.rawId] }),
    )

  const copyAdShare = async (adId: string) => {
    try {
      const link = await buildShareLink(`/p2p?trade=${adId}`)
      await navigator.clipboard.writeText(link)
      toast.success(`Ad #${adId} share link copied`)
    } catch {
      toast.error('Could not copy share link')
    }
  }

  return (
    <div className="space-y-4">
      <div className="p2p-card flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3">
        <p className="text-xs text-[var(--p2p-muted)]">
          Manage your active offers, refresh TTL timers, adjust rates, share your ad link, or close ads to withdraw unreserved USDC.
        </p>
        <button
          type="button"
          onClick={onPostAd}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-3.5 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
        >
          <Plus className="size-3.5" /> New Ad
        </button>
      </div>

      <ul className="space-y-3">
        {mine.map((ad) => {
          const currency = hexToCurrency(ad.currency)
          const id = ad.id.toString()
          const sell = ad.side === SIDE_SELL
          const expired = !ad.closed && isAdExpired(ad.expiresAt, now)
          const ttlLeft = Math.max(0, Number(ad.expiresAt) - now)
          const stateLabel = ad.closed ? 'Closed' : expired ? 'Expired' : ad.paused ? 'Paused' : 'Live'
          const isLive = stateLabel === 'Live'

          return (
            <li key={id} className="p2p-card rounded-xl p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-[var(--p2p-tint)] px-2 py-0.5 text-xs font-bold text-[#FF5A00]">
                      {sell ? `SELL ${ad.asset}` : `BUY ${ad.asset}`}
                    </span>
                    <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">
                      {formatUsdcAmount(ad.available, undefined, ad.asset)} {ad.asset} remaining
                    </span>
                    <span className="p2p-mono text-xs text-[var(--p2p-muted)]">Ad #{ad.rawId.toString()}</span>
                  </div>

                  <p className="p2p-mono text-xs text-[var(--p2p-muted)]">
                    Rate: <strong className="text-[var(--p2p-ink)]">{formatPrice(ad.priceE6)} {currency}</strong> • Limits:{' '}
                    {formatUsdcAmount(ad.minAmount, undefined, ad.asset)} - {formatUsdcAmount(ad.maxAmount, undefined, ad.asset)} {ad.asset}
                    {!ad.closed && (
                      <>
                        {' '}•{' '}
                        <span className={expired ? 'font-bold text-[#FF5A00]' : ''}>
                          {expired ? 'TTL Expired (Hidden)' : `TTL ${formatDuration(ttlLeft)}`}
                        </span>
                      </>
                    )}
                  </p>

                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {maskToMethods(ad.paymentMask).map((m) => (
                      <span
                        key={m.bit}
                        className="rounded bg-[var(--p2p-input-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--p2p-ink)] ring-1 ring-inset ring-[var(--p2p-border)]"
                        style={{ borderLeft: '3px solid #FF5A00' }}
                      >
                        {m.name}
                      </span>
                    ))}
                  </div>
                </div>

                <span
                  className={`rounded border px-2.5 py-1 text-xs font-bold ${
                    isLive || expired
                      ? 'border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] text-[#FF5A00]'
                      : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
                  }`}
                >
                  {stateLabel}
                </span>
              </div>

              {!ad.closed && (
                <div className="mt-4 border-t border-[var(--p2p-border)] pt-3.5">
                  {editing === ad.id ? (
                    <div className="flex flex-wrap gap-2">
                      <input
                        inputMode="decimal"
                        value={newPrice}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.]/g, '')
                          if (/^\d*\.?\d{0,4}$/.test(v)) setNewPrice(v)
                        }}
                        placeholder={`New price (${currency})`}
                        className="p2p-input p2p-mono h-10 flex-1 rounded-lg px-3 text-xs font-bold"
                      />
                      <button
                        type="button"
                        disabled={!newPrice || pendingKey === `price-${id}`}
                        onClick={() =>
                          void updatePrice(ad, parseUnitsExact(newPrice, 6)).then((ok) => ok && setEditing(null))
                        }
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] disabled:opacity-40"
                      >
                        {pendingKey === `price-${id}` && <Loader2 className="size-3.5 animate-spin" />}
                        Save Rate
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="h-10 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-xs font-semibold text-[var(--p2p-ink)]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pendingKey === `refresh-${id}`}
                        onClick={() => void refreshAd(ad)}
                        className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3.5 text-xs font-bold transition-colors ${
                          expired
                            ? 'bg-[#FF5A00] text-[#FFFFFF]'
                            : 'border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)] hover:border-[#FF5A00]'
                        }`}
                      >
                        <RotateCw className={`size-3.5 ${pendingKey === `refresh-${id}` ? 'animate-spin' : ''}`} />
                        Refresh (+{DEFAULT_TTL_HOURS}h)
                      </button>

                      <button
                        type="button"
                        onClick={() => setEditing(ad.id)}
                        className="min-h-9 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 text-xs font-semibold text-[var(--p2p-ink)] hover:border-[var(--p2p-border-active)]"
                      >
                        Edit Price
                      </button>

                      <button
                        type="button"
                        onClick={() => void copyAdShare(id)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 text-xs font-semibold text-[var(--p2p-ink)] hover:border-[#FF5A00]"
                      >
                        <Share2 className="size-3.5 text-[#FF5A00]" /> Share Ad
                      </button>

                      <button
                        type="button"
                        disabled={pendingKey === `pause-${id}`}
                        onClick={() => void setPaused(ad, !ad.paused)}
                        className="min-h-9 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 text-xs font-semibold text-[var(--p2p-ink)] hover:border-[var(--p2p-border-active)]"
                      >
                        {ad.paused ? 'Resume Ad' : 'Pause Ad'}
                      </button>

                      <button
                        type="button"
                        disabled={pendingKey === `close-${id}`}
                        onClick={() => void closeAd(ad)}
                        className="min-h-9 rounded-lg border border-[#FF5A00] bg-transparent px-3.5 text-xs font-bold text-[#FF5A00] hover:bg-[var(--p2p-tint)]"
                      >
                        {sell ? `Close & Withdraw ${ad.asset}` : 'Close Ad'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
