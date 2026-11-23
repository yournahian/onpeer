import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ChevronRight, MessageSquare, ShieldAlert } from 'lucide-react'
import {
  STATUS_META,
  countryByCurrency,
  formatFiat,
  formatUsdcAmount,
  hexToCurrency,
  isActiveStatus,
  sameAddr,
  shortAddr,
} from '@/lib/p2p'
import { useOrders } from '@/hooks/useEscrow'
import { traderInitial, traderLabel, useTraderProfiles } from '@/hooks/useSocial'

export function ChatHub({
  onOpen,
  onOpenTrader,
}: {
  onOpen: (orderId: bigint) => void
  onOpenTrader?: (wallet: string) => void
}) {
  const { address, isConnected } = useAccount()
  const { orders, isLoading } = useOrders()
  const [filter, setFilter] = useState<'all' | 'active' | 'past'>('all')

  const mine = useMemo(
    () =>
      address
        ? orders.filter((o) => sameAddr(o.buyer, address) || sameAddr(o.seller, address))
        : [],
    [orders, address],
  )

  const counterpartyWallets = useMemo(
    () =>
      mine.map((o) => (sameAddr(o.buyer, address) ? o.seller : o.buyer)),
    [mine, address],
  )
  const profilesMap = useTraderProfiles(counterpartyWallets)

  const filtered = useMemo(() => {
    if (filter === 'active') return mine.filter((o) => isActiveStatus(o.status))
    if (filter === 'past') return mine.filter((o) => !isActiveStatus(o.status))
    return mine
  }, [mine, filter])

  if (!isConnected) {
    return (
      <div className="p2p-card rounded-xl px-6 py-14 text-center">
        <p className="text-base font-bold text-[var(--p2p-ink)]">Connect Your Wallet</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--p2p-muted)]">
          Connect your wallet to access encrypted order chats with your P2P counterparties.
        </p>
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button
              type="button"
              onClick={show}
              className="mt-5 inline-flex min-h-10 items-center rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
            >
              Connect Wallet
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="p2p-card h-20 animate-pulse rounded-xl" />
        <div className="p2p-card h-20 animate-pulse rounded-xl" />
      </div>
    )
  }

  const activeCount = mine.filter((o) => isActiveStatus(o.status)).length

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-[var(--p2p-ink)]">P2P Chat</h1>
          <p className="text-xs text-[var(--p2p-muted)]">
            End-to-end encrypted order threads • Select an order to message your counterparty
          </p>
        </div>

        <div className="flex items-center gap-1.5 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-1">
          {[
            { id: 'all' as const, label: `All (${mine.length})` },
            { id: 'active' as const, label: `Active (${activeCount})` },
            { id: 'past' as const, label: `Completed (${mine.length - activeCount})` },
          ].map((t) => {
            const active = filter === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  active
                    ? 'bg-[#FF5A00] text-white'
                    : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Anti-Triangulation Safety Notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-surface)] px-4 py-3 text-xs text-[var(--p2p-muted)]">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[#FF5A00]" />
        <p>
          <strong className="text-[var(--p2p-ink)]">Name-Match Rule:</strong> Never transfer or release funds if the
          payment account name does not match your counterparty&apos;s verified name. OnPeer is not liable for trades
          completed despite a third-party name mismatch.
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="p2p-card rounded-xl px-6 py-14 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]">
            <MessageSquare className="size-5" />
          </div>
          <p className="mt-3 text-sm font-bold text-[var(--p2p-ink)]">No Chat Threads Found</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-[var(--p2p-muted)]">
            Every P2P escrow order automatically opens a private encrypted chat room between buyer and seller.
          </p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]">
          <ul className="divide-y divide-[var(--p2p-border)]">
            {filtered.map((o) => {
              const isBuyer = sameAddr(address, o.buyer)
              const peerWallet = (isBuyer ? o.seller : o.buyer).toLowerCase()
              const peerProfile = profilesMap.get(peerWallet) ?? null
              const peerName = traderLabel(peerWallet, peerProfile)
              const initial = traderInitial(peerWallet, peerProfile)
              const currency = hexToCurrency(o.currency)
              const country = countryByCurrency(currency)
              const active = isActiveStatus(o.status)

              return (
                <li
                  key={o.id.toString()}
                  className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--p2p-row-hover)] sm:px-5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => (onOpenTrader ? onOpenTrader(peerWallet) : onOpen(o.id))}
                      title={`View ${peerName}'s profile`}
                      className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--p2p-tint)] text-sm font-extrabold text-[#FF5A00]"
                    >
                      {initial}
                      <span
                        className={`absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-[var(--p2p-surface-solid)] ${
                          active ? 'bg-emerald-400' : 'bg-[var(--p2p-muted)]'
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpen(o.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-bold text-[var(--p2p-ink)]">{peerName}</span>
                        <span className="p2p-mono text-[11px] text-[var(--p2p-muted)]">
                          ({shortAddr(peerWallet)})
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            isBuyer
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-[var(--p2p-tint)] text-[#FF5A00]'
                          }`}
                        >
                          {isBuyer ? 'Buy USDC' : 'Sell USDC'}
                        </span>
                      </div>

                      <p className="p2p-mono mt-0.5 truncate text-xs text-[var(--p2p-muted)]">
                        Order #{o.id.toString()} • {formatUsdcAmount(o.amount)} USDC ({country?.symbol}
                        {formatFiat(o.fiatAmountE6)} {currency})
                      </p>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpen(o.id)}
                    className="flex shrink-0 items-center gap-2"
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                        active
                          ? 'border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] text-[#FF5A00]'
                          : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
                      }`}
                    >
                      {active && <span className="size-1.5 rounded-full bg-[#FF5A00]" />}
                      {STATUS_META[o.status]?.label ?? 'Order'}
                    </span>
                    <ChevronRight className="size-4 text-[var(--p2p-muted)]" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
