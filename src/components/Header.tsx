import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useSwitchChain } from 'wagmi'
import {
  ArrowLeftRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Gavel,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Plus,
  ReceiptText,
  Store,
  User,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  ESCROW_ADDRESS,
  STATUS,
  formatUsdcAmount,
  isActiveStatus,
  sameAddr,
} from '@/lib/p2p'
import { useClaimable, useOrders, useUsdcBalance } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'

export type TabId = 'market' | 'orders' | 'ads' | 'chat' | 'account' | 'arbiter'
export type UserCenterQuickTarget = 'payments' | 'merchant' | 'help' | 'restrictions' | 'notifications'

export function Header({
  tab,
  onTab,
  showArbiter,
  onSelectTab,
  onPostAd,
  onUserCenterJump,
}: {
  tab: TabId
  onTab: (t: TabId) => void
  showArbiter: boolean
  onSelectTab?: () => void
  onPostAd?: () => void
  onUserCenterJump?: (target: UserCenterQuickTarget) => void
}) {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const balance = useUsdcBalance()
  const claimable = useClaimable()
  const { orders } = useOrders()
  const { run, writeContractAsync, pendingKey } = useTx()

  const [moreOpen, setMoreOpen] = useState(false)
  const [helpSubOpen, setHelpSubOpen] = useState(true)
  const moreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const activeOrderCount = address
    ? orders.filter((o) => (sameAddr(o.buyer, address) || sameAddr(o.seller, address)) && isActiveStatus(o.status)).length
    : 0
  const disputeCount = orders.filter((o) => o.status === STATUS.DISPUTED).length

  const selectTab = (id: TabId) => {
    setMoreOpen(false)
    onTab(id)
    onSelectTab?.()
  }

  const jumpUserCenter = (target: UserCenterQuickTarget) => {
    setMoreOpen(false)
    if (onUserCenterJump) {
      onUserCenterJump(target)
    } else {
      selectTab('account')
    }
  }

  return (
    <>
      {/* Desktop Sub-Header (>= 768px — SS 2, 3, 4, 5, 6 Pattern) */}
      <div className="relative z-30 hidden border-b border-[var(--p2p-border)] bg-[var(--p2p-bar)] backdrop-blur-xl md:block">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 sm:px-8 lg:px-10">
          {/* Left Primary Section Tab: P2P */}
          <nav className="flex items-center gap-6" aria-label="P2P primary">
            <button
              type="button"
              onClick={() => selectTab('market')}
              aria-current={tab === 'market' ? 'page' : undefined}
              className={`relative flex min-h-12 items-center gap-2 whitespace-nowrap px-1 text-sm font-extrabold transition-colors ${
                tab === 'market' ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
              }`}
            >
              <span>P2P</span>
              {tab === 'market' && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#FF5A00]" />}
            </button>
          </nav>

          {/* Right P2P Utility Links: Orders | Chat | User Center | More ▾ (+ Wallet Balance) */}
          <div className="flex flex-wrap items-center gap-1.5 py-1.5 sm:gap-2">
            <nav className="flex items-center gap-1" aria-label="P2P sections">
              <button
                type="button"
                onClick={() => selectTab('orders')}
                aria-current={tab === 'orders' ? 'page' : undefined}
                className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-colors ${
                  tab === 'orders'
                    ? 'bg-[var(--p2p-tint)] text-[#FF5A00]'
                    : 'text-[var(--p2p-muted)] hover:bg-[var(--p2p-input-bg)] hover:text-[var(--p2p-ink)]'
                }`}
              >
                <ReceiptText className="size-3.5" />
                <span>Orders</span>
                {activeOrderCount > 0 && (
                  <span className="p2p-mono rounded-full bg-[#FF5A00] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#FFFFFF]">
                    {activeOrderCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => selectTab('chat')}
                aria-current={tab === 'chat' ? 'page' : undefined}
                className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-colors ${
                  tab === 'chat'
                    ? 'bg-[var(--p2p-tint)] text-[#FF5A00]'
                    : 'text-[var(--p2p-muted)] hover:bg-[var(--p2p-input-bg)] hover:text-[var(--p2p-ink)]'
                }`}
              >
                <MessageSquare className="size-3.5" />
                <span>Chat</span>
                {activeOrderCount > 0 && (
                  <span className="p2p-mono rounded-full bg-[#FF5A00] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#FFFFFF]">
                    {activeOrderCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => selectTab('account')}
                aria-current={tab === 'account' ? 'page' : undefined}
                className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-colors ${
                  tab === 'account'
                    ? 'bg-[var(--p2p-tint)] text-[#FF5A00]'
                    : 'text-[var(--p2p-muted)] hover:bg-[var(--p2p-input-bg)] hover:text-[var(--p2p-ink)]'
                }`}
              >
                <User className="size-3.5" />
                <span>User Center</span>
              </button>

              {/* More ▾ Dropdown Menu (Exact SS 5) */}
              <div ref={moreRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-expanded={moreOpen}
                  className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-colors ${
                    moreOpen || tab === 'ads' || tab === 'arbiter'
                      ? 'bg-[var(--p2p-tint)] text-[#FF5A00]'
                      : 'text-[var(--p2p-muted)] hover:bg-[var(--p2p-input-bg)] hover:text-[var(--p2p-ink)]'
                  }`}
                >
                  <MoreHorizontal className="size-3.5 rounded-full border border-current p-0.5" />
                  <span>More</span>
                  <ChevronDown className={`size-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                </button>

                {moreOpen && (
                  <div className="absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] py-1.5 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => jumpUserCenter('payments')}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs font-semibold text-[var(--p2p-ink)] hover:bg-[var(--p2p-row-hover)]"
                    >
                      <CreditCard className="size-4 text-[var(--p2p-muted)]" />
                      <span>P2P Payment Methods</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false)
                        onPostAd?.()
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs font-semibold text-[var(--p2p-ink)] hover:bg-[var(--p2p-row-hover)]"
                    >
                      <Plus className="size-4 text-[var(--p2p-muted)]" />
                      <span>Post new Ad</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => selectTab('ads')}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs font-semibold text-[var(--p2p-ink)] hover:bg-[var(--p2p-row-hover)]"
                    >
                      <Megaphone className="size-4 text-[var(--p2p-muted)]" />
                      <span>My ads</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => jumpUserCenter('merchant')}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs font-semibold text-[var(--p2p-ink)] hover:bg-[var(--p2p-row-hover)]"
                    >
                      <Store className="size-4 text-[var(--p2p-muted)]" />
                      <span>Become a merchant</span>
                    </button>

                    {showArbiter && (
                      <button
                        type="button"
                        onClick={() => selectTab('arbiter')}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold text-[var(--p2p-ink)] hover:bg-[var(--p2p-row-hover)]"
                      >
                        <span className="flex items-center gap-2.5">
                          <Gavel className="size-4 text-[#FF5A00]" />
                          <span>Disputes</span>
                        </span>
                        {disputeCount > 0 && (
                          <span className="p2p-mono rounded-full bg-[#FF5A00] px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {disputeCount}
                          </span>
                        )}
                      </button>
                    )}

                    {/* Collapsible P2P Help Center Submenu (SS 5) */}
                    <div className="mt-1 border-t border-[var(--p2p-border)] pt-1">
                      <button
                        type="button"
                        onClick={() => setHelpSubOpen((v) => !v)}
                        className="flex w-full items-center justify-between bg-[var(--p2p-input-bg)]/60 px-4 py-2.5 text-left text-xs font-bold text-[var(--p2p-ink)] hover:bg-[var(--p2p-row-hover)]"
                      >
                        <span className="flex items-center gap-2.5">
                          <BookOpen className="size-4 text-[var(--p2p-muted)]" />
                          <span>P2P Help Center</span>
                        </span>
                        {helpSubOpen ? (
                          <ChevronUp className="size-3.5 text-[var(--p2p-muted)]" />
                        ) : (
                          <ChevronDown className="size-3.5 text-[var(--p2p-muted)]" />
                        )}
                      </button>

                      {helpSubOpen && (
                        <div className="py-1">
                          {[
                            'How to Buy/Sell',
                            'Placing an Order',
                            'Anti-Scam Safety Rules',
                            'P2P Trading FAQ',
                          ].map((topic) => (
                            <button
                              key={topic}
                              type="button"
                              onClick={() => jumpUserCenter('help')}
                              className="block w-full px-10 py-2 text-left text-xs text-[var(--p2p-muted)] hover:bg-[var(--p2p-row-hover)] hover:text-[var(--p2p-ink)]"
                            >
                              {topic}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </nav>

            {isConnected && balance !== undefined && (
              <span className="p2p-mono ml-1 inline-flex items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--p2p-ink)]">
                <TokenUSDC variant="branded" size={14} />
                {formatUsdcAmount(balance)} USDC
              </span>
            )}

            {isConnected && claimable > 0n && (
              <button
                type="button"
                disabled={pendingKey === 'withdraw'}
                onClick={() =>
                  void run('withdraw', 'Withdraw USDC', () =>
                    writeContractAsync({
                      address: ESCROW_ADDRESS!,
                      abi: p2pEscrowAbi,
                      functionName: 'withdrawClaimable',
                      chainId: CHAIN_ID,
                    }),
                  )
                }
                className="p2p-mono inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-3 text-xs font-bold text-[#FFFFFF] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Claim {formatUsdcAmount(claimable)} USDC
              </button>
            )}

            {isConnected && chainId !== CHAIN_ID && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => switchChain({ chainId: CHAIN_ID })}
                className="inline-flex min-h-8 items-center rounded-lg border border-[#FF5A00] bg-[var(--p2p-tint)] px-3 text-xs font-bold text-[#FF5A00] transition-colors hover:bg-[#FF5A00] hover:text-[#FFFFFF] disabled:opacity-50"
              >
                Switch to Arc
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Compact Utility Strip (< 768px, only when claimable > 0, wrong network, or arbiter has disputes) */}
      {isConnected && (claimable > 0n || chainId !== CHAIN_ID || (showArbiter && disputeCount > 0)) && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--p2p-border)] bg-[var(--p2p-bar)] px-4 py-2 backdrop-blur-xl md:hidden">
          <span className="p2p-mono inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--p2p-ink)]">
            <TokenUSDC variant="branded" size={14} />
            {balance !== undefined ? `${formatUsdcAmount(balance)} USDC` : 'Arc Escrow'}
          </span>
          <div className="flex items-center gap-2">
            {showArbiter && disputeCount > 0 && (
              <button
                type="button"
                onClick={() => selectTab('arbiter')}
                className="inline-flex items-center gap-1 rounded-lg border border-[#FF5A00] bg-[var(--p2p-tint)] px-2.5 py-1 text-xs font-bold text-[#FF5A00]"
              >
                <Gavel className="size-3" /> Disputes ({disputeCount})
              </button>
            )}
            {claimable > 0n && (
              <button
                type="button"
                disabled={pendingKey === 'withdraw'}
                onClick={() =>
                  void run('withdraw', 'Withdraw USDC', () =>
                    writeContractAsync({
                      address: ESCROW_ADDRESS!,
                      abi: p2pEscrowAbi,
                      functionName: 'withdrawClaimable',
                      chainId: CHAIN_ID,
                    }),
                  )
                }
                className="p2p-mono rounded-lg bg-[#FF5A00] px-2.5 py-1 text-xs font-bold text-[#FFFFFF]"
              >
                Claim {formatUsdcAmount(claimable)}
              </button>
            )}
            {chainId !== CHAIN_ID && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => switchChain({ chainId: CHAIN_ID })}
                className="rounded-lg border border-[#FF5A00] bg-[var(--p2p-tint)] px-2.5 py-1 text-xs font-bold text-[#FF5A00]"
              >
                Switch to Arc
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** Fixed 62px 5-tab Bottom Navigation Bar for Mobile (< 768px — SS 1, 7, 8, 11) */
export function MobileBottomNav({
  tab,
  onTab,
  onSelectTab,
}: {
  tab: TabId
  onTab: (t: TabId) => void
  showArbiter?: boolean
  onSelectTab?: () => void
}) {
  const { address } = useAccount()
  const { orders } = useOrders()

  const activeOrderCount = address
    ? orders.filter((o) => (sameAddr(o.buyer, address) || sameAddr(o.seller, address)) && isActiveStatus(o.status)).length
    : 0

  const items: { id: TabId; label: string; icon: typeof ArrowLeftRight; badge?: number }[] = [
    { id: 'market', label: 'P2P', icon: ArrowLeftRight },
    { id: 'orders', label: 'Orders', icon: ReceiptText, badge: activeOrderCount },
    { id: 'ads', label: 'Ads', icon: Megaphone },
    { id: 'chat', label: 'Chat', icon: MessageSquare, badge: activeOrderCount },
    { id: 'account', label: 'Profile', icon: User },
  ]

  const nav = (
    <nav
      aria-label="Mobile P2P navigation"
      className="p2p-terminal fixed inset-x-0 bottom-0 z-40 flex h-[62px] items-center justify-around border-t border-[var(--p2p-border)] bg-[var(--p2p-bar)] px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl md:hidden"
    >
      {items.map((item) => {
        const active = tab === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onTab(item.id)
              onSelectTab?.()
            }}
            aria-current={active ? 'page' : undefined}
            className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
              active ? 'text-[#FF5A00]' : 'text-[var(--p2p-muted)]'
            }`}
          >
            <span className="relative">
              <item.icon className="size-5" />
              {!!item.badge && (
                <span className="p2p-mono absolute -right-2.5 -top-1.5 flex min-w-[16px] items-center justify-center rounded-full bg-[#FF5A00] px-1 py-0.5 text-[9px] font-bold leading-none text-[#FFFFFF]">
                  {item.badge}
                </span>
              )}
            </span>
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )

  return typeof document !== 'undefined' ? createPortal(nav, document.body) : nav
}
