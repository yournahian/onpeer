import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Briefcase, ChevronDown, Clock, Gavel, ShieldAlert } from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  BACKUP_ARBITER_DELAY_SECONDS,
  CHAIN_ID,
  ESCROW_ADDRESS,
  STATUS,
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

const PAID_WAIT_SECONDS = 15 * 60

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
            ? `${account.ordersCompleted} completed · ${account.disputesLost} lost · ${account.concessions} concessions · margin ${formatUsdcAmount(account.effectiveMargin)} USDC${account.totalDebt > 0n ? ` · debt ${formatUsdcAmount(account.totalDebt)} USDC` : ''}`
            : 'Loading profile...'}
        </p>
      </div>
    </div>
  )
}

export function DisputeCard({
  order,
  accounts,
  isPrimaryArbiter,
  isBackupArbiter,
  viewer,
}: {
  order: OrderWithId
  accounts: Map<string, Account>
  isPrimaryArbiter: boolean
  isBackupArbiter: boolean
  viewer?: string
}) {
  const now = useNow()
  const { run, writeContractAsync, pendingKey } = useTx()
  const [open, setOpen] = useState(false)
  const [toBuyer, setToBuyer] = useState<boolean | null>(null)
  const [applyBond, setApplyBond] = useState(true)
  const [slash, setSlash] = useState(false)
  const [reviewed, setReviewed] = useState(false)

  const currency = hexToCurrency(order.currency)
  const country = countryByCurrency(currency)
  const anchor = order.disputedAt > 0n ? Number(order.disputedAt) : Number(order.paidAt)
  const age = Math.max(0, now - anchor)
  const stale = age > 24 * 3600
  const paidWaitLeft = order.disputedAt > 0n ? 0 : Number(order.paidAt) + PAID_WAIT_SECONDS - now
  const paidReady = paidWaitLeft <= 0
  const backupRemaining = BACKUP_ARBITER_DELAY_SECONDS - age
  const backupReady = backupRemaining <= 0
  const canRule = paidReady && (isPrimaryArbiter || (isBackupArbiter && backupReady))
  const inReview = order.reviewStartedAt > 0n

  const buyerAcc = accounts.get(order.buyer.toLowerCase())
  const sellerAcc = accounts.get(order.seller.toLowerCase())
  const isParty = sameAddr(viewer, order.buyer) || sameAddr(viewer, order.seller)
  const loserAcc = toBuyer === null ? undefined : toBuyer ? sellerAcc : buyerAcc
  const deductedBond = applyBond ? order.bond : 0n
  const marginAfterBond =
    loserAcc && loserAcc.effectiveMargin > deductedBond ? loserAcc.effectiveMargin - deductedBond : 0n
  const maxExtraSlash = marginAfterBond < order.amount ? marginAfterBond : order.amount
  const key = `rule-${order.id}`
  const takeKey = `take-${order.id}`

  const take = async () => {
    if (!ESCROW_ADDRESS) return
    await run(takeKey, 'Take case into review', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: 'takeCase',
        args: [order.id],
        chainId: CHAIN_ID,
      }),
    )
  }

  const rule = async () => {
    if (toBuyer === null || !ESCROW_ADDRESS) return
    await run(key, 'Rule on dispute', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: 'resolveDispute',
        args: [order.id, toBuyer, slash, applyBond],
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
            {inReview && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}>
                IN REVIEW
              </span>
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
            {country && <CountryFlag code={country.code} size={16} />}
            {country?.symbol} {formatFiat(order.fiatAmountE6)} {currency}
            <span>Bond {formatUsdcAmount(order.bond)} USDC</span>
            {order.paidLate && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>
                Marked paid late
              </span>
            )}
            <span className="inline-flex items-center gap-1" style={{ color: stale ? 'var(--danger)' : undefined }}>
              <Clock className="size-3" /> {order.status === STATUS.PAID ? 'paid' : 'waiting'} {formatDuration(age)}
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
                {order.paymentDetails && <CopyButton text={order.paymentDetails} />}
              </div>
              <p className="mono mt-1.5 whitespace-pre-wrap break-words text-xs">
                {order.paymentDetails || 'Sealed payment details'}
              </p>
              <p className="mt-2 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                Price {formatPrice(order.priceE6)} {currency} per USDC · opened {new Date(Number(order.createdAt) * 1000).toLocaleString()}
                {order.paidAt > 0n && ` · marked paid ${new Date(Number(order.paidAt) * 1000).toLocaleString()}`}
                {inReview && ` · review started ${new Date(Number(order.reviewStartedAt) * 1000).toLocaleString()}`}
              </p>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                Evidence thread (public fallback)
              </h4>
              <OrderChat
                orderId={order.id}
                buyer={order.buyer}
                seller={order.seller}
                orderStatus={order.status}
                disputedAt={order.disputedAt}
                amountText={formatUsdcAmount(order.amount)}
                canPost={canRule && !isParty && order.status === STATUS.DISPUTED}
              />
            </div>

            {canRule && !isParty ? (
              <div className="rounded-2xl p-4" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <Gavel className="size-4" /> Arbiter case &amp; ruling
                  </h4>
                  {!inReview && (
                    <Button variant="ghost" loading={pendingKey === takeKey} onClick={() => void take()}>
                      <Briefcase className="size-4" /> Take case
                    </Button>
                  )}
                </div>
                <p className="mt-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
                  Taking the case marks <span className="mono">reviewStartedAt</span> onchain (settling after review starts counts as a lost dispute with 0 bond). When ruling, choose whether the loser owes the {formatUsdcAmount(order.bond)} USDC bond. Escrowed order USDC is never reduced.
                </p>
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
                  <input type="checkbox" checked={applyBond} onChange={(e) => setApplyBond(e.target.checked)} className="mt-1 size-4" />
                  <span>
                    Charge {formatUsdcAmount(order.bond)} USDC dispute bond to the losing party
                    <span className="block text-xs" style={{ color: 'var(--subtle)' }}>
                      Paid from free margin first; any shortfall becomes debt blocking new ads/orders.
                    </span>
                  </span>
                </label>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={slash} onChange={(e) => setSlash(e.target.checked)} className="mt-1 size-4" />
                  <span>
                    Also slash extra margin from the losing party
                    {loserAcc && (
                      <span className="block text-xs" style={{ color: 'var(--subtle)' }}>
                        Up to {formatUsdcAmount(maxExtraSlash)} USDC goes to the winner.
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
                  : !paidReady
                    ? `Paid orders without an onchain dispute unlock for arbiter review 15 minutes after markPaid (${formatDuration(paidWaitLeft)} left).`
                    : isBackupArbiter && !backupReady
                      ? `Backup arbiter window opens in ${formatDuration(backupRemaining)} (7 days after dispute or paidAt).`
                      : 'Only the arbiter (or backup arbiter after 7 days) can take or rule on a case.'}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}
