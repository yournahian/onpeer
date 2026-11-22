import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  RefreshCw,
  Shield,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button, Empty, SkeletonRows, StatusBadge } from '@/components/ui'
import { DisputeCard } from '@/components/admin/DisputeCard'
import { CountryFlag } from '@/components/logos'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import {
  CHAIN_ID,
  STATUS,
  countryByCurrency,
  formatFiat,
  formatPrice,
  formatUsdcAmount,
  hexToCurrency,
  shortAddr,
} from '@/lib/p2p'
import { BackendApiError } from '@/lib/api'
import { useP2pAccount } from '@/hooks/useAccount'
import { useAdminDisputeQueue, type DisputeFiling } from '@/hooks/useDispute'
import type { Account, OrderWithId } from '@/hooks/useEscrow'

const REASON_LABELS: Record<string, string> = {
  payment_not_received: 'Payment not received',
  wrong_amount: 'Wrong amount',
  wrong_account: 'Wrong account',
  fraud: 'Suspected fraud',
  other: 'Other',
}

const STATUS_COLORS: Record<string, string> = {
  open: 'var(--warn)',
  taken: 'var(--accent)',
  resolved: 'var(--success)',
  settled: 'var(--success)',
  closed: 'var(--muted)',
}

function FilingRow({ filing }: { filing: DisputeFiling }) {
  const [expanded, setExpanded] = useState(false)
  const explorerBase = buildAddressExplorerUrl(CHAIN_ID, filing.filedBy as `0x${string}`)

  return (
    <li className="glass overflow-hidden rounded-2xl">
      <button
        type="button"
        className="flex w-full items-start gap-3 p-4 text-left"
        onClick={() => setExpanded((x) => !x)}
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--fill-2)', color: 'var(--danger)' }}
        >
          <Shield className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">Order #{filing.orderId} · Encrypted Statement</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
              style={{ background: 'var(--fill-3)', color: STATUS_COLORS[filing.status] ?? 'var(--muted)' }}
            >
              {filing.status}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: 'var(--fill-2)', color: 'var(--muted)' }}
            >
              {REASON_LABELS[filing.reasonCode] ?? filing.reasonCode}
            </span>
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
            Filer: <span className="mono">{shortAddr(filing.filedBy)}</span>
            {' · '}
            {new Date(filing.filedAt).toLocaleString()}
          </p>
          {!expanded && (
            <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--muted)' }}>
              {filing.statement}
            </p>
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t p-4" style={{ borderColor: 'var(--border)' }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
              Statement
            </p>
            <p className="mono mt-1.5 whitespace-pre-wrap break-words text-xs">{filing.statement}</p>
          </div>

          {filing.evidenceBlobIds.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                Evidence blob IDs
              </p>
              <ul className="mt-1 space-y-1">
                {filing.evidenceBlobIds.map((id) => (
                  <li key={id} className="mono flex items-center gap-2 text-xs">
                    <FileText className="size-3 shrink-0" style={{ color: 'var(--muted)' }} />
                    {id}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <a
              href={explorerBase}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
            >
              <ExternalLink className="size-3" />
              View filer on explorer
            </a>
            <a
              href={`/p2p?order=${filing.orderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{ background: 'var(--fill-2)', color: 'var(--muted)' }}
            >
              <ExternalLink className="size-3" />
              Open order room
            </a>
          </div>
        </div>
      )}
    </li>
  )
}

function ResolvedOrderCard({ order }: { order: OrderWithId }) {
  const currency = hexToCurrency(order.currency)
  const country = countryByCurrency(currency)
  const outcomeLabel =
    order.status === STATUS.RESOLVED_BUYER
      ? 'Arbiter ruled: Released to buyer'
      : order.status === STATUS.RESOLVED_SELLER
        ? 'Arbiter ruled: Returned to seller'
        : 'Settled directly by parties'

  return (
    <li className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />
            <span className="text-sm font-bold">Order #{order.id.toString()}</span>
            <span className="mono text-sm font-semibold">{formatUsdcAmount(order.amount)} USDC</span>
            <StatusBadge status={order.status} />
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
            {country && <CountryFlag code={country.code} size={15} />}
            <span>
              {country?.symbol} {formatFiat(order.fiatAmountE6)} {currency} ({formatPrice(order.priceE6)} {currency}/USDC)
            </span>
            <span>Buyer: <span className="mono">{shortAddr(order.buyer)}</span></span>
            <span>Seller: <span className="mono">{shortAddr(order.seller)}</span></span>
            <span>Opened {new Date(Number(order.createdAt) * 1000).toLocaleDateString()}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-3 py-1 text-xs font-bold"
            style={{
              background: 'var(--fill-2)',
              color: order.status === STATUS.RESOLVED_BUYER ? 'var(--success)' : 'var(--muted)',
            }}
          >
            {outcomeLabel}
          </span>
          <a
            href={`/p2p?order=${order.id.toString()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
          >
            <ExternalLink className="size-3" /> Order
          </a>
        </div>
      </div>
    </li>
  )
}

type StatusFilter = 'open' | 'taken' | 'resolved'

export function FilingsTab({
  orders = [],
  ordersLoading = false,
  accounts = new Map(),
  isPrimaryArbiter = false,
  isBackupArbiter = false,
  viewer,
}: {
  orders?: OrderWithId[]
  ordersLoading?: boolean
  accounts?: Map<string, Account>
  isPrimaryArbiter?: boolean
  isBackupArbiter?: boolean
  viewer?: string
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const { isSignedIn, signIn, signingIn } = useP2pAccount()
  const { filings, hasMore, isLoading: filingsLoading, error, reload } = useAdminDisputeQueue(
    statusFilter,
    isSignedIn,
  )

  const filingOrderIds = useMemo(() => new Set(filings.map((f) => f.orderId)), [filings])

  // Onchain cases bucketed into Open, In review (`reviewStartedAt > 0n`), and Resolved
  const openOrders = useMemo(
    () =>
      orders
        .filter(
          (o) =>
            (o.status === STATUS.DISPUTED && o.reviewStartedAt === 0n) ||
            (o.status === STATUS.PAID && o.reviewStartedAt === 0n && filingOrderIds.has(o.id.toString())),
        )
        .sort((a, b) => Number(a.disputedAt - b.disputedAt)),
    [orders, filingOrderIds],
  )

  const inReviewOrders = useMemo(
    () =>
      orders
        .filter((o) => (o.status === STATUS.DISPUTED || o.status === STATUS.PAID) && o.reviewStartedAt > 0n)
        .sort((a, b) => Number(a.reviewStartedAt - b.reviewStartedAt)),
    [orders],
  )

  const resolvedOrders = useMemo(
    () =>
      orders
        .filter(
          (o) =>
            o.status === STATUS.RESOLVED_BUYER ||
            o.status === STATUS.RESOLVED_SELLER ||
            o.status === STATUS.SETTLED,
        )
        .sort((a, b) => Number(b.id - a.id)),
    [orders],
  )

  const activeChainOrders =
    statusFilter === 'open'
      ? openOrders
      : statusFilter === 'taken'
        ? inReviewOrders
        : resolvedOrders

  const filters: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'open', label: 'Open', count: openOrders.length },
    { value: 'taken', label: 'In review', count: inReviewOrders.length },
    { value: 'resolved', label: 'Resolved', count: resolvedOrders.length },
  ]

  const loading = ordersLoading || filingsLoading
  const hasAnyItems = activeChainOrders.length > 0 || filings.length > 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Dispute cases &amp; filings</h2>
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            Onchain escrow cases and encrypted offchain party statements across Open, In review, and Resolved stages.
          </p>
        </div>
        {isSignedIn && (
          <Button variant="ghost" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        )}
      </div>

      {!isSignedIn && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 text-xs"
          style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
        >
          <span style={{ color: 'var(--muted)' }}>
            Onchain cases are shown below. Sign a free message with your wallet to also load &amp; decrypt offchain
            dispute statements and order chat.
          </span>
          <Button
            onClick={() =>
              void signIn().catch((err) =>
                toast.error(err instanceof BackendApiError ? err.message : 'Wallet signature cancelled.'),
              )
            }
            disabled={signingIn}
          >
            {signingIn ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Sign in to decrypt filings
          </Button>
        </div>
      )}

      {/* Status filter tabs */}
      <div
        className="flex gap-1 rounded-xl p-1"
        style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
      >
        {filters.map((f) => {
          const active = statusFilter === f.value
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-colors"
              style={{
                background: active ? 'var(--accent-bg)' : 'transparent',
                color: active ? 'var(--on-accent)' : 'var(--muted)',
              }}
            >
              <span>{f.label}</span>
              <span
                className="mono rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
                style={{
                  background: active ? 'rgba(255,255,255,0.22)' : 'var(--fill-3)',
                  color: active ? '#fff' : 'var(--ink)',
                }}
              >
                {f.count}
              </span>
            </button>
          )
        })}
      </div>

      {error && (
        <p className="rounded-xl p-3 text-xs" style={{ background: 'var(--fill-2)', color: 'var(--danger)' }}>
          Offchain statements error: {error}
        </p>
      )}

      {loading && !hasAnyItems ? (
        <SkeletonRows n={3} />
      ) : !hasAnyItems ? (
        <Empty
          title={
            statusFilter === 'open'
              ? 'No open disputes or filings'
              : statusFilter === 'taken'
                ? 'No cases currently in review'
                : 'No resolved disputes yet'
          }
          body={
            statusFilter === 'open'
              ? 'Orders where a buyer or seller opened a dispute (or filed an encrypted statement) before arbiter intake appear here.'
              : statusFilter === 'taken'
                ? 'Cases where the arbiter clicked "Take case" appear here until ruled or settled.'
                : 'Completed arbiter rulings and party-settled disputes appear here.'
          }
        />
      ) : (
        <div className="space-y-5">
          {filings.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                Encrypted offchain statements ({filings.length})
              </h3>
              <ul className="space-y-2">
                {filings.map((f) => (
                  <FilingRow key={f.id} filing={f} />
                ))}
              </ul>
              {hasMore && (
                <p className="text-center text-xs" style={{ color: 'var(--subtle)' }}>
                  Showing first 50 statements.
                </p>
              )}
            </section>
          )}

          {activeChainOrders.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                {statusFilter === 'open'
                  ? `Open onchain disputes (${activeChainOrders.length})`
                  : statusFilter === 'taken'
                    ? `Cases in arbiter review (${activeChainOrders.length})`
                    : `Resolved & settled cases (${activeChainOrders.length})`}
              </h3>
              <ul className="space-y-3">
                {statusFilter === 'resolved'
                  ? activeChainOrders.map((o) => <ResolvedOrderCard key={o.id.toString()} order={o} />)
                  : activeChainOrders.map((o) => (
                      <DisputeCard
                        key={o.id.toString()}
                        order={o}
                        accounts={accounts}
                        isPrimaryArbiter={isPrimaryArbiter}
                        isBackupArbiter={isBackupArbiter}
                        viewer={viewer}
                      />
                    ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
