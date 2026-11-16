import { useState } from 'react'
import { useAccount } from 'wagmi'
import { AlertTriangle, Check, Clock, ShieldAlert } from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  ESCROW_ADDRESS,
  STATUS,
  countryByCurrency,
  formatDuration,
  formatFiat,
  formatPrice,
  formatUsdcAmount,
  hexToCurrency,
  maskToMethods,
  sameAddr,
  shortAddr,
} from '@/lib/p2p'
import { useArbiter, useNow, useOrder, type OrderWithId } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { Button, CopyButton, Sheet, StatusBadge } from '@/components/ui'
import { OrderChat } from '@/components/OrderChat'
import { MethodLabel } from '@/components/logos'

const DISPUTE_WAIT = 15 * 60

export function OrderRoom({ orderId, onClose }: { orderId: bigint | null; onClose: () => void }) {
  return (
    <Sheet open={orderId !== null} onClose={onClose} title={orderId !== null ? `Order #${orderId}` : ''}>
      {orderId !== null && <Room orderId={orderId} />}
    </Sheet>
  )
}

function Room({ orderId }: { orderId: bigint }) {
  const { order, isLoading } = useOrder(orderId)
  if (isLoading && !order) return <div className="glass h-48 animate-pulse rounded-2xl" />
  if (!order) return <p style={{ color: 'var(--subtle)' }}>This order does not exist.</p>
  return <RoomBody order={order} />
}

