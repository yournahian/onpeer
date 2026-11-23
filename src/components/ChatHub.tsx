import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import {
  ArrowLeft,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  Search,
  Smile,
  Users,
} from 'lucide-react'
import {
  STATUS,
  STATUS_META,
  formatFiat,
  formatUsdcAmount,
  hexToCurrency,
  isActiveStatus,
  sameAddr,
  shortAddr,
} from '@/lib/p2p'
import { useNow, useOrders, type OrderWithId } from '@/hooks/useEscrow'
import { OrderChat } from '@/components/OrderChat'
import {
  traderInitial,
  traderLabel,
  useMyRelations,
  useTraderProfiles,
} from '@/hooks/useSocial'

function formatThreadTime(createdSec: bigint, nowSec: number): string {
  const sec = Number(createdSec)
  if (!Number.isFinite(sec) || sec <= 0) return ''
  const diffDays = Math.floor((nowSec - sec) / 86_400)
  const d = new Date(sec * 1000)
  if (diffDays === 0) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (diffDays === 1) return 'Yesterday'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  if (diffDays < 365) return `${mm}/${dd}`
  return `${d.getFullYear()}/${mm}/${dd}`
}

function formatThreadSubtitle(o: OrderWithId, isBuyer: boolean): string {
  const amt = formatUsdcAmount(o.amount)
  const sym = o.asset
  if (o.status === STATUS.COMPLETED || o.status === STATUS.RESOLVED_BUYER) {
    return isBuyer ? `You received ${amt} ${sym}.` : `You sent ${amt} ${sym}.`
  }
  if (o.status === STATUS.CANCELLED || o.status === STATUS.RESOLVED_SELLER) {
    return `Order #${o.rawId.toString()} canceled.`
  }
  if (o.status === STATUS.DISPUTED) {
    return `Dispute open on Order #${o.rawId.toString()} (${amt} ${sym})`
  }
  if (o.status === STATUS.PAID) {
    return `Payment marked • ${amt} ${sym} awaiting release`
  }
  return `Active Order #${o.rawId.toString()} • ${amt} ${sym}`
}

