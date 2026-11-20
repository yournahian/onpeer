import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ConnectKitButton } from 'connectkit'
import { Activity, Gavel, LayoutDashboard, Search, Settings2, Sparkles, Users } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { zeroAddress } from 'viem'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, ESCROW_ADDRESS, STATUS, formatUsdcAmount, shortAddr } from '@/lib/p2p'
import { useAds, useAccounts, useFeeConfig, useOrder, useOrders, usePaused, useVerifier } from '@/hooks/useEscrow'
import { useAdminRoles } from '@/hooks/useAdmin'
import { SiteBar } from '@/components/SiteBar'
import { Button, CopyButton, Empty, SkeletonRows, inputClass } from '@/components/ui'
import { Reveal } from '@/components/fx/Reveal'
import { RollingNumber } from '@/components/fx/RollingNumber'
import { DisputeCard } from '@/components/admin/DisputeCard'
import { AccountsTab } from '@/components/admin/AccountsTab'
import { ControlsTab } from '@/components/admin/ControlsTab'
import { AiProviderTab } from '@/components/admin/AiProviderTab'
import { FilingsTab } from '@/components/admin/FilingsTab'
import { JobHealthCard } from '@/components/admin/JobHealthCard'

type Tab = 'overview' | 'disputes' | 'filings' | 'accounts' | 'controls' | 'ai'

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="glass spotlight rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--subtle)' }}>{label}</p>
      <p className="display mt-1 text-3xl font-bold tabular-nums" style={{ color: tone }}>
        <RollingNumber value={value} />
      </p>
    </div>
  )
}

function Gate({ title, body, connect }: { title: string; body: string; connect?: boolean }) {
  return (
    <div className="mx-auto mt-16 max-w-md px-4 text-center">
      <div className="glass rounded-3xl p-8">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl" style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}>
          <Gavel className="size-6" />
        </span>
        <h1 className="display mt-4 text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-pretty" style={{ color: 'var(--muted)' }}>{body}</p>
        {connect && (
          <ConnectKitButton.Custom>
            {({ show }) => (
              <Button className="mt-6 w-full" onClick={show}>
                Connect wallet
              </Button>
            )}
          </ConnectKitButton.Custom>
        )}
      </div>
    </div>
  )
}

