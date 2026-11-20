import { useState } from 'react'
import { ExternalLink, FileText, Loader2, RefreshCw, Shield } from 'lucide-react'
import { Button, Empty, SkeletonRows } from '@/components/ui'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, shortAddr } from '@/lib/p2p'
import { useAdminDisputeQueue, type DisputeFiling } from '@/hooks/useDispute'

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
    <li className="glass rounded-2xl overflow-hidden">
      <button
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
            <span className="text-sm font-semibold">Order #{filing.orderId}</span>
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
        <div
          className="space-y-3 border-t p-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
              Statement
            </p>
            <p className="mono mt-1.5 whitespace-pre-wrap break-words text-xs">
              {filing.statement}
            </p>
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
              View order
            </a>
          </div>
        </div>
      )}
    </li>
  )
}

type StatusFilter = 'open' | 'taken' | 'resolved'

export function FilingsTab() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const { filings, hasMore, isLoading, error, reload } = useAdminDisputeQueue(statusFilter)

  const filters: { value: StatusFilter; label: string }[] = [
    { value: 'open', label: 'Open' },
    { value: 'taken', label: 'In review' },
    { value: 'resolved', label: 'Resolved' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Dispute filings</h2>
        <Button variant="ghost" onClick={() => void reload()} disabled={isLoading}>
          <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Status filter tabs */}
      <div
        className="flex gap-1 rounded-xl p-1"
        style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
      >
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className="flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: statusFilter === f.value ? 'var(--accent-bg)' : 'transparent',
              color: statusFilter === f.value ? 'var(--on-accent)' : 'var(--muted)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <SkeletonRows n={3} />
      ) : error ? (
        <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
      ) : filings.length === 0 ? (
        <Empty
          title="No filings"
          body={`No ${statusFilter} dispute filings.`}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {filings.map((f) => (
              <FilingRow key={f.id} filing={f} />
            ))}
          </ul>
          {hasMore && (
            <p className="text-center text-xs" style={{ color: 'var(--subtle)' }}>
              Showing first 50 results.
            </p>
          )}
        </>
      )}

      {isLoading && filings.length === 0 && (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin" style={{ color: 'var(--muted)' }} />
        </div>
      )}
    </div>
  )
}
