import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, ShieldAlert, ShieldCheck } from 'lucide-react'
import { isAddress, type Address } from 'viem'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  P2P_ASSETS,
  TIER_TABLE,
  formatDuration,
  formatOrderCap,
  formatUsdcAmount,
  getEscrowConfig,
  shortAddr,
  type P2pAsset,
} from '@/lib/p2p'
import {
  useAccounts,
  useAllAds,
  useDebts,
  useDisputeWaived,
  useNow,
  useOrders,
  useVerifications,
  type Account,
  type KycInfo,
} from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { Avatar, Button, CopyButton, Empty, inputClass } from '@/components/ui'
import { CoinLogo } from '@/components/logos'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inner rounded-xl p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>{label}</p>
      <p className="display mt-0.5 text-lg font-bold tabular-nums">{value}</p>
    </div>
  )
}

function RestrictedRow({
  address,
  account,
  asset,
  applyAllAssets,
  canWrite,
  onInspect,
}: {
  address: Address
  account: Account
  asset: P2pAsset
  applyAllAssets: boolean
  canWrite: boolean
  onInspect: (addr: Address) => void
}) {
  const now = useNow()
  const waived = useDisputeWaived(address, asset)
  const { run, writeContractAsync, pendingKey } = useTx(asset)
  const bannedLeft = Number(account.bannedUntil) - now
  const targets = applyAllAssets
    ? P2P_ASSETS.map((a) => getEscrowConfig(a).escrowAddress)
    : [getEscrowConfig(asset).escrowAddress]

  const liftAdminRestrict = () =>
    run(`row-restrict-${address}`, 'Lift account restriction', async () => {
      let lastHash: `0x${string}` = '0x0'
      for (const escrowAddr of targets) {
        lastHash = await writeContractAsync({
          address: escrowAddr,
          abi: p2pEscrowAbi,
          functionName: 'setRestricted',
          args: [address, false],
          chainId: CHAIN_ID,
        })
      }
      return lastHash
    })

  const waiveDisputeLimit = () =>
    run(`row-waiver-${address}`, 'Turn off lost-dispute restriction', async () => {
      let lastHash: `0x${string}` = '0x0'
      for (const escrowAddr of targets) {
        lastHash = await writeContractAsync({
          address: escrowAddr,
          abi: p2pEscrowAbi,
          functionName: 'setDisputeWaiver',
          args: [address, true],
          chainId: CHAIN_ID,
        })
      }
      return lastHash
    })

  return (
    <li className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar address={address} size={38} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-sm font-semibold">{shortAddr(address)}</span>
            <CopyButton text={address} label="Copy" />
            {account.restricted && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>
                Admin Restricted
              </span>
            )}
            {account.disputeLimitReached && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>
                Dispute Limit Restricted ({account.disputesLost} lost)
              </span>
            )}
            {account.totalDebt > 0n && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>
                Unpaid Bond Debt: {formatUsdcAmount(account.totalDebt, undefined, asset)} {asset}
              </span>
            )}
            {bannedLeft > 0 && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>
                Cancel Cooldown ({formatDuration(bannedLeft)})
              </span>
            )}
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
            {account.disputeLimitReached || account.restricted
              ? 'Blocked with: "This account is restricted from opening new trades."'
              : account.totalDebt > 0n
                ? 'Blocked until user repays their unpaid dispute bond on Account & Margin.'
                : 'Temporarily in 24h cancellation cooldown.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canWrite && account.disputeLimitReached && !waived && (
          <Button
            variant="buy"
            loading={pendingKey === `row-waiver-${address}`}
            onClick={() => void waiveDisputeLimit()}
          >
            <ShieldCheck className="size-4" /> Turn Off Dispute Restriction
          </Button>
        )}
        {canWrite && account.restricted && (
          <Button
            variant="buy"
            loading={pendingKey === `row-restrict-${address}`}
            onClick={() => void liftAdminRestrict()}
          >
            <ShieldCheck className="size-4" /> Lift Admin Restriction
          </Button>
        )}
        <Button variant="ghost" onClick={() => onInspect(address)}>
          Details
        </Button>
      </div>
    </li>
  )
}

