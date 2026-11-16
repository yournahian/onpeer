import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Search } from 'lucide-react'
import { isAddress, type Address } from 'viem'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { CHAIN_ID, ESCROW_ADDRESS, formatUsdcAmount, shortAddr } from '@/lib/p2p'
import { useAccounts, useNow, useOrders, type Account } from '@/hooks/useEscrow'
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

function AccountPanel({ address, account }: { address: Address; account: Account }) {
  const now = useNow()
  const { run, writeContractAsync, pendingKey } = useTx()
  const banned = Number(account.bannedUntil) > now
  const flip = () =>
    run(`restrict-${address}`, account.restricted ? 'Lift restriction' : 'Restrict account', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: 'setRestricted',
        args: [address, !account.restricted],
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
            {account.merchant && <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}>Merchant</span>}
            {account.restricted && <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>Restricted</span>}
            {banned && <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>Cooldown</span>}
          </p>
        </div>
        <Button variant={account.restricted ? 'buy' : 'danger'} loading={pendingKey === `restrict-${address}`} onClick={() => void flip()}>
          {account.restricted ? 'Lift restriction' : 'Restrict account'}
        </Button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Orders created" value={String(account.ordersCreated)} />
        <Stat label="Completed" value={String(account.ordersCompleted)} />
        <Stat label="Disputes lost" value={String(account.disputesLost)} />
        <Stat label="Volume" value={`${formatUsdcAmount(account.volume)}`} />
        <Stat label="Margin" value={`${formatUsdcAmount(account.effectiveMargin)}`} />
        <Stat label="Strikes" value={`${account.strikes} / 3`} />
        <Stat label="Open orders" value={String(account.partyOpen)} />
        <Stat label="Claimable" value={`${formatUsdcAmount(account.claimable)}`} />
      </div>
      <p className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>
        Restricting blocks an account from posting ads and opening orders. Existing orders can still finish.
      </p>
    </motion.div>
  )
}

export function AccountsTab() {
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
  const looked = target ? accounts.get(target.toLowerCase()) : undefined
  const flagged = watch.filter((a) => {
    const acc = accounts.get(a)
    return acc && (acc.restricted || acc.disputesLost > 0 || Number(acc.bannedUntil) > now)
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

      {target && looked && <AccountPanel address={target} account={looked} />}

      <section>
        <h3 className="mb-3 text-sm font-semibold">Watchlist</h3>
        {flagged.length === 0 ? (
          <Empty title="Nothing flagged" body="Accounts with lost disputes, restrictions or cooldowns appear here." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {flagged.map((a) => {
              const acc = accounts.get(a)!
              return (
                <li key={a}>
                  <button onClick={() => setQuery(a)} className="glass flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-[var(--fill-3)]">
                    <Avatar address={a} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="mono block text-sm font-semibold">{shortAddr(a)}</span>
                      <span className="block text-xs" style={{ color: 'var(--subtle)' }}>
                        {acc.disputesLost} lost · {acc.strikes} strikes{acc.restricted ? ' · restricted' : ''}
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