export function ChatHub({
  initialOrderId = null,
  onOpen,
  onOpenTrader,
}: {
  initialOrderId?: bigint | null
  onOpen: (orderId: bigint) => void
  onOpenTrader?: (wallet: string) => void
}) {
  const { address, isConnected } = useAccount()
  const queryClient = useQueryClient()
  const { orders, isLoading } = useOrders()
  const { following } = useMyRelations()
  const now = useNow()

  const [tab, setTab] = useState<'all' | 'unread' | 'friends'>('all')
  const [search, setSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<bigint | null>(initialOrderId)
  const [refreshing, setRefreshing] = useState(false)

  const mine = useMemo(
    () =>
      address
        ? orders.filter((o) => sameAddr(o.buyer, address) || sameAddr(o.seller, address))
        : [],
    [orders, address],
  )

  const counterpartyWallets = useMemo(
    () => mine.map((o) => (sameAddr(o.buyer, address) ? o.seller : o.buyer)),
    [mine, address],
  )
  const profilesMap = useTraderProfiles(counterpartyWallets)

  const activeCount = useMemo(
    () => mine.filter((o) => isActiveStatus(o.status)).length,
    [mine],
  )

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = tab === 'unread' ? mine.filter((o) => isActiveStatus(o.status)) : mine
    if (!q) return base
    return base.filter((o) => {
      const peer = (sameAddr(address, o.buyer) ? o.seller : o.buyer).toLowerCase()
      const alias = (profilesMap.get(peer)?.displayName ?? '').toLowerCase()
      return (
        o.id.toString().includes(q) ||
        peer.includes(q) ||
        alias.includes(q)
      )
    })
  }, [mine, tab, search, address, profilesMap])

  const filteredFriends = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return following
    return following.filter(
      (f) =>
        f.wallet.toLowerCase().includes(q) ||
        (f.displayName ?? '').toLowerCase().includes(q),
    )
  }, [following, search])

  const selectedOrder = useMemo(
    () => (selectedOrderId !== null ? mine.find((o) => o.id === selectedOrderId) ?? null : null),
    [mine, selectedOrderId],
  )

  if (!isConnected) {
    return (
      <div className="p2p-card rounded-xl px-6 py-14 text-center">
        <p className="text-base font-bold text-[var(--p2p-ink)]">Connect Your Wallet</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--p2p-muted)]">
          Connect your wallet to access encrypted P2P order chats with your counterparties.
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
    return <div className="h-[540px] animate-pulse rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]" />
  }

  const handleRefresh = () => {
    setRefreshing(true)
    void queryClient.invalidateQueries().finally(() => {
      setTimeout(() => setRefreshing(false), 400)
    })
  }

  return (
    <section className="mx-auto max-w-[1260px] overflow-hidden rounded-2xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] md:grid md:min-h-[640px] md:grid-cols-[340px_minmax(0,1fr)]">
      {/* =====================================================================
          LEFT PANE: CONTACTS & ORDER THREADS (SS 3)
         ===================================================================== */}
      <div
        className={`flex flex-col border-r border-[var(--p2p-border)] bg-[var(--p2p-canvas)] ${
          selectedOrder ? 'hidden md:flex' : 'flex min-h-[540px]'
        }`}
      >
        {/* Top Title + Icons */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h1 className="text-lg font-extrabold text-[var(--p2p-ink)]">Chat</h1>

          <div className="flex items-center gap-1.5 text-[var(--p2p-muted)]">
            <button
              type="button"
              onClick={handleRefresh}
              title="Refresh chats"
              className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-[var(--p2p-input-bg)] hover:text-[var(--p2p-ink)]"
            >
              <RefreshCw className={`size-4 ${refreshing ? 'animate-spin text-[#FF5A00]' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setTab('friends')}
              title="Followed Traders"
              className={`inline-flex size-8 items-center justify-center rounded-lg hover:bg-[var(--p2p-input-bg)] ${
                tab === 'friends' ? 'text-[#FF5A00]' : 'hover:text-[var(--p2p-ink)]'
              }`}
            >
              <Users className="size-4" />
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="px-4 pb-3">
          <div className="flex h-9 items-center gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-xs">
            <Search className="size-3.5 shrink-0 text-[var(--p2p-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-full bg-transparent text-xs text-[var(--p2p-ink)] outline-none placeholder:text-[var(--p2p-muted)]"
            />
          </div>
        </div>

        {/* Sub-Tabs: All | Unread (N) | Friends (SS 3) */}
        <div className="flex items-center gap-5 border-b border-[var(--p2p-border)] px-4">
          {[
            { id: 'all' as const, label: 'All' },
            { id: 'unread' as const, label: `Active (${activeCount})` },
            { id: 'friends' as const, label: 'Friends' },
          ].map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative pb-2.5 text-xs font-bold transition-colors ${
                  active ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                }`}
              >
                {t.label}
                {active && <span className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-full bg-[#FF5A00]" />}
              </button>
            )
          })}
        </div>

        {/* Thread / Friends List */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'friends' ? (
            filteredFriends.length === 0 ? (
              <div className="px-5 py-14 text-center text-xs text-[var(--p2p-muted)]">
                Advertisers you follow will appear here for quick access.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--p2p-border)]">
                {filteredFriends.map((f) => {
                  const latestWithFriend = mine.find(
                    (o) => sameAddr(o.buyer, f.wallet) || sameAddr(o.seller, f.wallet),
                  )
                  return (
                    <li key={f.wallet}>
                      <button
                        type="button"
                        onClick={() => {
                          if (latestWithFriend) {
                            setTab('all')
                            setSelectedOrderId(latestWithFriend.id)
                          } else {
                            onOpenTrader?.(f.wallet)
                          }
                        }}
                        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--p2p-row-hover)]"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--p2p-tint)] text-sm font-extrabold text-[#FF5A00]">
                          {traderInitial(f.wallet, f)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-[var(--p2p-ink)]">
                            {traderLabel(f.wallet, f)}
                          </p>
                          <p className="truncate text-xs text-[var(--p2p-muted)]">
                            {latestWithFriend
                              ? `Order #${latestWithFriend.id.toString()} — tap to chat`
                              : 'Followed advertiser — view profile'}
                          </p>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )
          ) : filteredThreads.length === 0 ? (
            <div className="px-5 py-14 text-center text-xs text-[var(--p2p-muted)]">
              No order chat threads yet. Open a P2P order to start messaging.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--p2p-border)]">
              {filteredThreads.map((o) => {
                const isBuyer = sameAddr(address, o.buyer)
                const peerWallet = (isBuyer ? o.seller : o.buyer).toLowerCase()
                const peerProfile = profilesMap.get(peerWallet) ?? null
                const peerName = traderLabel(peerWallet, peerProfile)
                const initial = traderInitial(peerWallet, peerProfile)
                const active = isActiveStatus(o.status)
                const selected = selectedOrderId === o.id

                return (
                  <li key={o.id.toString()}>
                    <button
                      type="button"
                      onClick={() => setSelectedOrderId(o.id)}
                      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                        selected
                          ? 'bg-[var(--p2p-tint)]'
                          : 'hover:bg-[var(--p2p-row-hover)]'
                      }`}
                    >
                      <div className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--p2p-input-bg)] text-sm font-extrabold text-[#FF5A00] ring-1 ring-[var(--p2p-border)]">
                        {initial}
                        {active && (
                          <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-[#FF5A00]" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-bold text-[var(--p2p-ink)]">{peerName}</span>
                          <span className="p2p-mono shrink-0 text-[11px] text-[var(--p2p-muted)]">
                            {formatThreadTime(o.createdAt, now)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-[var(--p2p-muted)]">
                          {formatThreadSubtitle(o, isBuyer)}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* =====================================================================
          RIGHT PANE: EMPTY STATE OR EMBEDDED ORDER CHAT (SS 3)
         ===================================================================== */}
      <div
        className={`flex flex-col bg-[var(--p2p-surface)] ${
          selectedOrder ? 'flex min-h-[560px]' : 'hidden md:flex'
        }`}
      >
        {!selectedOrder ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="relative flex size-20 items-center justify-center">
              <MessageSquare className="size-12 -translate-x-2 -translate-y-2 text-[var(--p2p-muted)] opacity-60" />
              <div className="absolute bottom-2 right-2 flex size-10 items-center justify-center rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-canvas)] text-[#FF5A00] shadow-md">
                <Smile className="size-5" />
              </div>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--p2p-muted)]">
              Welcome to OnPeer Chat. Select a contact to start chatting.
            </p>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {/* Active Conversation Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--p2p-border)] bg-[var(--p2p-canvas)] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setSelectedOrderId(null)}
                  aria-label="Back to chat list"
                  className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)] md:hidden"
                >
                  <ArrowLeft className="size-4" />
                </button>

                {(() => {
                  const peer = (sameAddr(address, selectedOrder.buyer) ? selectedOrder.seller : selectedOrder.buyer).toLowerCase()
                  const prof = profilesMap.get(peer) ?? null
                  const name = traderLabel(peer, prof)
                  const cur = hexToCurrency(selectedOrder.currency)
                  return (
                    <div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenTrader?.(peer)}
                          className="text-sm font-extrabold text-[var(--p2p-ink)] hover:text-[#FF5A00] hover:underline"
                        >
                          {name}
                        </button>
                        <span className="p2p-mono text-[11px] text-[var(--p2p-muted)]">({shortAddr(peer)})</span>
                      </div>
                      <p className="p2p-mono text-[11px] text-[var(--p2p-muted)]">
                        Order #{selectedOrder.rawId.toString()} • {formatUsdcAmount(selectedOrder.amount)}{' '}
                        {selectedOrder.asset} ({formatFiat(selectedOrder.fiatAmountE6, 0)} {cur}) •{' '}
                        <span className="text-[#FF5A00]">
                          {STATUS_META[selectedOrder.status]?.label ?? 'Order'}
                        </span>
                      </p>
                    </div>
                  )
                })()}
              </div>

              <button
                type="button"
                onClick={() => onOpen(selectedOrder.id)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-3 text-xs font-bold text-white hover:opacity-90"
              >
                <span>Order Room</span>
                <ExternalLink className="size-3" />
              </button>
            </div>

            {/* Embedded Encrypted OrderChat */}
            <div className="flex-1 p-3 sm:p-4">
              <OrderChat
                key={selectedOrder.id.toString()}
                orderId={selectedOrder.id}
                buyer={selectedOrder.buyer}
                seller={selectedOrder.seller}
                canPost={isActiveStatus(selectedOrder.status)}
                orderStatus={selectedOrder.status}
                disputedAt={selectedOrder.disputedAt}
                amountText={`${formatUsdcAmount(selectedOrder.amount)} USDC`}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