function RoomBody({ order }: { order: OrderWithId }) {
  const { address } = useAccount()
  const arbiter = useArbiter()
  const now = useNow()
  const { run, writeContractAsync, pendingKey, busy } = useTx()
  const [confirmed, setConfirmed] = useState(false)
  const [slash, setSlash] = useState(false)

  const currency = hexToCurrency(order.currency)
  const country = countryByCurrency(currency)
  const isBuyer = sameAddr(address, order.buyer)
  const isSeller = sameAddr(address, order.seller)
  const isArbiter = sameAddr(address, arbiter) && !isBuyer && !isSeller
  const role = isBuyer ? 'Buyer' : isSeller ? 'Seller' : isArbiter ? 'Arbiter' : 'Observer'

  const deadline = Number(order.deadline)
  const remaining = deadline - now
  const expired = remaining <= 0
  const status = order.status

  const call = (name: 'markPaid' | 'release' | 'cancelOrder' | 'openDispute', label: string) =>
    run(name, label, () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: name,
        args: [order.id],
        chainId: CHAIN_ID,
      }),
    )
  const resolve = (toBuyer: boolean) =>
    run(toBuyer ? 'resolveBuyer' : 'resolveSeller', 'Resolve dispute', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: 'resolveDispute',
        args: [order.id, toBuyer, slash],
        chainId: CHAIN_ID,
      }),
    )

  const canBuyerDispute = status === STATUS.PAID && now >= Number(order.paidAt) + DISPUTE_WAIT
  const disputeWaitLeft = Number(order.paidAt) + DISPUTE_WAIT - now

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <StatusBadge status={status} />
        <span className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
          You are: {role}
        </span>
      </div>

      <div className="inner rounded-2xl p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
              {isSeller ? 'You receive' : 'Fiat amount'}
            </p>
            <p className="display text-2xl font-bold tabular-nums">
              {country?.symbol} {formatFiat(order.fiatAmountE6)}
            </p>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              {currency} at {formatPrice(order.priceE6)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
              USDC in escrow
            </p>
            <p className="display text-2xl font-bold tabular-nums">{formatUsdcAmount(order.amount)}</p>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              Ad #{order.adId.toString()}
            </p>
          </div>
        </div>
        <div className="mt-3 flex justify-between text-xs" style={{ color: 'var(--subtle)' }}>
          <span>
            Buyer <span className="mono">{shortAddr(order.buyer)}</span>
          </span>
          <span>
            Seller <span className="mono">{shortAddr(order.seller)}</span>
          </span>
        </div>
      </div>

      {status === STATUS.PENDING && (
        <div
          className="flex items-center justify-between rounded-2xl px-4 py-3"
          style={{ background: expired ? 'rgba(232,109,122,0.12)' : 'rgba(232,196,109,0.12)' }}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4" />
            {expired ? 'Payment window ended' : 'Pay within'}
          </span>
          {!expired && (
            <span className="display text-2xl font-bold tabular-nums" aria-live="off">
              {formatDuration(remaining)}
            </span>
          )}
        </div>
      )}

      {(status === STATUS.PENDING || status === STATUS.PAID || status === STATUS.DISPUTED) && (
        <div className="inner rounded-2xl p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
              {isSeller ? 'Your receiving details' : 'Send fiat to'}
            </p>
            <CopyButton text={order.paymentDetails} />
          </div>
          <p className="mono whitespace-pre-wrap break-words text-sm">{order.paymentDetails}</p>
          <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
            <span className="flex flex-wrap items-center gap-2">
              Accepted:
              {maskToMethods(order.paymentMask).map((m) => (
                <MethodLabel key={m.bit} method={m} size={20} />
              ))}
            </span>
          </p>
        </div>
      )}

      {(status === STATUS.PENDING || status === STATUS.PAID || status === STATUS.DISPUTED) && (
        <OrderChat
          orderId={order.id}
          buyer={order.buyer}
          seller={order.seller}
          canPost={isBuyer || isSeller || (isArbiter && status === STATUS.DISPUTED)}
        />
      )}

      {/* Actions */}
      {status === STATUS.PENDING && isBuyer && (
        <div className="space-y-2">
          <p className="flex items-start gap-2 text-xs" style={{ color: 'var(--warn)' }}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Send exactly {country?.symbol} {formatFiat(order.fiatAmountE6)} from an account in your own name, then
            tap the button before the timer ends.
          </p>
          <Button
            variant="buy"
            className="w-full"
            disabled={expired}
            loading={pendingKey === 'markPaid'}
            onClick={() => void call('markPaid', 'Mark as paid')}
          >
            I have paid
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            disabled={busy}
            loading={pendingKey === 'cancelOrder'}
            onClick={() => void call('cancelOrder', 'Cancel order')}
          >
            Cancel order
          </Button>
          {order.buyer === order.taker && (
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              Cancelling counts as a strike. Three strikes in 24 hours start a 24-hour trading cooldown. Never cancel after you have paid.
            </p>
          )}
        </div>
      )}

      {status === STATUS.PENDING && !isBuyer && (
        <div className="space-y-2">
          {isSeller && (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Waiting for the buyer to pay. Only release once the money has arrived in your account.
            </p>
          )}
          {isSeller && (
            <Button
              variant="ghost"
              className="w-full"
              disabled={busy}
              loading={pendingKey === 'release'}
              onClick={() => void call('release', 'Release USDC')}
            >
              Release USDC anyway
            </Button>
          )}
          {expired && (
            <Button
              variant="ghost"
              className="w-full"
              disabled={busy}
              loading={pendingKey === 'cancelOrder'}
              onClick={() => void call('cancelOrder', 'Cancel expired order')}
            >
              Cancel expired order
            </Button>
          )}
        </div>
      )}

      {status === STATUS.PAID && isSeller && (
        <div className="space-y-2">
          <p className="flex items-start gap-2 text-xs" style={{ color: 'var(--warn)' }}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Check your bank or wallet app. Release only after the full amount has arrived. Releasing is final.
          </p>
          <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
            />
            I confirm the full amount is in my own account, sent from an account in the buyer&apos;s name (no third-party
            payments).
          </label>
          <Button
            variant="buy"
            className="w-full"
            disabled={busy || !confirmed}
            loading={pendingKey === 'release'}
            onClick={() => void call('release', 'Release USDC')}
          >
            Payment received, release USDC
          </Button>
          <Button
            variant="danger"
            className="w-full"
            disabled={busy}
            loading={pendingKey === 'openDispute'}
            onClick={() => void call('openDispute', 'Open dispute')}
          >
            I did not receive the payment
          </Button>
        </div>
      )}

      {status === STATUS.PAID && isBuyer && (
        <div className="space-y-2">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Waiting for the seller to confirm and release your USDC.
          </p>
          <Button
            variant="danger"
            className="w-full"
            disabled={!canBuyerDispute || busy}
            loading={pendingKey === 'openDispute'}
            onClick={() => void call('openDispute', 'Open dispute')}
          >
            {canBuyerDispute ? 'Seller is not responding: open dispute' : `Dispute opens in ${formatDuration(disputeWaitLeft)}`}
          </Button>
        </div>
      )}

      {status === STATUS.DISPUTED && (
        <div className="space-y-2">
          <p className="flex items-start gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            <ShieldAlert className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--danger)' }} />
            Only the arbiter can settle a disputed order. Add your evidence in the messages below. Funds stay locked in escrow until a ruling.
          </p>
          {isArbiter && (
            <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--muted)' }}>
              <input
                type="checkbox"
                checked={slash}
                onChange={(e) => setSlash(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
              />
              Also slash the losing party&apos;s merchant margin (up to the order amount) as compensation to the winner.
            </label>
          )}
          {isArbiter && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="buy"
                disabled={busy}
                loading={pendingKey === 'resolveBuyer'}
                onClick={() => void resolve(true)}
              >
                Release to buyer
              </Button>
              <Button
                variant="sell"
                disabled={busy}
                loading={pendingKey === 'resolveSeller'}
                onClick={() => void resolve(false)}
              >
                Return to seller
              </Button>
            </div>
          )}
        </div>
      )}

      {status === STATUS.COMPLETED && (
        <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--success)' }}>
          <Check className="size-4" /> USDC was released to the buyer.
        </p>
      )}
    </div>
  )
}
