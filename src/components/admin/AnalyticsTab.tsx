import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Globe2,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { useAccount, useSignMessage } from 'wagmi'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { apiFetch, signInWithWallet, useBackendSession } from '@/lib/api'
import { CHAIN_ID, shortAddr } from '@/lib/p2p'
import { Button, CopyButton, inputClass } from '@/components/ui'

type RangeKey = '7d' | '30d' | '90d' | 'all'
type TrendMetric = 'volume' | 'txns' | 'visits' | 'kyc_email'
type PieMode = 'country' | 'kind' | 'status'

interface AnalyticsSummary {
  totalVolume: number
  totalTxns: number
  successTxns: number
  failedTxns: number
  successRate: number
  highestAmount: number
  lowestAmount: number
  avgNetworkFee: number
  totalNetworkFee: number
  visits: number
  uniqueVisitors: number
  kycStarted: number
  kycApproved: number
  kycDeclined: number
  kycPending: number
  emailsTotal: number
  emailsSent: number
  emailsFailed: number
}

interface AnalyticsPrevious {
  totalVolume: number
  totalTxns: number
  successRate: number
  visits: number
  uniqueVisitors: number
  kycStarted: number
  emailsTotal: number
}

interface ChainRow {
  chain: string
  txns: number
  volume: number
  successRate: number
  avgFee: number
}

interface KindRow {
  kind: string
  txns: number
  volume: number
}

interface CountryRow {
  country: string
  txns: number
  volume: number
  successRate: number
  visits: number
  uniqueVisitors: number
  accounts: number
  kycApproved: number
  emailVerified: number
}

interface DailyPoint {
  day: string
  volume: number
  txns: number
  successTxns: number
  failedTxns: number
  visits: number
  uniqueVisitors: number
  kycStarted: number
  kycApproved: number
  emailsTotal: number
  emailsSent: number
}

interface CustomerRow {
  wallet: string
  displayName: string | null
  kycStatus: string
  country: string
  totalVolume: number
  totalTxns: number
  successRate: number
  highestAmount: number
  lowestAmount: number
  avgNetworkFee: number
  chains: string[]
  lastTxAt: string
}

interface HistoryRow {
  id: string
  txHash: string | null
  kind: string
  action: string
  wallet: string
  displayName: string | null
  chain: string
  token: string
  amountUsd: number
  networkFeeUsd: number
  status: 'success' | 'failed'
  country: string
  createdAt: string
}

interface AnalyticsPayload {
  migrationRequired: boolean
  range: string
  country: string
  summary: AnalyticsSummary | null
  previous: AnalyticsPrevious | null
  byChain: ChainRow[]
  byKind: KindRow[]
  byCountry: CountryRow[]
  dailySeries: DailyPoint[]
  customers: CustomerRow[]
  history: HistoryRow[]
}

const COUNTRY_NAMES: Record<string, string> = {
  ALL: 'Global (All Countries)',
  BD: 'Bangladesh',
  IN: 'India',
  PK: 'Pakistan',
  LK: 'Sri Lanka',
  NP: 'Nepal',
  BT: 'Bhutan',
  MV: 'Maldives',
  AF: 'Afghanistan',
  US: 'United States',
  GB: 'United Kingdom',
  AE: 'UAE',
  SG: 'Singapore',
  XX: 'Unknown / Direct',
}

const PIE_COLORS = ['#FF5A00', '#38bdf8', '#7ef1b3', '#fbbf24', '#c084fc', '#fb7185', '#2dd4bf', '#94a3b8']

const fmtUsd = (n: number, dec = 2) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })}`

const fmtFee = (n: number) =>
  n === 0 ? '$0.00' : n < 0.0001 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`

const fmtInt = (n: number) => Math.round(n).toLocaleString()

function pctDiff(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? 100 : null
  return ((curr - prev) / prev) * 100
}

function DeltaBadge({ curr, prev }: { curr: number; prev: number }) {
  const diff = pctDiff(curr, prev)
  if (diff === null) return null
  const up = diff >= 0
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
      style={{
        background: up ? 'rgba(126,241,179,0.14)' : 'rgba(255,107,139,0.14)',
        color: up ? 'var(--success)' : 'var(--danger)',
      }}
    >
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(diff).toFixed(1)}%
    </span>
  )
}

