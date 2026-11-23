import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ChevronRight, Loader2, Plus, RotateCw, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  DEFAULT_TTL_HOURS,
  ESCROW_ADDRESS,
  SIDE_SELL,
  STATUS,
  STATUS_META,
  countryByCurrency,
  formatDuration,
  formatFiat,
  formatPrice,
  formatUsdcAmount,
  hexToCurrency,
  isActiveStatus,
  isAdExpired,
  maskToMethods,
  sameAddr,
} from '@/lib/p2p'
import { buildShareLink } from '@/lib/share'
import { parseUnitsExact } from '@/onchain-money'
import { useAds, useNow, useOrders, type OrderWithId } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { AppLink } from '@/components/AppLink'
import { traderLabel, useTraderProfiles, type PublicTraderSummary } from '@/hooks/useSocial'

function EmptyCard({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div className="p2p-card rounded-xl px-6 py-14 text-center">
      <p className="text-base font-bold text-[var(--p2p-ink)]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--p2p-muted)]">{body}</p>
      {cta && <div className="mt-5">{cta}</div>}
    </div>
  )
}

function ConnectPrompt({ body }: { body: string }) {
  return (
    <EmptyCard
      title="Connect Your Wallet"
      body={body}
      cta={
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button
              type="button"
              onClick={show}
              className="inline-flex min-h-10 items-center rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
            >
              Connect Wallet
            </button>
          )}
        </ConnectKitButton.Custom>
      }
    />
  )
}

function OrderRow({
  order,
  viewer,
  profilesMap,
  onOpen,
}: {
  order: OrderWithId
  viewer?: string
  profilesMap: Map<string, PublicTraderSummary>
  onOpen: (id: bigint) => void
}) {
  const currency = hexToCurrency(order.currency)
  const country = countryByCurrency(currency)
  const isBuyer = sameAddr(viewer, order.buyer)
  const isSeller = sameAddr(viewer, order.seller)
  const role = isBuyer ? 'Buy USDC' : isSeller ? 'Sell USDC' : 'Dispute Review'
  const active = isActiveStatus(order.status)

  const peerWallet = isBuyer ? order.seller : isSeller ? order.buyer : order.seller
  const peerLabel = traderLabel(peerWallet, profilesMap.get(peerWallet.toLowerCase()))

  return (
    <li className="border-b border-[var(--p2p-border)] last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(order.id)}
        className="grid w-full gap-3 bg-[var(--p2p-canvas)] px-4 py-4 text-left transition-colors hover:bg-[var(--p2p-row-hover)] sm:px-5 md:grid-cols-[180px_1fr_1fr_1fr_auto] md:items-center"
      >
        <div>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-bold ${
              isBuyer ? 'text-emerald-400' : 'text-[#FF5A00]'
            }`}
          >
            {role}
          </span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-[var(--p2p-ink)]">
            {peerLabel}
          </span>
          <span className="p2p-mono mt-0.5 block text-[11px] text-[var(--p2p-muted)]">
            Order #{order.id.toString()}
          </span>
        </div>

        <div>
          <span className="block text-[11px] text-[var(--p2p-muted)]">Crypto Amount</span>
          <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">
            {formatUsdcAmount(order.amount)} USDC
          </span>
        </div>

        <div>
          <span className="block text-[11px] text-[var(--p2p-muted)]">Fiat Total</span>
          <span className="p2p-mono text-sm font-semibold text-[var(--p2p-ink)]">
            {country?.symbol}
            {formatFiat(order.fiatAmountE6)} {currency}
          </span>
        </div>

        <div>
          <span className="block text-[11px] text-[var(--p2p-muted)]">Rate</span>
          <span className="p2p-mono text-xs text-[var(--p2p-ink)]">
            {formatPrice(order.priceE6)} {currency}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 md:justify-end">
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-semibold ${
              active
                ? 'border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] text-[#FF5A00]'
                : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
            }`}
          >
            {active && <span className="size-1.5 rounded-full bg-[#FF5A00]" />}
            {STATUS_META[order.status]?.label ?? 'Unknown'}
          </span>
          <ChevronRight className="size-4 text-[var(--p2p-muted)]" />
        </div>
      </button>
    </li>
  )
}

