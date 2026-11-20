import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Search } from 'lucide-react'
import { isAddress, type Address } from 'viem'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { CHAIN_ID, ESCROW_ADDRESS, TIER_TABLE, formatOrderCap, formatUsdcAmount, shortAddr } from '@/lib/p2p'
import {
  useAccounts,
  useDebts,
  useDisputeWaived,
  useNow,
  useOrders,
  useVerifications,
  type Account,
  type KycInfo,
} from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { Avatar, Button, Empty, inputClass } from '@/components/ui'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inner rounded-xl p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>{label}</p>
      <p className="display mt-0.5 text-lg font-bold tabular-nums">{value}</p>
    </div>
  )
}

function AccountPanel({
  address,
  account,
  kyc,
  canWrite,
  canRevokeKyc,
}: {
  address: Address
  account: Account
  kyc?: KycInfo
  canWrite: boolean
  canRevokeKyc: boolean
}) {
  const now = useNow()
  const debts = useDebts(address)
  const waived = useDisputeWaived(address)
  const { run, writeContractAsync, pendingKey } = useTx()
  const banned = Number(account.bannedUntil) > now
  const tierMeta = TIER_TABLE[account.tier] ?? TIER_TABLE[0]
  const kycText = kyc?.verified
    ? `Verified L${kyc.level}`
    : kyc && kyc.level > 0
      ? `Expired (L${kyc.level})`
      : 'Unverified'

  const flipRestrict = () =>
    run(`restrict-${address}`, account.restricted ? 'Lift restriction' : 'Restrict account', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: 'setRestricted',
        args: [address, !account.restricted],
        chainId: CHAIN_ID,
      }),
    )
  const flipWaiver = () =>
    run(`waiver-${address}`, waived ? 'Reinstate dispute limit' : 'Waive dispute limit', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: 'setDisputeWaiver',
        args: [address, !waived],
        chainId: CHAIN_ID,
      }),
    )
  const revokeKyc = () =>
    run(`revoke-kyc-${address}`, 'Revoke KYC verification', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: 'revokeVerification',
        args: [address],
        chainId: CHAIN_ID,
      }),
    )

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-3xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar address={address} size={44} />
        <div className="min-w-0 flex-1">
          <p className="mono truncate text-sm font-semibold">{address}</p>
          <p className="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold">
            <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--fill-2)', color: 'var(--text)' }}>
              Tier {account.tier} · {tierMeta.label}
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
              variant="ghost"
              loading={pendingKey === `waiver-${address}`}
              onClick={() => void flipWaiver()}
            >
              {waived ? 'Reinstate dispute limit' : 'Waive dispute limit'}
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
        <Stat label="Tier & cap" value={`T${account.tier} · ${formatOrderCap(account.orderCap)}`} />
        <Stat label="KYC status" value={kycText} />
        <Stat label="Completed" value={String(account.ordersCompleted)} />
        <Stat label="Disputes lost" value={String(account.disputesLost)} />
        <Stat label="Concessions" value={`${account.concessions} (2 = 1 loss)`} />
        <Stat label="Disputes settled" value={String(account.disputesSettled)} />
        <Stat label="Late marks (30d)" value={`${account.lateMarks} / 2`} />
        <Stat label="Unpaid debt" value={`${formatUsdcAmount(account.totalDebt)} USDC`} />
        <Stat label="Margin" value={`${formatUsdcAmount(account.effectiveMargin)} USDC`} />
        <Stat label="Strikes" value={`${account.strikes} / 3`} />
        <Stat label="Open orders" value={String(account.partyOpen)} />
        <Stat label="Volume" value={`${formatUsdcAmount(account.volume)} USDC`} />
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
                <span className="font-semibold" style={{ color: 'var(--warn)' }}>{formatUsdcAmount(d.amount)} USDC</span>
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
  const [query, setQuery] = useState('')
  const target = isAddress(query.trim()) ? (query.trim() as Address) : undefined
  const { orders } = useOrders()
  const now = useNow()

  const watch = useMemo(() => {
    const s = new Set<string>()
    for (const o of orders.slice(0, 80)) {
      s.add(o.buyer.toLowerCase())
      s.add(o.seller.toLowerCase())
    }
    return Array.from(s) as Address[]
  }, [orders])

  const list = useMemo(() => (target ? [target, ...watch] : watch), [target, watch])
  const accounts = useAccounts(list)
  const verifications = useVerifications(list)
  const looked = target ? accounts.get(target.toLowerCase()) : undefined
  const lookedKyc = target ? verifications.get(target.toLowerCase()) : undefined
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
    <div className="space-y-5">
      <div className="glass rounded-3xl p-4 sm:p-5">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
            Look up an account
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
          kyc={lookedKyc}
          canWrite={canWrite}
          canRevokeKyc={canRevokeKyc}
        />
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold">Watchlist</h3>
        {flagged.length === 0 ? (
          <Empty title="Nothing flagged" body="Accounts with lost disputes, concessions, unpaid bonds, restrictions or cooldowns appear here." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {flagged.map((a) => {
              const acc = accounts.get(a)!
              const kyc = verifications.get(a)
              return (
                <li key={a}>
                  <button onClick={() => setQuery(a)} className="glass flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-[var(--fill-3)]">
                    <Avatar address={a} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="mono block text-sm font-semibold">{shortAddr(a)}</span>
                      <span className="block text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                        {acc.disputesLost} lost · {acc.concessions} conc · {acc.strikes} strikes
                        {kyc?.verified ? ` · KYC L${kyc.level}` : ''}
                        {acc.totalDebt > 0n ? ` · ${formatUsdcAmount(acc.totalDebt)} USDC debt` : ''}
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