function KpiCard({
  label,
  value,
  sub,
  curr,
  prev,
  tone,
}: {
  label: string
  value: string
  sub?: string
  curr?: number
  prev?: number
  tone?: string
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
          {label}
        </p>
        {curr !== undefined && prev !== undefined && <DeltaBadge curr={curr} prev={prev} />}
      </div>
      <p className="display mt-1.5 text-2xl font-bold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
      {sub && (
        <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--muted)' }}>
          {sub}
        </p>
      )}
    </div>
  )
}

function DonutChart({
  title,
  items,
  emptyLabel,
}: {
  title: string
  items: Array<{ label: string; value: number; meta?: string }>
  emptyLabel: string
}) {
  const total = items.reduce((acc, x) => acc + x.value, 0)
  const radius = 56
  const stroke = 16
  const circ = 2 * Math.PI * radius

  const segments = useMemo(() => {
    if (total <= 0) return []
    const out: Array<{ label: string; value: number; meta?: string; color: string; dash: number; offset: number; pct: number }> = []
    let acc = 0
    for (const [idx, item] of items.slice(0, PIE_COLORS.length).entries()) {
      const frac = item.value / total
      const dash = frac * circ
      out.push({
        ...item,
        color: PIE_COLORS[idx % PIE_COLORS.length],
        dash,
        offset: acc,
        pct: frac * 100,
      })
      acc += dash
    }
    return out
  }, [circ, items, total])

  return (
    <div className="glass rounded-3xl p-5">
      <h3 className="display text-base font-bold">{title}</h3>
      {total <= 0 ? (
        <p className="mt-6 text-center text-xs" style={{ color: 'var(--subtle)' }}>
          {emptyLabel}
        </p>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row">
          <div className="relative flex size-36 shrink-0 items-center justify-center">
            <svg viewBox="0 0 150 150" className="size-full -rotate-90">
              <circle cx="75" cy="75" r={radius} fill="none" stroke="var(--fill-3)" strokeWidth={stroke} />
              {segments.map((s) => (
                <circle
                  key={s.label}
                  cx="75"
                  cy="75"
                  r={radius}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${s.dash} ${circ - s.dash}`}
                  strokeDashoffset={-s.offset}
                  strokeLinecap="butt"
                />
              ))}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
                Total
              </span>
              <span className="display text-sm font-bold tabular-nums">{fmtInt(total)}</span>
            </div>
          </div>
          <ul className="w-full min-w-0 flex-1 space-y-2 text-xs">
            {segments.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="truncate font-semibold">{s.label}</span>
                </span>
                <span className="mono shrink-0 tabular-nums" style={{ color: 'var(--muted)' }}>
                  {s.pct.toFixed(1)}%{s.meta ? ` · ${s.meta}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function AreaTrendChart({ series, metric }: { series: DailyPoint[]; metric: TrendMetric }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const w = 640
  const h = 210
  const padX = 12
  const padY = 16

  const values = useMemo(
    () =>
      series.map((d) => {
        if (metric === 'volume') return d.volume
        if (metric === 'txns') return d.txns
        if (metric === 'visits') return d.visits
        return d.kycStarted + d.emailsTotal
      }),
    [metric, series],
  )
  const secondary = useMemo(
    () =>
      series.map((d) => {
        if (metric === 'visits') return d.uniqueVisitors
        if (metric === 'kyc_email') return d.kycApproved
        if (metric === 'txns') return d.failedTxns
        return 0
      }),
    [metric, series],
  )

  const maxVal = Math.max(1, ...values, ...secondary)
  const stepX = series.length > 1 ? (w - padX * 2) / (series.length - 1) : 0
  const toY = (v: number) => h - padY - (v / maxVal) * (h - padY * 2)

  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${padX + i * stepX} ${toY(v)}`).join(' ')
  const areaPath =
    values.length > 0
      ? `${linePath} L ${padX + (values.length - 1) * stepX} ${h - padY} L ${padX} ${h - padY} Z`
      : ''
  const secPath =
    metric !== 'volume'
      ? secondary.map((v, i) => `${i === 0 ? 'M' : 'L'} ${padX + i * stepX} ${toY(v)}`).join(' ')
      : ''

  const active = hoverIdx !== null ? series[hoverIdx] : series[series.length - 1]

  return (
    <div>
      {active && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          <span className="mono font-semibold" style={{ color: 'var(--ink)' }}>
            {active.day}
          </span>
          <div className="flex flex-wrap gap-3 tabular-nums">
            {metric === 'volume' && <span>Volume: <strong style={{ color: 'var(--accent)' }}>{fmtUsd(active.volume)}</strong></span>}
            {metric === 'txns' && (
              <>
                <span>Total: <strong style={{ color: 'var(--accent)' }}>{active.txns}</strong></span>
                <span>Success: <strong style={{ color: 'var(--success)' }}>{active.successTxns}</strong></span>
                <span>Failed: <strong style={{ color: 'var(--danger)' }}>{active.failedTxns}</strong></span>
              </>
            )}
            {metric === 'visits' && (
              <>
                <span>Visits: <strong style={{ color: 'var(--accent)' }}>{active.visits}</strong></span>
                <span>Unique: <strong style={{ color: '#38bdf8' }}>{active.uniqueVisitors}</strong></span>
              </>
            )}
            {metric === 'kyc_email' && (
              <>
                <span>KYC Started: <strong style={{ color: 'var(--accent)' }}>{active.kycStarted}</strong></span>
                <span>KYC Approved: <strong style={{ color: 'var(--success)' }}>{active.kycApproved}</strong></span>
                <span>Emails: <strong style={{ color: '#38bdf8' }}>{active.emailsTotal}</strong></span>
              </>
            )}
          </div>
        </div>
      )}

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-52 w-full overflow-visible"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="an-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF5A00" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#FF5A00" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const y = h - padY - f * (h - padY * 2)
          return <line key={f} x1={padX} x2={w - padX} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 4" />
        })}
        {areaPath && <path d={areaPath} fill="url(#an-area-grad)" />}
        {linePath && <path d={linePath} fill="none" stroke="#FF5A00" strokeWidth="2.5" strokeLinejoin="round" />}
        {secPath && (
          <path
            d={secPath}
            fill="none"
            stroke={metric === 'txns' ? '#ff6b8b' : '#38bdf8'}
            strokeWidth="2"
            strokeDasharray="4 3"
          />
        )}
        {series.map((d, i) => {
          const x = padX + i * stepX
          const y = toY(values[i] ?? 0)
          const isHot = hoverIdx === i
          return (
            <g key={d.day} onMouseEnter={() => setHoverIdx(i)} className="cursor-pointer">
              <rect x={x - Math.max(8, stepX / 2)} y={0} width={Math.max(16, stepX)} height={h} fill="transparent" />
              {isHot && <line x1={x} x2={x} y1={padY} y2={h - padY} stroke="var(--accent)" strokeOpacity="0.45" />}
              <circle
                cx={x}
                cy={y}
                r={isHot ? 5 : 2.5}
                fill={isHot ? '#FF5A00' : 'var(--bg)'}
                stroke="#FF5A00"
                strokeWidth="2"
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function DifferenceComparisonChart({
  summary,
  previous,
}: {
  summary: AnalyticsSummary
  previous: AnalyticsPrevious
}) {
  const rows = [
    { label: 'Volume (USD)', curr: summary.totalVolume, prev: previous.totalVolume, fmt: (n: number) => fmtUsd(n, 0) },
    { label: 'Transactions', curr: summary.totalTxns, prev: previous.totalTxns, fmt: fmtInt },
    { label: 'Visitors', curr: summary.visits, prev: previous.visits, fmt: fmtInt },
    { label: 'KYC Started', curr: summary.kycStarted, prev: previous.kycStarted, fmt: fmtInt },
    { label: 'Email Requests', curr: summary.emailsTotal, prev: previous.emailsTotal, fmt: fmtInt },
  ]
  return (
    <div className="glass rounded-3xl p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="display text-base font-bold">Period Difference Chart</h3>
        <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>
          Current vs previous equal period
        </span>
      </div>
      <div className="mt-4 space-y-3.5">
        {rows.map((r) => {
          const max = Math.max(1, r.curr, r.prev)
          const currPct = (r.curr / max) * 100
          const prevPct = (r.prev / max) * 100
          return (
            <div key={r.label} className="space-y-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{r.label}</span>
                <div className="flex items-center gap-2 tabular-nums">
                  <span style={{ color: 'var(--subtle)' }}>Prev: {r.fmt(r.prev)}</span>
                  <span className="font-bold">Now: {r.fmt(r.curr)}</span>
                  <DeltaBadge curr={r.curr} prev={r.prev} />
                </div>
              </div>
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--fill-2)' }}>
                  <div className="h-full rounded-full" style={{ width: `${currPct}%`, background: 'var(--accent-bg)' }} />
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--fill-2)' }}>
                  <div className="h-full rounded-full" style={{ width: `${prevPct}%`, background: 'var(--subtle)' }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CountryDropdown({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = value === 'ALL' ? COUNTRY_NAMES.ALL : `${value} — ${COUNTRY_NAMES[value] ?? value}`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-10 min-w-[210px] items-center justify-between gap-2.5 rounded-xl border px-3.5 text-xs font-semibold transition-colors hover:border-[var(--border-strong)]"
        style={{
          background: 'var(--inner-bg)',
          borderColor: open ? 'var(--border-strong)' : 'var(--border)',
          color: 'var(--ink)',
        }}
      >
        <span className="flex items-center gap-2 truncate">
          <Globe2 className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--muted)' }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Filter by country"
          className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-72 w-64 overflow-y-auto rounded-2xl border p-1.5 shadow-2xl"
          style={{
            background: 'var(--panel-solid)',
            borderColor: 'var(--border-strong)',
            boxShadow: 'var(--panel-shadow)',
          }}
        >
          {options.map((code) => {
            const selected = code === value
            const itemLabel = code === 'ALL' ? COUNTRY_NAMES.ALL : `${code} — ${COUNTRY_NAMES[code] ?? code}`
            return (
              <button
                key={code}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(code)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors hover:bg-[var(--fill-2)]"
                style={{
                  background: selected ? 'var(--fill-3)' : 'transparent',
                  color: selected ? 'var(--accent)' : 'var(--ink)',
                }}
              >
                <span className="truncate">{itemLabel}</span>
                {selected && <Check className="size-3.5 shrink-0" style={{ color: 'var(--accent)' }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function AnalyticsTab() {
  const { address: connectedWallet } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const session = useBackendSession()

  const [range, setRange] = useState<RangeKey>('30d')
  const [country, setCountry] = useState<string>('ALL')
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('volume')
  const [pieMode, setPieMode] = useState<PieMode>('country')
  const [customerSearch, setCustomerSearch] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [historyFilter, setHistoryFilter] = useState<'all' | 'p2p' | 'swap' | 'bridge' | 'failed'>('all')
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<AnalyticsPayload>(
        `/admin/analytics?range=${encodeURIComponent(range)}&country=${encodeURIComponent(country)}`,
      )
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load analytics.')
    } finally {
      setLoading(false)
    }
  }, [country, range, session])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  const handleSignIn = async () => {
    if (!connectedWallet) return
    setSigningIn(true)
    setError(null)
    try {
      await signInWithWallet(connectedWallet, signMessageAsync)
    } catch {
      setError('Wallet sign-in was cancelled or failed.')
    } finally {
      setSigningIn(false)
    }
  }

  const countryOptions = useMemo(() => {
    const codes = new Set(['ALL', 'BD', 'IN', 'PK', 'LK', 'NP', 'BT', 'MV', 'AF'])
    for (const c of data?.byCountry ?? []) codes.add(c.country)
    return Array.from(codes)
  }, [data?.byCountry])

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase()
    const list = data?.customers ?? []
    if (!q) return list
    return list.filter(
      (c) =>
        c.wallet.toLowerCase().includes(q) ||
        (c.displayName ?? '').toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q) ||
        c.chains.some((ch) => ch.toLowerCase().includes(q)),
    )
  }, [customerSearch, data?.customers])

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase()
    return (data?.history ?? []).filter((h) => {
      if (historyFilter === 'failed' && h.status !== 'failed') return false
      if (historyFilter !== 'all' && historyFilter !== 'failed' && h.kind !== historyFilter) return false
      if (!q) return true
      return (
        (h.txHash ?? '').toLowerCase().includes(q) ||
        h.wallet.toLowerCase().includes(q) ||
        (h.displayName ?? '').toLowerCase().includes(q) ||
        h.action.toLowerCase().includes(q) ||
        h.chain.toLowerCase().includes(q) ||
        h.country.toLowerCase().includes(q)
      )
    })
  }, [data?.history, historyFilter, historySearch])

  const exportCsv = () => {
    const rows = filteredHistory
    const header = ['Date', 'Time', 'TxHash', 'Wallet', 'User', 'Kind', 'Action', 'Chain', 'Token', 'AmountUSD', 'FeeUSD', 'Status', 'Country']
    const lines = [
      header.join(','),
      ...rows.map((r) => {
        const dt = new Date(r.createdAt)
        return [
          dt.toISOString().slice(0, 10),
          dt.toISOString().slice(11, 19),
          r.txHash ?? '',
          r.wallet,
          `"${(r.displayName ?? '').replace(/"/g, '""')}"`,
          r.kind,
          r.action,
          r.chain,
          r.token,
          r.amountUsd,
          r.networkFeeUsd,
          r.status,
          r.country,
        ].join(',')
      }),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `onpeer-analytics-${country.toLowerCase()}-${range}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const secondaryPieItems = useMemo(() => {
    if (!data?.summary) return []
    if (pieMode === 'country') {
      return data.byCountry
        .filter((c) => c.volume > 0 || c.visits > 0)
        .map((c) => ({
          label: `${c.country} (${COUNTRY_NAMES[c.country] ?? c.country})`,
          value: c.volume > 0 ? Math.round(c.volume) : c.visits,
          meta: c.volume > 0 ? fmtUsd(c.volume, 0) : `${c.visits} visits`,
        }))
    }
    if (pieMode === 'kind') {
      return data.byKind.map((k) => ({
        label: k.kind.toUpperCase(),
        value: k.txns,
        meta: fmtUsd(k.volume, 0),
      }))
    }
    return [
      { label: 'Success', value: data.summary.successTxns, meta: `${data.summary.successTxns} tx` },
      { label: 'Failed', value: data.summary.failedTxns, meta: `${data.summary.failedTxns} tx` },
    ].filter((x) => x.value > 0)
  }, [data, pieMode])

  if (!session) {
    return (
      <div className="glass rounded-3xl p-8 text-center">
        <BarChart3 className="mx-auto size-10" style={{ color: 'var(--accent)' }} />
        <h3 className="display mt-3 text-xl font-bold">Analytics &amp; Telemetry</h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm" style={{ color: 'var(--muted)' }}>
          Sign in with your admin wallet to view encrypted global and country-wise volume, transaction history, customer leaderboards, visits, emails, and KYC analytics.
        </p>
        <Button className="mt-5" loading={signingIn} disabled={!connectedWallet} onClick={() => void handleSignIn()}>
          <ShieldCheck className="size-4" /> Sign in to open Analytics
        </Button>
        {error && (
          <p className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Global / Country + Range Controls */}
      <div className="glass relative z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <CountryDropdown value={country} options={countryOptions} onChange={setCountry} />

          <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--fill-2)' }}>
            {(['7d', '30d', '90d', 'all'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className="rounded-lg px-2.5 py-1 text-xs font-bold uppercase transition-colors"
                style={{
                  background: range === r ? 'var(--accent-bg)' : 'transparent',
                  color: range === r ? 'var(--on-accent)' : 'var(--muted)',
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={exportCsv} disabled={!filteredHistory.length}>
            <Download className="size-3.5" /> Export CSV
          </Button>
          <Button variant="ghost" className="min-h-9 px-3 text-xs" loading={loading} onClick={() => void load()}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {data?.migrationRequired && (
        <div
          className="rounded-2xl p-4 text-xs"
          style={{ background: 'rgba(255,90,0,0.12)', border: '1px solid var(--border-strong)' }}
        >
          <p className="font-bold" style={{ color: 'var(--accent)' }}>
            Analytics database tables not initialized yet
          </p>
          <p className="mt-1" style={{ color: 'var(--muted)' }}>
            Run <span className="mono">db/migrations/0008_admin_analytics.sql</span> once in your Supabase SQL Editor, then click Refresh.
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-2xl px-4 py-3 text-xs" style={{ background: 'var(--fill-2)', color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {data?.summary && data.previous && (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              label="Total Volume"
              value={fmtUsd(data.summary.totalVolume)}
              sub={`Scope: ${country === 'ALL' ? 'Global' : country}`}
              curr={data.summary.totalVolume}
              prev={data.previous.totalVolume}
              tone="var(--accent)"
            />
            <KpiCard
              label="Total Txns"
              value={fmtInt(data.summary.totalTxns)}
              sub={`${data.summary.successTxns} ok · ${data.summary.failedTxns} failed`}
              curr={data.summary.totalTxns}
              prev={data.previous.totalTxns}
            />
            <KpiCard
              label="Highest Amount"
              value={fmtUsd(data.summary.highestAmount)}
              sub="Single successful tx"
            />
            <KpiCard
              label="Lowest Amount"
              value={fmtUsd(data.summary.lowestAmount)}
              sub="Single successful tx"
            />
            <KpiCard
              label="Tx Success Rate"
              value={`${data.summary.successRate.toFixed(1)}%`}
              sub={`Avg fee: ${fmtFee(data.summary.avgNetworkFee)}`}
              tone={data.summary.successRate >= 95 ? 'var(--success)' : 'var(--warn)'}
            />
            <KpiCard
              label="Avg Network Fee"
              value={fmtFee(data.summary.avgNetworkFee)}
              sub={`Total fees: ${fmtFee(data.summary.totalNetworkFee)}`}
            />
            <KpiCard
              label="Chain Usage"
              value={`${data.byChain.length} ${data.byChain.length === 1 ? 'Chain' : 'Chains'}`}
              sub={data.byChain[0] ? `Top: ${data.byChain[0].chain} (${data.byChain[0].txns} tx)` : 'No tx yet'}
            />
            <KpiCard
              label="Visitors"
              value={fmtInt(data.summary.visits)}
              sub={`${fmtInt(data.summary.uniqueVisitors)} unique visitors`}
              curr={data.summary.visits}
              prev={data.previous.visits}
            />
            <KpiCard
              label="KYC Sessions"
              value={fmtInt(data.summary.kycStarted)}
              sub={`${data.summary.kycApproved} ok · ${data.summary.kycPending} pend · ${data.summary.kycDeclined} rej`}
              curr={data.summary.kycStarted}
              prev={data.previous.kycStarted}
            />
            <KpiCard
              label="Email Requests"
              value={fmtInt(data.summary.emailsTotal)}
              sub={`${data.summary.emailsSent} sent · ${data.summary.emailsFailed} failed`}
              curr={data.summary.emailsTotal}
              prev={data.previous.emailsTotal}
            />
          </div>

          {/* Trend Line/Area Chart + Period Difference Chart */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="glass rounded-3xl p-5 lg:col-span-2">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="display text-base font-bold">Daily Activity Graph</h3>
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      ['volume', 'Volume'],
                      ['txns', 'Txns'],
                      ['visits', 'Visitors'],
                      ['kyc_email', 'KYC & Emails'],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTrendMetric(k)}
                      className="rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors"
                      style={{
                        background: trendMetric === k ? 'var(--accent-bg)' : 'var(--fill-2)',
                        color: trendMetric === k ? 'var(--on-accent)' : 'var(--muted)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <AreaTrendChart series={data.dailySeries} metric={trendMetric} />
            </div>

            <DifferenceComparisonChart summary={data.summary} previous={data.previous} />
          </div>

          {/* Pie Charts: Chain Usage + Country / Kind / Status */}
          <div className="grid gap-4 lg:grid-cols-2">
            <DonutChart
              title="Chain Usage Breakdown"
              items={data.byChain.map((c) => ({
                label: c.chain,
                value: c.txns,
                meta: `${fmtUsd(c.volume, 0)} · ${c.successRate.toFixed(0)}% ok`,
              }))}
              emptyLabel="No chain transactions recorded in this period yet."
            />

            <div className="space-y-2">
              <div className="flex justify-end gap-1">
                {(
                  [
                    ['country', 'By Country'],
                    ['kind', 'P2P / Swap / Bridge'],
                    ['status', 'Success / Failed'],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPieMode(m)}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-bold"
                    style={{
                      background: pieMode === m ? 'var(--accent-bg)' : 'var(--fill-2)',
                      color: pieMode === m ? 'var(--on-accent)' : 'var(--muted)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <DonutChart
                title={
                  pieMode === 'country'
                    ? 'Country Share'
                    : pieMode === 'kind'
                      ? 'Product Mix (P2P / Swap / Bridge)'
                      : 'Transaction Outcome'
                }
                items={secondaryPieItems}
                emptyLabel="No activity recorded for this breakdown yet."
              />
            </div>
          </div>

          {/* Country-wise Global Breakdown */}
          <section className="glass rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="display text-base font-bold">Country-wise Breakdown (Click to filter)</h3>
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  Global traffic, KYC approvals, verified emails, volume, and transaction success rate per country.
                </p>
              </div>
              {country !== 'ALL' && (
                <Button variant="ghost" className="min-h-8 px-3 text-xs" onClick={() => setCountry('ALL')}>
                  Reset to Global
                </Button>
              )}
            </div>
            <div className="mt-3 overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead style={{ background: 'var(--fill-2)', color: 'var(--subtle)' }}>
                  <tr>
                    <th className="px-3.5 py-2.5 font-semibold">Country</th>
                    <th className="px-3.5 py-2.5 font-semibold">Visits (Unique)</th>
                    <th className="px-3.5 py-2.5 font-semibold">Accounts</th>
                    <th className="px-3.5 py-2.5 font-semibold">KYC OK</th>
                    <th className="px-3.5 py-2.5 font-semibold">Email Verified</th>
                    <th className="px-3.5 py-2.5 font-semibold">Txns</th>
                    <th className="px-3.5 py-2.5 font-semibold">Volume</th>
                    <th className="px-3.5 py-2.5 text-right font-semibold">Success Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {data.byCountry.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center" style={{ color: 'var(--subtle)' }}>
                        No country data recorded yet.
                      </td>
                    </tr>
                  ) : (
                    data.byCountry.map((c) => (
                      <tr
                        key={c.country}
                        onClick={() => setCountry(c.country)}
                        className="cursor-pointer transition-colors hover:bg-[var(--fill-2)]"
                        style={country === c.country ? { background: 'var(--fill-3)' } : undefined}
                      >
                        <td className="px-3.5 py-2.5 font-bold">
                          {c.country} · {COUNTRY_NAMES[c.country] ?? c.country}
                        </td>
                        <td className="mono px-3.5 py-2.5 tabular-nums">
                          {fmtInt(c.visits)} ({fmtInt(c.uniqueVisitors)})
                        </td>
                        <td className="mono px-3.5 py-2.5 tabular-nums">{fmtInt(c.accounts)}</td>
                        <td className="mono px-3.5 py-2.5 tabular-nums" style={{ color: 'var(--success)' }}>
                          {fmtInt(c.kycApproved)}
                        </td>
                        <td className="mono px-3.5 py-2.5 tabular-nums">{fmtInt(c.emailVerified)}</td>
                        <td className="mono px-3.5 py-2.5 tabular-nums">{fmtInt(c.txns)}</td>
                        <td className="mono px-3.5 py-2.5 font-bold tabular-nums">{fmtUsd(c.volume)}</td>
                        <td className="mono px-3.5 py-2.5 text-right tabular-nums">
                          {c.txns > 0 ? `${c.successRate.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Customer-wise Leaderboard */}
          <section className="glass rounded-3xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="display text-base font-bold">Customer Analytics ({filteredCustomers.length})</h3>
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  Per-customer volume, transaction count, highest/lowest amounts, success rate, avg network fee, and chain usage.
                </p>
              </div>
              <span className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
                <input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Search wallet, name, country, chain..."
                  className={`${inputClass} h-9 pl-8 text-xs`}
                />
              </span>
            </div>
            <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead style={{ background: 'var(--fill-2)', color: 'var(--subtle)' }}>
                  <tr>
                    <th className="px-3.5 py-2.5 font-semibold">Customer</th>
                    <th className="px-3.5 py-2.5 font-semibold">Country</th>
                    <th className="px-3.5 py-2.5 font-semibold">Total Volume</th>
                    <th className="px-3.5 py-2.5 font-semibold">Txns</th>
                    <th className="px-3.5 py-2.5 font-semibold">Highest / Lowest</th>
                    <th className="px-3.5 py-2.5 font-semibold">Success Rate</th>
                    <th className="px-3.5 py-2.5 font-semibold">Avg Fee</th>
                    <th className="px-3.5 py-2.5 font-semibold">Chains Used</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center" style={{ color: 'var(--subtle)' }}>
                        No customer transactions in this filter yet.
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map((u) => (
                      <tr key={u.wallet} className="hover:bg-[var(--fill-2)]">
                        <td className="px-3.5 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold">{u.displayName || shortAddr(u.wallet)}</span>
                            <CopyButton text={u.wallet} />
                          </div>
                          <span className="mono text-[10px]" style={{ color: 'var(--subtle)' }}>
                            {shortAddr(u.wallet)} · KYC: {u.kycStatus}
                          </span>
                        </td>
                        <td className="mono px-3.5 py-2.5">{u.country}</td>
                        <td className="mono px-3.5 py-2.5 font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
                          {fmtUsd(u.totalVolume)}
                        </td>
                        <td className="mono px-3.5 py-2.5 tabular-nums">{u.totalTxns}</td>
                        <td className="mono px-3.5 py-2.5 tabular-nums">
                          {fmtUsd(u.highestAmount)} / {fmtUsd(u.lowestAmount)}
                        </td>
                        <td
                          className="mono px-3.5 py-2.5 font-semibold tabular-nums"
                          style={{ color: u.successRate >= 95 ? 'var(--success)' : 'var(--warn)' }}
                        >
                          {u.successRate.toFixed(1)}%
                        </td>
                        <td className="mono px-3.5 py-2.5 tabular-nums">{fmtFee(u.avgNetworkFee)}</td>
                        <td className="px-3.5 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {u.chains.map((ch) => (
                              <span
                                key={ch}
                                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                style={{ background: 'var(--fill-3)' }}
                              >
                                {ch}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Full Historical Transactions Table */}
          <section className="glass rounded-3xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="display text-base font-bold">Historical Transactions ({filteredHistory.length})</h3>
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  Every recorded transaction with hash, date, time, user, chain, amount, fee, country, and status.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1">
                  {(['all', 'p2p', 'swap', 'bridge', 'failed'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setHistoryFilter(f)}
                      className="rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase"
                      style={{
                        background: historyFilter === f ? 'var(--accent-bg)' : 'var(--fill-2)',
                        color: historyFilter === f ? 'var(--on-accent)' : 'var(--muted)',
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <span className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
                  <input
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search hash, wallet, action..."
                    className={`${inputClass} h-9 pl-8 text-xs`}
                  />
                </span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full min-w-[920px] text-left text-xs">
                <thead style={{ background: 'var(--fill-2)', color: 'var(--subtle)' }}>
                  <tr>
                    <th className="px-3.5 py-2.5 font-semibold">Date &amp; Time</th>
                    <th className="px-3.5 py-2.5 font-semibold">User</th>
                    <th className="px-3.5 py-2.5 font-semibold">Type / Action</th>
                    <th className="px-3.5 py-2.5 font-semibold">Chain</th>
                    <th className="px-3.5 py-2.5 font-semibold">Amount</th>
                    <th className="px-3.5 py-2.5 font-semibold">Fee</th>
                    <th className="px-3.5 py-2.5 font-semibold">Country</th>
                    <th className="px-3.5 py-2.5 font-semibold">Status</th>
                    <th className="px-3.5 py-2.5 text-right font-semibold">Tx Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {filteredHistory.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-center" style={{ color: 'var(--subtle)' }}>
                        No transactions recorded in this filter yet.
                      </td>
                    </tr>
                  ) : (
                    filteredHistory.map((h) => {
                      const dt = new Date(h.createdAt)
                      const explorer = h.txHash ? buildTxExplorerUrl(CHAIN_ID, h.txHash) : null
                      return (
                        <tr key={h.id} className="hover:bg-[var(--fill-2)]">
                          <td className="mono whitespace-nowrap px-3.5 py-2.5 tabular-nums">
                            {dt.toISOString().slice(0, 10)}{' '}
                            <span style={{ color: 'var(--subtle)' }}>{dt.toISOString().slice(11, 19)}</span>
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="font-semibold">{h.displayName || shortAddr(h.wallet)}</span>
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--fill-3)' }}>
                              {h.kind}
                            </span>{' '}
                            <span className="mono text-[11px]" style={{ color: 'var(--muted)' }}>
                              {h.action}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5">{h.chain}</td>
                          <td className="mono px-3.5 py-2.5 font-bold tabular-nums">
                            {h.amountUsd > 0 ? `${fmtUsd(h.amountUsd)} ${h.token}` : `— ${h.token}`}
                          </td>
                          <td className="mono px-3.5 py-2.5 tabular-nums">{fmtFee(h.networkFeeUsd)}</td>
                          <td className="mono px-3.5 py-2.5">{h.country}</td>
                          <td className="px-3.5 py-2.5">
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                              style={{
                                background: h.status === 'success' ? 'rgba(126,241,179,0.14)' : 'rgba(255,107,139,0.14)',
                                color: h.status === 'success' ? 'var(--success)' : 'var(--danger)',
                              }}
                            >
                              {h.status}
                            </span>
                          </td>
                          <td className="mono px-3.5 py-2.5 text-right">
                            {h.txHash ? (
                              <span className="inline-flex items-center gap-1.5">
                                {explorer ? (
                                  <a
                                    href={explorer}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 underline"
                                    style={{ color: 'var(--accent)' }}
                                  >
                                    {shortAddr(h.txHash)} <ExternalLink className="size-3" />
                                  </a>
                                ) : (
                                  <span>{shortAddr(h.txHash)}</span>
                                )}
                                <CopyButton text={h.txHash} />
                              </span>
                            ) : (
                              <span style={{ color: 'var(--subtle)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
