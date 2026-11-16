import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Clock, Gavel, ShieldAlert } from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  ESCROW_ADDRESS,
  countryByCurrency,
  formatDuration,
  formatFiat,
  formatPrice,
  formatUsdcAmount,
  hexToCurrency,
  sameAddr,
  shortAddr,
} from '@/lib/p2p'
import { useNow, type Account, type OrderWithId } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { Avatar, Button, CopyButton, StatusBadge } from '@/components/ui'
import { OrderChat } from '@/components/OrderChat'
import { CountryFlag } from '@/components/logos'

function PartyRow({ role, address, account }: { role: string; address: string; account?: Account }) {
  return (
    <div className="inner flex items-center gap-3 rounded-xl p-3">
      <Avatar address={address} size={34} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
          {role} <span className="mono text-xs font-normal" style={{ color: 'var(--subtle)' }}>{shortAddr(address)}</span>
          {account?.merchant && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}>
              MERCHANT
            </span>
          )}
        </p>
        <p className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
          {account
            ? `${account.ordersCompleted} completed · ${account.disputesLost} disputes lost · margin ${formatUsdcAmount(account.effectiveMargin)} USDC`
            : 'Loading profile...'}
        </p>
      </div>
    </div>
  )
}

export function DisputeCard({
  order,
  accounts,
  canRule,
  viewer,
}: {
  order: OrderWithId
  accounts: Map<string, Account>
  canRule: boolean
  viewer?: string
}) {
  const now = useNow()
  const { run, writeContractAsync, pendingKey } = useTx()
  const [open, setOpen] = useState(false)
  const [toBuyer, setToBuyer] = useState<boolean | null>(null)
  const [slash, setSlash] = useState(false)
  const [reviewed, setReviewed] = useState(false)

  const currency = hexToCurrency(order.currency)
  const country = countryByCurrency(currency)
  const age = now - Number(order.disputedAt)
  const stale = age > 24 * 3600
  const buyerAcc = accounts.get(order.buyer.toLowerCase())
  const sellerAcc = accounts.get(order.seller.toLowerCase())
  const isParty = sameAddr(viewer, order.buyer) || sameAddr(viewer, order.seller)
  const loserAcc = toBuyer === null ? undefined : toBuyer ? sellerAcc : buyerAcc
  const key = `rule-${order.id}`

  const rule = async () => {
    if (toBuyer === null || !ESCROW_ADDRESS) return
    await run(key, 'Rule on dispute', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: 'resolveDispute',
        args: [order.id, toBuyer, slash],
        chainId: CHAIN_ID,
      }),
    )
  }

  return (
    <motion.li layout="position" className="glass overflow-hidden rounded-3xl" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left sm:p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'var(--fill-2)', color: 'var(--danger)' }}>
          <ShieldAlert className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
            Order #{order.id.toString()}
            <span className="tabular-nums">{formatUsdcAmount(order.amount)} USDC</span>
            <StatusBadge status={order.status} />
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
            {country && <CountryFlag code={country.code} size={16} />}
            {country?.symbol} {formatFiat(order.fiatAmountE6)} {currency}
            <span className="inline-flex items-center gap-1" style={{ color: stale ? 'var(--danger)' : undefined }}>
              <Clock className="size-3" /> waiting {formatDuration(age)}
            </span>
          </span>
        </span>
        <ChevronDown className="size-5 shrink-0 transition-transform" style={{ color: 'var(--subtle)', transform: open ? 'rotate(180deg)' : undefined }} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-4 border-t p-4 sm:p-5"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <PartyRow role="Buyer" address={order.buyer} account={buyerAcc} />
              <PartyRow role="Seller" address={order.seller} account={sellerAcc} />
            </div>

            <div className="inner rounded-xl p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                  Seller receiving details
                </span>
                <CopyButton text={order.paymentDetails} />
              </div>
              <p className="mono mt-1.5 whitespace-pre-wrap break-words text-xs">{order.paymentDetails}</p>
              <p className="mt-2 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                Price {formatPrice(order.priceE6)} {currency} per USDC · opened {new Date(Number(order.createdAt) * 1000).toLocaleString()}
                {order.paidAt > 0n && ` · marked paid ${new Date(Number(order.paidAt) * 1000).toLocaleString()}`}
              </p>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                Evidence thread (public onchain)
              </h4>
              <OrderChat orderId={order.id} buyer={order.buyer} seller={order.seller} canPost={canRule && !isParty} />
            </div>

            {canRule && !isParty ? (
              <div className="rounded-2xl p-4" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Gavel className="size-4" /> Your ruling
                </h4>
                <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Ruling">
                  {[
                    { v: true, title: 'Release to buyer', body: 'Buyer proved payment' },
                    { v: false, title: 'Return to seller', body: 'Payment not received' },
                  ].map((o) => (
                    <button
                      key={o.title}
                      role="radio"
                      aria-checked={toBuyer === o.v}
                      onClick={() => setToBuyer(o.v)}
                      className="rounded-xl p-3 text-left transition-colors"
                      style={{
                        background: toBuyer === o.v ? 'var(--fill-3)' : 'transparent',
                        border: `1px solid ${toBuyer === o.v ? 'var(--accent)' : 'var(--border)'}`,
                      }}
                    >
                      <span className="block text-sm font-semibold">{o.title}</span>
                      <span className="block text-xs" style={{ color: 'var(--subtle)' }}>{o.body}</span>
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={slash} onChange={(e) => setSlash(e.target.checked)} className="mt-1 size-4" />
                  <span>
                    Also slash the losing party&apos;s margin
                    {loserAcc && (
                      <span className="block text-xs" style={{ color: 'var(--subtle)' }}>
                        Up to {formatUsdcAmount(loserAcc.effectiveMargin < order.amount ? loserAcc.effectiveMargin : order.amount)} USDC goes to the winner.
                      </span>
                    )}
                  </span>
                </label>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-1 size-4" />
                  <span>I reviewed the evidence from both sides. This ruling is final.</span>
                </label>
                <Button className="mt-4 w-full sm:w-auto" disabled={toBuyer === null || !reviewed} loading={pendingKey === key} onClick={() => void rule()}>
                  Confirm ruling
                </Button>
              </div>
            ) : (
              <p className="text-sm" style={{ color: 'var(--subtle)' }}>
                {isParty
                  ? 'You are a party to this order, so you cannot rule on it.'
                  : 'Only the arbiter can rule. The owner can appoint a new arbiter from Controls.'}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}