export default function AdminPage() {
  const roles = useAdminRoles()
  const { orders, isLoading } = useOrders()
  const { ads } = useAds()
  const paused = usePaused()
  const feeConfig = useFeeConfig()
  const verifier = useVerifier()
  const [tab, setTab] = useState<Tab>('overview')
  const [caseQuery, setCaseQuery] = useState('')
  const parsedCaseId = /^\d+$/.test(caseQuery.trim()) ? BigInt(caseQuery.trim()) : undefined
  const { order: lookedOrder } = useOrder(parsedCaseId)

  const disputed = useMemo(
    () => orders.filter((o) => o.status === STATUS.DISPUTED).sort((a, b) => Number(a.disputedAt - b.disputedAt)),
    [orders],
  )
  const paidCases = useMemo(
    () => orders.filter((o) => o.status === STATUS.PAID).sort((a, b) => Number(a.paidAt - b.paidAt)),
    [orders],
  )
  const parties = useMemo(
    () => [
      ...disputed.flatMap((o) => [o.buyer, o.seller]),
      ...paidCases.flatMap((o) => [o.buyer, o.seller]),
      ...(lookedOrder ? [lookedOrder.buyer, lookedOrder.seller] : []),
    ],
    [disputed, paidCases, lookedOrder],
  )
  const accounts = useAccounts(parties)

  const stats = useMemo(() => {
    let active = 0
    let completed = 0
    let settled = 0
    let held = 0n
    for (const o of orders) {
      if (o.status === STATUS.PENDING || o.status === STATUS.PAID || o.status === STATUS.DISPUTED) {
        active++
        held += o.amount
      }
      if (o.status === STATUS.COMPLETED) completed++
      if (o.status === STATUS.SETTLED) settled++
    }
    for (const a of ads) if (a.side === 0 && !a.closed) held += a.available
    return { active, completed, settled, held }
  }, [orders, ads])

  const resolved = useMemo(
    () =>
      orders
        .filter(
          (o) =>
            o.status === STATUS.RESOLVED_BUYER ||
            o.status === STATUS.RESOLVED_SELLER ||
            o.status === STATUS.SETTLED,
        )
        .slice(0, 6),
    [orders],
  )

  if (!ESCROW_ADDRESS) return (<><SiteBar /><Gate title="Contract not connected" body="The escrow contract address is not configured for this app." /></>)
  if (!roles.isConnected) return (<><SiteBar /><Gate title="Admin panel" body="Connect the owner or arbiter wallet to review disputes and manage the marketplace." connect /></>)
  if (!roles.loading && !roles.isAdmin)
    return (
      <>
        <SiteBar />
        <Gate title="Admin access only" body={`This area is for the contract owner and the dispute arbiter. You are connected as ${shortAddr(roles.address ?? '')}.`} />
      </>
    )

  const tabs: { id: Tab; label: string; icon: typeof Users; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'disputes', label: 'Disputes', icon: Gavel, badge: disputed.length },
    { id: 'filings', label: 'Filings', icon: Gavel },
    { id: 'accounts', label: 'Accounts', icon: Users },
    { id: 'controls', label: 'Controls', icon: Settings2 },
    { id: 'ai', label: 'AI provider', icon: Sparkles },
  ]

  return (
    <div className="min-h-dvh">
      <SiteBar />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 lg:px-12">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>Admin</p>
              <h1 className="display text-gradient mt-1 text-3xl font-bold sm:text-4xl">Marketplace control room</h1>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              {roles.isOwner && <span className="rounded-full px-3 py-1.5" style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}>Owner</span>}
              {roles.isArbiter && <span className="rounded-full px-3 py-1.5" style={{ background: 'var(--fill-3)', color: 'var(--success)' }}>Arbiter</span>}
              {roles.isBackupArbiter && !roles.isArbiter && <span className="rounded-full px-3 py-1.5" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>Backup arbiter</span>}
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ background: 'var(--fill-2)', color: paused ? 'var(--danger)' : 'var(--success)' }}>
                <span className="live-dot" /> {paused ? 'Paused' : 'Live'}
              </span>
            </div>
          </div>
        </Reveal>

        <nav className="relative mt-6 flex gap-1 overflow-x-auto rounded-2xl p-1" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }} aria-label="Admin sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className="relative flex min-h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold"
              style={{ color: tab === t.id ? 'var(--on-accent)' : 'var(--muted)' }}
            >
              {tab === t.id && (
                <motion.span layoutId="admin-pill" className="absolute inset-0 rounded-xl" style={{ background: 'var(--accent-bg)' }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
              )}
              <span className="relative flex items-center gap-2">
                <t.icon className="size-4" /> {t.label}
                {!!t.badge && (
                  <span className="rounded-full px-1.5 text-[11px] font-bold" style={{ background: 'var(--danger)', color: '#fff' }}>{t.badge}</span>
                )}
              </span>
            </button>
          ))}
        </nav>

        <div className="mt-6">
          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Tile label="Open disputes" value={String(disputed.length)} tone={disputed.length ? 'var(--danger)' : undefined} />
                <Tile label="Active orders" value={String(stats.active)} />
                <Tile label="Completed orders" value={String(stats.completed)} tone="var(--success)" />
                <Tile label="Settled disputes" value={String(stats.settled)} />
                <Tile label="Total ads" value={String(ads.length)} />
                <Tile label="Accrued fees" value={`${formatUsdcAmount(feeConfig.feesAccrued)} USDC`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                <section className="glass rounded-3xl p-5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold"><TokenUSDC variant="branded" size={18} /> USDC held in escrow</h2>
                  <p className="display mt-2 text-4xl font-bold tabular-nums"><RollingNumber value={formatUsdcAmount(stats.held)} /></p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>Active orders plus sell-ad inventory, from the latest 200 records. Listing fee: {formatUsdcAmount(feeConfig.listingFee)} USDC/ad.</p>
                </section>
                <section className="glass rounded-3xl p-5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold"><Activity className="size-4" /> Roles</h2>
                  <dl className="mt-3 space-y-2 text-sm">
                    {[
                      ['Owner', roles.owner],
                      ['Arbiter', roles.arbiter],
                      ['Backup arbiter', roles.backupArbiter],
                      ['Fee recipient', feeConfig.feeRecipient],
                      ['KYC verifier', verifier && verifier !== zeroAddress ? verifier : undefined],
                      ['Contract', ESCROW_ADDRESS],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-3">
                        <dt style={{ color: 'var(--subtle)' }}>{k}</dt>
                        <dd className="mono flex items-center gap-2 text-xs">
                          {v ? (
                            k === 'Contract' ? (
                              <a href={buildAddressExplorerUrl(CHAIN_ID, v)} target="_blank" rel="noopener noreferrer" className="underline">{shortAddr(v)}</a>
                            ) : (
                              shortAddr(v)
                            )
                          ) : '...'}
                          {v && <CopyButton text={v} label="Copy" />}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
              <JobHealthCard />
              <section>
                <h2 className="mb-3 text-sm font-semibold">Recently resolved &amp; settled</h2>
                {resolved.length === 0 ? (
                  <Empty title="No rulings yet" body="Resolved and party-settled disputes will be listed here." />
                ) : (
                  <ul className="space-y-2">
                    {resolved.map((o) => (
                      <li key={o.id.toString()} className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm">
                        <span className="font-semibold">Order #{o.id.toString()} · {formatUsdcAmount(o.amount)} USDC</span>
                        <span style={{ color: o.status === STATUS.RESOLVED_BUYER ? 'var(--success)' : 'var(--subtle)' }}>
                          {o.status === STATUS.RESOLVED_BUYER
                            ? 'Released to buyer'
                            : o.status === STATUS.RESOLVED_SELLER
                              ? 'Returned to seller'
                              : 'Settled by parties'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {tab === 'disputes' && (
            <div className="space-y-5">
              <div className="glass rounded-3xl p-4 sm:p-5">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                    Offchain dispute / Paid order lookup (Take case or rule directly)
                  </span>
                  <span className="relative block">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
                    <input
                      value={caseQuery}
                      onChange={(e) => setCaseQuery(e.target.value)}
                      placeholder="Enter Order ID (e.g. 12) to take case or rule from Paid / Disputed"
                      className={`${inputClass} mono pl-10 text-sm`}
                    />
                  </span>
                </label>
                {parsedCaseId !== undefined && !lookedOrder && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>Order #{parsedCaseId.toString()} not found.</p>
                )}
              </div>

              {lookedOrder && (lookedOrder.status === STATUS.PAID || lookedOrder.status === STATUS.DISPUTED) && (
                <ul className="space-y-3">
                  <DisputeCard
                    order={lookedOrder}
                    accounts={accounts}
                    isPrimaryArbiter={roles.isArbiter}
                    isBackupArbiter={roles.isBackupArbiter}
                    viewer={roles.address}
                  />
                </ul>
              )}

              {isLoading ? (
                <SkeletonRows n={2} />
              ) : disputed.length === 0 && paidCases.length === 0 ? (
                <Empty title="No open disputes" body="Onchain disputes and Paid orders eligible for case intake appear here, oldest first." />
              ) : (
                <div className="space-y-4">
                  {disputed.length > 0 && (
                    <section className="space-y-3">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                        Disputed orders ({disputed.length})
                      </h3>
                      <ul className="space-y-3">
                        {disputed.map((o) => (
                          <DisputeCard
                            key={o.id.toString()}
                            order={o}
                            accounts={accounts}
                            isPrimaryArbiter={roles.isArbiter}
                            isBackupArbiter={roles.isBackupArbiter}
                            viewer={roles.address}
                          />
                        ))}
                      </ul>
                    </section>
                  )}
                  {paidCases.length > 0 && (
                    <section className="space-y-3">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                        Paid orders awaiting release (eligible for Take case after 15m)
                      </h3>
                      <ul className="space-y-3">
                        {paidCases.map((o) => (
                          <DisputeCard
                            key={o.id.toString()}
                            order={o}
                            accounts={accounts}
                            isPrimaryArbiter={roles.isArbiter}
                            isBackupArbiter={roles.isBackupArbiter}
                            viewer={roles.address}
                          />
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'accounts' && <AccountsTab canWrite={roles.isOwner || roles.isArbiter} canRevokeKyc={roles.isOwner} />}
          {tab === 'filings' && <FilingsTab />}
          {tab === 'controls' && <ControlsTab isOwner={roles.isOwner} />}
          {tab === 'ai' && <AiProviderTab />}
        </div>
      </main>
    </div>
  )
}
