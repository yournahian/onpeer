import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ChevronRight } from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  ESCROW_ADDRESS,
  SIDE_SELL,
  STATUS,
  countryByCurrency,
  formatFiat,
  formatPrice,
  formatUsdcAmount,
  hexToCurrency,
  isActiveStatus,
  maskToMethods,
  sameAddr,
} from '@/lib/p2p'
import { parseUnitsExact } from '@/onchain-money'
import { useAds, useOrders, type OrderWithId } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { MethodLogo } from '@/components/logos'
import { AppLink } from '@/components/AppLink'
import { Button, Empty, SkeletonRows, StatusBadge, inputClass } from '@/components/ui'

function OrderCard({
  order,
  viewer,
  onOpen,
}: {
  order: OrderWithId
  viewer?: string
  onOpen: (id: bigint) => void
}) {
  const currency = hexToCurrency(order.currency)
  const country = countryByCurrency(currency)
  const isBuyer = sameAddr(viewer, order.buyer)
  const isSeller = sameAddr(viewer, order.seller)
  const role = isBuyer ? 'Buying' : isSeller ? 'Selling' : 'Dispute'
  return (
    <li>
      <button
        onClick={() => onOpen(order.id)}
        className="glass flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-[var(--fill-3)]"
      >
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span style={{ color: isBuyer ? 'var(--success)' : isSeller ? 'var(--danger)' : 'var(--warn)' }}>{role}</span>
            <span className="tabular-nums">{formatUsdcAmount(order.amount)} USDC</span>
          </p>
          <p className="mt-0.5 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
            {country?.symbol} {formatFiat(order.fiatAmountE6)} · {formatPrice(order.priceE6)} {currency} · Order #
            {order.id.toString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={order.status} />
          <ChevronRight className="size-4" style={{ color: 'var(--subtle)' }} />
        </div>
      </button>
    </li>
  )
}

export function MyOrders({ onOpen }: { onOpen: (id: bigint) => void }) {
  const { address, isConnected } = useAccount()
  const { orders, isLoading } = useOrders()
  if (!isConnected) return <Empty title="Connect your wallet" body="Your orders will show up here." />
  if (isLoading) return <SkeletonRows n={3} />
  const mine = orders.filter((o) => sameAddr(o.buyer, address) || sameAddr(o.seller, address))
  if (mine.length === 0)
    return <Empty title="No orders yet" body="Open the market, pick an ad and your first order will appear here." />
  const active = mine.filter((o) => isActiveStatus(o.status))
  const past = mine.filter((o) => !isActiveStatus(o.status))
  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <section>
          <h3 className="display mb-3 text-lg font-semibold">In progress</h3>
          <ul className="space-y-2">
            {active.map((o) => (
              <OrderCard key={o.id.toString()} order={o} viewer={address} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <h3 className="display mb-3 text-lg font-semibold">History</h3>
          <ul className="space-y-2">
            {past.map((o) => (
              <OrderCard key={o.id.toString()} order={o} viewer={address} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export function ArbiterPanel({ onOpen }: { onOpen: (id: bigint) => void }) {
  const { orders, isLoading } = useOrders()
  if (isLoading) return <SkeletonRows n={2} />
  const disputed = orders.filter((o) => o.status === STATUS.DISPUTED)
  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        You are the arbiter. Review each disputed order with both parties, then release the USDC to the buyer or return it to the seller.{' '}
        <AppLink to="/admin" className="font-semibold underline" style={{ color: 'var(--accent)' }}>
          Open the full admin panel
        </AppLink>
      </p>
      {disputed.length === 0 ? (
        <Empty title="No open disputes" body="Disputed orders will appear here." />
      ) : (
        <ul className="space-y-2">
          {disputed.map((o) => (
            <OrderCard key={o.id.toString()} order={o} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function MyAds({ onPostAd }: { onPostAd: () => void }) {
  const { address, isConnected } = useAccount()
  const { ads, isLoading } = useAds()
  const { run, writeContractAsync, pendingKey } = useTx()
  const [editing, setEditing] = useState<bigint | null>(null)
  const [newPrice, setNewPrice] = useState('')

  if (!isConnected) return <Empty title="Connect your wallet" body="Your ads will show up here." />
  if (isLoading) return <SkeletonRows n={2} />
  const mine = ads.filter((a) => sameAddr(a.maker, address))
  if (mine.length === 0)
    return (
      <Empty
        title="You have no ads"
        body={
          <>
            Post an ad to buy or sell USDC for your local currency.
            <span className="mt-4 block">
              <Button onClick={onPostAd}>Post ad</Button>
            </span>
          </>
        }
      />
    )

  const base = { address: ESCROW_ADDRESS!, abi: p2pEscrowAbi, chainId: CHAIN_ID } as const
  const updatePrice = (id: bigint, priceE6: bigint) =>
    run(`price-${id}`, 'Update price', () =>
      writeContractAsync({ ...base, functionName: 'setAdPrice', args: [id, priceE6] }),
    )
  const setPaused = (id: bigint, paused: boolean) =>
    run(`pause-${id}`, paused ? 'Pause ad' : 'Resume ad', () =>
      writeContractAsync({ ...base, functionName: 'setAdPaused', args: [id, paused] }),
    )
  const closeAd = (id: bigint) =>
    run(`close-${id}`, 'Close ad', () => writeContractAsync({ ...base, functionName: 'closeAd', args: [id] }))

  return (
    <ul className="space-y-3">
      {mine.map((ad) => {
        const currency = hexToCurrency(ad.currency)
        const id = ad.id.toString()
        const sell = ad.side === SIDE_SELL
        return (
          <li key={id} className="glass rounded-2xl p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span style={{ color: sell ? 'var(--danger)' : 'var(--success)' }}>
                    {sell ? 'Selling' : 'Buying'}
                  </span>
                  <span className="tabular-nums">{formatUsdcAmount(ad.available)} USDC left</span>
                  <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                    Ad #{id}
                  </span>
                </p>
                <p className="mt-1 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                  {formatPrice(ad.priceE6)} {currency} · limits {formatUsdcAmount(ad.minAmount)} -{' '}
                  {formatUsdcAmount(ad.maxAmount)} ·{' '}
                  <span className="inline-flex items-center gap-1 align-middle">
                    {maskToMethods(ad.paymentMask).map((m) => (
                      <MethodLogo key={m.bit} name={m.name} size={18} />
                    ))}
                  </span>
                </p>
              </div>
              <span
                className="rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{
                  background: 'rgba(148,163,184,0.14)',
                  color: ad.closed ? 'var(--subtle)' : ad.paused ? 'var(--warn)' : 'var(--success)',
                }}
              >
                {ad.closed ? 'Closed' : ad.paused ? 'Paused' : 'Live'}
              </span>
            </div>

            {!ad.closed && (
              <div className="mt-3 space-y-2">
                {editing === ad.id ? (
                  <div className="flex gap-2">
                    <input
                      inputMode="decimal"
                      value={newPrice}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, '')
                        if (/^\d*\.?\d{0,4}$/.test(v)) setNewPrice(v)
                      }}
                      placeholder={`New price (${currency})`}
                      className={inputClass}
                    />
                    <Button
                      loading={pendingKey === `price-${id}`}
                      disabled={!newPrice}
                      onClick={() =>
                        void updatePrice(ad.id, parseUnitsExact(newPrice, 6)).then(
                          (ok) => ok && setEditing(null),
                        )
                      }
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => setEditing(ad.id)}>
                      Edit price
                    </Button>
                    <Button
                      variant="ghost"
                      loading={pendingKey === `pause-${id}`}
                      onClick={() => void setPaused(ad.id, !ad.paused)}
                    >
                      {ad.paused ? 'Resume' : 'Pause'}
                    </Button>
                    <Button
                      variant="danger"
                      loading={pendingKey === `close-${id}`}
                      onClick={() => void closeAd(ad.id)}
                    >
                      {sell ? 'Close and withdraw USDC' : 'Close ad'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