export function MyOrders({ onOpen }: { onOpen: (id: bigint) => void }) {
  const { address, isConnected } = useAccount()
  const { orders, isLoading } = useOrders()

  const mine = useMemo(
    () => orders.filter((o) => sameAddr(o.buyer, address) || sameAddr(o.seller, address)),
    [orders, address],
  )
  const peerWallets = useMemo(
    () => mine.flatMap((o) => [o.buyer, o.seller]),
    [mine],
  )
  const profilesMap = useTraderProfiles(peerWallets)

  if (!isConnected) return <ConnectPrompt body="Connect your wallet to inspect active escrow trades and order history." />
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="p2p-card h-20 animate-pulse rounded-xl" />
        <div className="p2p-card h-20 animate-pulse rounded-xl" />
      </div>
    )
  }

  if (mine.length === 0) {
    return <EmptyCard title="No P2P Orders Yet" body="Pick an offer in P2P Trade to open your first escrow order." />
  }

  const active = mine.filter((o) => isActiveStatus(o.status))
  const past = mine.filter((o) => !isActiveStatus(o.status))

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <section className="p2p-card overflow-hidden rounded-xl !border-[var(--p2p-border-active)]">
          <div className="flex items-center justify-between border-b border-[var(--p2p-border)] px-5 py-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#FF5A00]">
              Active Escrow Orders ({active.length})
            </h3>
            <span className="text-xs text-[var(--p2p-muted)]">Click an order to open execution room</span>
          </div>
          <ul>
            {active.map((o) => (
              <OrderRow
                key={o.id.toString()}
                order={o}
                viewer={address}
                profilesMap={profilesMap}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section className="p2p-card overflow-hidden rounded-xl">
          <div className="border-b border-[var(--p2p-border)] px-5 py-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--p2p-muted)]">
              Completed &amp; Past Orders ({past.length})
            </h3>
          </div>
          <ul>
            {past.map((o) => (
              <OrderRow
                key={o.id.toString()}
                order={o}
                viewer={address}
                profilesMap={profilesMap}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export function ArbiterPanel({ onOpen }: { onOpen: (id: bigint) => void }) {
  const { orders, isLoading } = useOrders()
  const disputed = useMemo(() => orders.filter((o) => o.status === STATUS.DISPUTED), [orders])
  const peerWallets = useMemo(() => disputed.flatMap((o) => [o.buyer, o.seller]), [disputed])
  const profilesMap = useTraderProfiles(peerWallets)

  if (isLoading) return <div className="p2p-card h-24 animate-pulse rounded-xl" />

  return (
    <div className="space-y-4">
      <div className="p2p-card flex flex-wrap items-center justify-between gap-2 rounded-xl px-5 py-3.5 text-xs text-[var(--p2p-muted)]">
        <span>Inspect evidence and rule on open disputes directly, or open the full control room.</span>
        <AppLink to="/admin" className="font-bold text-[#FF5A00] hover:underline">
          Open Admin Control Room →
        </AppLink>
      </div>
      {disputed.length === 0 ? (
        <EmptyCard title="No Open Disputes" body="Disputed escrow orders awaiting arbitration will appear here." />
      ) : (
        <section className="p2p-card overflow-hidden rounded-xl !border-[#FF5A00]">
          <ul>
            {disputed.map((o) => (
              <OrderRow key={o.id.toString()} order={o} profilesMap={profilesMap} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export function MyAds({ onPostAd }: { onPostAd: () => void }) {
  const { address, isConnected } = useAccount()
  const { ads, isLoading } = useAds()
  const now = useNow()
  const { run, writeContractAsync, pendingKey } = useTx()
  const [editing, setEditing] = useState<bigint | null>(null)
  const [newPrice, setNewPrice] = useState('')

  if (!isConnected) return <ConnectPrompt body="Connect your wallet to manage your Buy and Sell ads." />
  if (isLoading) return <div className="p2p-card h-24 animate-pulse rounded-xl" />

  const mine = ads.filter((a) => sameAddr(a.maker, address))
  if (mine.length === 0) {
    return (
      <EmptyCard
        title="You Have No Ads"
        body="Post a Buy or Sell offer with your custom exchange rate, payment methods, and expiry window."
        cta={
          <button
            type="button"
            onClick={onPostAd}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
          >
            <Plus className="size-4" /> Post Ad
          </button>
        }
      />
    )
  }

  const base = { address: ESCROW_ADDRESS!, abi: p2pEscrowAbi, chainId: CHAIN_ID } as const
  const updatePrice = (id: bigint, priceE6: bigint) =>
    run(`price-${id}`, 'Update price', () =>
      writeContractAsync({ ...base, functionName: 'setAdPrice', args: [id, priceE6] }),
    )
  const setPaused = (id: bigint, paused: boolean) =>
    run(`pause-${id}`, paused ? 'Pause ad' : 'Resume ad', () =>
      writeContractAsync({ ...base, functionName: 'setAdPaused', args: [id, paused] }),
    )
  const refreshAd = (id: bigint) =>
    run(`refresh-${id}`, 'Refresh ad expiry', () =>
      writeContractAsync({ ...base, functionName: 'refreshAd', args: [id, DEFAULT_TTL_HOURS] }),
    )
  const closeAd = (id: bigint) =>
    run(`close-${id}`, 'Close ad', () => writeContractAsync({ ...base, functionName: 'closeAd', args: [id] }))

  const copyAdShare = async (adId: string) => {
    try {
      const link = await buildShareLink(`/p2p?trade=${adId}`)
      await navigator.clipboard.writeText(link)
      toast.success(`Ad #${adId} share link copied`)
    } catch {
      toast.error('Could not copy share link')
    }
  }

  return (
    <div className="space-y-4">
      <div className="p2p-card flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3">
        <p className="text-xs text-[var(--p2p-muted)]">
          Manage your active offers, refresh TTL timers, adjust rates, share your ad link, or close ads to withdraw unreserved USDC.
        </p>
        <button
          type="button"
          onClick={onPostAd}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-3.5 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
        >
          <Plus className="size-3.5" /> New Ad
        </button>
      </div>

      <ul className="space-y-3">
        {mine.map((ad) => {
          const currency = hexToCurrency(ad.currency)
          const id = ad.id.toString()
          const sell = ad.side === SIDE_SELL
          const expired = !ad.closed && isAdExpired(ad.expiresAt, now)
          const ttlLeft = Math.max(0, Number(ad.expiresAt) - now)
          const stateLabel = ad.closed ? 'Closed' : expired ? 'Expired' : ad.paused ? 'Paused' : 'Live'
          const isLive = stateLabel === 'Live'

          return (
            <li key={id} className="p2p-card rounded-xl p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-[var(--p2p-tint)] px-2 py-0.5 text-xs font-bold text-[#FF5A00]">
                      {sell ? 'SELL USDC' : 'BUY USDC'}
                    </span>
                    <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">
                      {formatUsdcAmount(ad.available)} USDC remaining
                    </span>
                    <span className="p2p-mono text-xs text-[var(--p2p-muted)]">Ad #{id}</span>
                  </div>

                  <p className="p2p-mono text-xs text-[var(--p2p-muted)]">
                    Rate: <strong className="text-[var(--p2p-ink)]">{formatPrice(ad.priceE6)} {currency}</strong> • Limits:{' '}
                    {formatUsdcAmount(ad.minAmount)} - {formatUsdcAmount(ad.maxAmount)} USDC
                    {!ad.closed && (
                      <>
                        {' '}•{' '}
                        <span className={expired ? 'font-bold text-[#FF5A00]' : ''}>
                          {expired ? 'TTL Expired (Hidden)' : `TTL ${formatDuration(ttlLeft)}`}
                        </span>
                      </>
                    )}
                  </p>

                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {maskToMethods(ad.paymentMask).map((m) => (
                      <span
                        key={m.bit}
                        className="rounded bg-[var(--p2p-input-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--p2p-ink)] ring-1 ring-inset ring-[var(--p2p-border)]"
                        style={{ borderLeft: '3px solid #FF5A00' }}
                      >
                        {m.name}
                      </span>
                    ))}
                  </div>
                </div>

                <span
                  className={`rounded border px-2.5 py-1 text-xs font-bold ${
                    isLive || expired
                      ? 'border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] text-[#FF5A00]'
                      : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
                  }`}
                >
                  {stateLabel}
                </span>
              </div>

              {!ad.closed && (
                <div className="mt-4 border-t border-[var(--p2p-border)] pt-3.5">
                  {editing === ad.id ? (
                    <div className="flex flex-wrap gap-2">
                      <input
                        inputMode="decimal"
                        value={newPrice}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.]/g, '')
                          if (/^\d*\.?\d{0,4}$/.test(v)) setNewPrice(v)
                        }}
                        placeholder={`New price (${currency})`}
                        className="p2p-input p2p-mono h-10 flex-1 rounded-lg px-3 text-xs font-bold"
                      />
                      <button
                        type="button"
                        disabled={!newPrice || pendingKey === `price-${id}`}
                        onClick={() =>
                          void updatePrice(ad.id, parseUnitsExact(newPrice, 6)).then((ok) => ok && setEditing(null))
                        }
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] disabled:opacity-40"
                      >
                        {pendingKey === `price-${id}` && <Loader2 className="size-3.5 animate-spin" />}
                        Save Rate
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="h-10 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-xs font-semibold text-[var(--p2p-ink)]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pendingKey === `refresh-${id}`}
                        onClick={() => void refreshAd(ad.id)}
                        className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3.5 text-xs font-bold transition-colors ${
                          expired
                            ? 'bg-[#FF5A00] text-[#FFFFFF]'
                            : 'border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)] hover:border-[#FF5A00]'
                        }`}
                      >
                        <RotateCw className={`size-3.5 ${pendingKey === `refresh-${id}` ? 'animate-spin' : ''}`} />
                        Refresh (+{DEFAULT_TTL_HOURS}h)
                      </button>

                      <button
                        type="button"
                        onClick={() => setEditing(ad.id)}
                        className="min-h-9 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 text-xs font-semibold text-[var(--p2p-ink)] hover:border-[var(--p2p-border-active)]"
                      >
                        Edit Price
                      </button>

                      <button
                        type="button"
                        onClick={() => void copyAdShare(id)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 text-xs font-semibold text-[var(--p2p-ink)] hover:border-[#FF5A00]"
                      >
                        <Share2 className="size-3.5 text-[#FF5A00]" /> Share Ad
                      </button>

                      <button
                        type="button"
                        disabled={pendingKey === `pause-${id}`}
                        onClick={() => void setPaused(ad.id, !ad.paused)}
                        className="min-h-9 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 text-xs font-semibold text-[var(--p2p-ink)] hover:border-[var(--p2p-border-active)]"
                      >
                        {ad.paused ? 'Resume Ad' : 'Pause Ad'}
                      </button>

                      <button
                        type="button"
                        disabled={pendingKey === `close-${id}`}
                        onClick={() => void closeAd(ad.id)}
                        className="min-h-9 rounded-lg border border-[#FF5A00] bg-transparent px-3.5 text-xs font-bold text-[#FF5A00] hover:bg-[var(--p2p-tint)]"
                      >
                        {sell ? 'Close & Withdraw USDC' : 'Close Ad'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