function AccountPanel({
  address,
  account,
  asset,
  applyAllAssets,
  kyc,
  canWrite,
  canRevokeKyc,
}: {
  address: Address
  account: Account
  asset: P2pAsset
  applyAllAssets: boolean
  kyc?: KycInfo
  canWrite: boolean
  canRevokeKyc: boolean
}) {
  const now = useNow()
  const debts = useDebts(address, asset)
  const waived = useDisputeWaived(address, asset)
  const { run, writeContractAsync, pendingKey } = useTx(asset)
  const banned = Number(account.bannedUntil) > now
  const tierMeta = TIER_TABLE[account.tier] ?? TIER_TABLE[0]
  const kycText = kyc?.verified
    ? `Verified L${kyc.level}`
    : kyc && kyc.level > 0
      ? `Expired (L${kyc.level})`
      : 'Unverified'
  const targets = applyAllAssets
    ? P2P_ASSETS.map((a) => getEscrowConfig(a).escrowAddress)
    : [getEscrowConfig(asset).escrowAddress]

  const flipRestrict = () =>
    run(`restrict-${address}`, account.restricted ? 'Lift restriction' : 'Restrict account', async () => {
      let lastHash: `0x${string}` = '0x0'
      for (const escrowAddr of targets) {
        lastHash = await writeContractAsync({
          address: escrowAddr,
          abi: p2pEscrowAbi,
          functionName: 'setRestricted',
          args: [address, !account.restricted],
          chainId: CHAIN_ID,
        })
      }
      return lastHash
    })
  const flipWaiver = () =>
    run(`waiver-${address}`, waived ? 'Reinstate dispute limit' : 'Waive dispute limit', async () => {
      let lastHash: `0x${string}` = '0x0'
      for (const escrowAddr of targets) {
        lastHash = await writeContractAsync({
          address: escrowAddr,
          abi: p2pEscrowAbi,
          functionName: 'setDisputeWaiver',
          args: [address, !waived],
          chainId: CHAIN_ID,
        })
      }
      return lastHash
    })
  const revokeKyc = () =>
    run(`revoke-kyc-${address}`, 'Revoke KYC verification', async () => {
      let lastHash: `0x${string}` = '0x0'
      for (const escrowAddr of targets) {
        lastHash = await writeContractAsync({
          address: escrowAddr,
          abi: p2pEscrowAbi,
          functionName: 'revokeVerification',
          args: [address],
          chainId: CHAIN_ID,
        })
      }
      return lastHash
    })

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-3xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar address={address} size={44} />
        <div className="min-w-0 flex-1">
          <p className="mono truncate text-sm font-semibold">{address}</p>
          <p className="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold">
            <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--fill-2)', color: 'var(--text)' }}>
              {asset} · Tier {account.tier} · {tierMeta.label}
            </span>
            <span
              className="rounded-full px-2 py-0.5"
              style={{
                background: 'var(--fill-3)',
                color: kyc?.verified ? 'var(--success)' : 'var(--subtle)',
              }}
            >
              KYC: {kycText}
            </span>
            {account.merchant && <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}>Merchant</span>}
            {account.restricted && <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>Restricted</span>}
            {account.disputeLimitReached && <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>Dispute limit reached</span>}
            {waived && <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--success)' }}>Dispute limit waived</span>}
            {account.totalDebt > 0n && <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>Bond debt owed</span>}
            {banned && <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>Cooldown</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRevokeKyc && kyc && kyc.level > 0 && (
            <Button variant="ghost" loading={pendingKey === `revoke-kyc-${address}`} onClick={() => void revokeKyc()}>
              Revoke KYC
            </Button>
          )}
          {canWrite && (account.disputeLimitReached || waived) && (
            <Button
              variant={waived ? 'ghost' : 'buy'}
              loading={pendingKey === `waiver-${address}`}
              onClick={() => void flipWaiver()}
            >
              {waived ? 'Reinstate dispute limit' : 'Turn Off Dispute Restriction (Waive)'}
            </Button>
          )}
          {canWrite && (
            <Button variant={account.restricted ? 'buy' : 'danger'} loading={pendingKey === `restrict-${address}`} onClick={() => void flipRestrict()}>
              {account.restricted ? 'Lift restriction' : 'Restrict account'}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Tier & cap" value={`T${account.tier} · ${formatOrderCap(account.orderCap, asset)}`} />
        <Stat label="KYC status" value={kycText} />
        <Stat label="Completed" value={String(account.ordersCompleted)} />
        <Stat label="Disputes lost" value={String(account.disputesLost)} />
        <Stat label="Concessions" value={`${account.concessions} (2 = 1 loss)`} />
        <Stat label="Disputes settled" value={String(account.disputesSettled)} />
        <Stat label="Late marks (30d)" value={`${account.lateMarks} / 2`} />
        <Stat label="Unpaid debt" value={`${formatUsdcAmount(account.totalDebt, undefined, asset)} ${asset}`} />
        <Stat label="Margin" value={`${formatUsdcAmount(account.effectiveMargin, undefined, asset)} ${asset}`} />
        <Stat label="Strikes" value={`${account.strikes} / 3`} />
        <Stat label="Open orders" value={String(account.partyOpen)} />
        <Stat label="Volume" value={`${formatUsdcAmount(account.volume, undefined, asset)} ${asset}`} />
      </div>
      {kyc && kyc.expiry > 0n && (
        <p className="mt-2 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
          KYC expiry: {new Date(Number(kyc.expiry) * 1000).toLocaleString()}
        </p>
      )}
      {debts.length > 0 && (
        <div className="mt-4 rounded-2xl p-3 text-xs" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
          <p className="font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
            Unpaid dispute bonds ({debts.length})
          </p>
          <ul className="mt-2 space-y-1.5">
            {debts.map((d, idx) => (
              <li key={`${d.creditor}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 tabular-nums">
                <span>Owed to <span className="mono">{shortAddr(d.creditor)}</span></span>
                <span className="font-semibold" style={{ color: 'var(--warn)' }}>
                  {formatUsdcAmount(d.amount, undefined, asset)} {asset}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>
        Every 2 post-cooling-off concessions count as 1 lost dispute; settling after arbiter review starts counts as 1 lost dispute with 0 bond. Waiving lifts the dispute limit until the next effective loss.
      </p>
    </motion.div>
  )
}

export function AccountsTab({ canWrite = true, canRevokeKyc = false }: { canWrite?: boolean; canRevokeKyc?: boolean }) {
  const [selectedAsset, setSelectedAsset] = useState<P2pAsset>('USDC')
  const [applyAllAssets, setApplyAllAssets] = useState(false)
  const [query, setQuery] = useState('')
  const target = isAddress(query.trim()) ? (query.trim() as Address) : undefined
  const { orders } = useOrders()
  const { ads } = useAllAds()
  const now = useNow()

  const watch = useMemo(() => {
    const s = new Set<string>()
    for (const o of orders.slice(0, 100)) {
      s.add(o.buyer.toLowerCase())
      s.add(o.seller.toLowerCase())
    }
    for (const a of ads.slice(0, 100)) {
      s.add(a.maker.toLowerCase())
    }
    return Array.from(s) as Address[]
  }, [orders, ads])

  const list = useMemo(() => (target ? [target, ...watch] : watch), [target, watch])
  const accounts = useAccounts(list, selectedAsset)
  const verifications = useVerifications(list, selectedAsset)
  const looked = target ? accounts.get(target.toLowerCase()) : undefined
  const lookedKyc = target ? verifications.get(target.toLowerCase()) : undefined

  const blockedAccounts = watch.filter((a) => {
    const acc = accounts.get(a)
    return (
      acc &&
      (acc.restricted || acc.disputeLimitReached || acc.totalDebt > 0n || Number(acc.bannedUntil) > now)
    )
  })

  const flagged = watch.filter((a) => {
    const acc = accounts.get(a)
    return (
      acc &&
      (acc.restricted ||
        acc.disputesLost > 0 ||
        acc.concessions > 0 ||
        acc.disputeLimitReached ||
        acc.totalDebt > 0n ||
        Number(acc.bannedUntil) > now)
    )
  })

  return (
    <div className="space-y-6">
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {P2P_ASSETS.map((a) => {
            const active = selectedAsset === a
            return (
              <button
                key={a}
                type="button"
                onClick={() => setSelectedAsset(a)}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors"
                style={{
                  background: active ? 'var(--accent-bg)' : 'var(--fill-2)',
                  color: active ? 'var(--on-accent)' : 'var(--muted)',
                }}
              >
                <CoinLogo symbol={a} size={14} />
                <span>{a} Accounts</span>
              </button>
            )
          })}
        </div>
        {canWrite && (
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={applyAllAssets}
              onChange={(e) => setApplyAllAssets(e.target.checked)}
              className="size-4"
            />
            <span>Apply restrictions &amp; KYC revocations across all 4 asset contracts</span>
          </label>
        )}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="size-4" style={{ color: 'var(--danger)' }} />
            Restricted &amp; Blocked Accounts on {selectedAsset} ({blockedAccounts.length})
          </h3>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>
            Admin can turn off dispute / manual restrictions directly from this list
          </span>
        </div>
        {blockedAccounts.length === 0 ? (
          <Empty
            title="No restricted accounts"
            body="Wallets blocked by lost-dispute limits, admin restrictions, unpaid dispute bonds, or cancel cooldowns appear here automatically."
          />
        ) : (
          <ul className="space-y-2.5">
            {blockedAccounts.map((a) => (
              <RestrictedRow
                key={`blocked-${selectedAsset}-${a}`}
                address={a}
                account={accounts.get(a)!}
                asset={selectedAsset}
                applyAllAssets={applyAllAssets}
                canWrite={canWrite}
                onInspect={(addr) => setQuery(addr)}
              />
            ))}
          </ul>
        )}
      </section>

      <div className="glass rounded-3xl p-4 sm:p-5">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
            Look up any wallet address ({selectedAsset})
          </span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Paste a wallet address (0x...)"
              spellCheck={false}
              className={`${inputClass} mono pl-10 text-sm`}
            />
          </span>
        </label>
        {query.trim() && !target && (
          <p className="mt-2 text-sm" style={{ color: 'var(--danger)' }}>That is not a valid address.</p>
        )}
      </div>

      {target && looked && (
        <AccountPanel
          address={target}
          account={looked}
          asset={selectedAsset}
          applyAllAssets={applyAllAssets}
          kyc={lookedKyc}
          canWrite={canWrite}
          canRevokeKyc={canRevokeKyc}
        />
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold">Full Reputation Watchlist ({selectedAsset})</h3>
        {flagged.length === 0 ? (
          <Empty title="Nothing flagged" body="Accounts with lost disputes, concessions, unpaid bonds, restrictions or cooldowns appear here." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {flagged.map((a) => {
              const acc = accounts.get(a)!
              const kyc = verifications.get(a)
              return (
                <li key={`${selectedAsset}-${a}`}>
                  <button onClick={() => setQuery(a)} className="glass flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-[var(--fill-3)]">
                    <Avatar address={a} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="mono block text-sm font-semibold">{shortAddr(a)}</span>
                      <span className="block text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                        {acc.disputesLost} lost · {acc.concessions} conc · {acc.strikes} strikes
                        {kyc?.verified ? ` · KYC L${kyc.level}` : ''}
                        {acc.totalDebt > 0n ? ` · ${formatUsdcAmount(acc.totalDebt, undefined, selectedAsset)} ${selectedAsset} debt` : ''}
                        {acc.restricted ? ' · restricted' : ''}
                        {acc.disputeLimitReached ? ' · dispute limit' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
