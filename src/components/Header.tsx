import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { ArrowLeftRight, Gavel, Lock, Megaphone, ReceiptText, ShieldCheck } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import type { Address } from 'viem'
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

export type TabId = 'market' | 'orders' | 'ads' | 'account' | 'arbiter'

export function Header({
  tab,
  onTab,
  showArbiter,
  onSelectTab,
}: {
  tab: TabId
  onTab: (t: TabId) => void
  showArbiter: boolean
  onSelectTab?: () => void
}) {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const balance = useUsdcBalance()
  const claimable = useClaimable()
  const { orders } = useOrders()
  const { run, writeContractAsync, pendingKey } = useTx()

  const encKey = useReadContract({
    address: ESCROW_ADDRESS,
    abi: p2pEscrowAbi,
    chainId: CHAIN_ID,
    functionName: 'encryptionKey',
    args: [address as Address],
    query: { enabled: !!ESCROW_ADDRESS && !!address, refetchInterval: 30_000 },
  })
  const hasE2eeKey = typeof encKey.data === 'string' && encKey.data.length > 66

  const activeOrderCount = address
    ? orders.filter((o) => (sameAddr(o.buyer, address) || sameAddr(o.seller, address)) && isActiveStatus(o.status)).length
    : 0
  const disputeCount = orders.filter((o) => o.status === STATUS.DISPUTED).length

  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: 'market', label: 'P2P Trade' },
    { id: 'ads', label: 'My Ads' },
    { id: 'orders', label: 'My Orders', badge: activeOrderCount },
    { id: 'account', label: 'Account & Margin' },
    ...(showArbiter ? [{ id: 'arbiter' as const, label: 'Disputes', badge: disputeCount }] : []),
  ]

  const selectTab = (id: TabId) => {
    onTab(id)
    onSelectTab?.()
  }

  return (
    <>
      {/* Desktop Sub-Header (>= 768px) */}
      <div className="hidden border-b border-[var(--p2p-border)] bg-[var(--p2p-bar)] backdrop-blur-xl md:block">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 sm:px-8 lg:px-12">
          <nav className="flex items-center gap-1 overflow-x-auto" aria-label="P2P sections">
            {tabs.map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTab(t.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex min-h-11 items-center gap-2 whitespace-nowrap px-3.5 text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${
                    active ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                  }`}
                >
                  <span>{t.label}</span>
                  {!!t.badge && (
                    <span className="p2p-mono rounded-full bg-[#FF5A00] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#FFFFFF]">
                      {t.badge}
                    </span>
                  )}
                  {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#FF5A00]" />}
                </button>
              )
            })}
          </nav>

          <div className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="hidden items-center gap-1.5 rounded-full border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2.5 py-1 text-[11px] font-semibold text-[#FF5A00] lg:inline-flex">
              <span className="size-1.5 rounded-full bg-[#FF5A00]" />
              Arc Network
            </span>

            <span
              title={
                hasE2eeKey
                  ? 'X25519 public encryption key registered on Arc'
                  : 'On-chain escrow active • Step 2 X25519 E2EE registry ready'
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
                hasE2eeKey
                  ? 'border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] text-[#FF5A00]'
                  : 'border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)]'
              }`}
            >
              <Lock className="size-3.5 text-[#FF5A00]" />
              {hasE2eeKey ? 'E2EE Key Active' : 'Escrow Verified'}
            </span>

            {isConnected && balance !== undefined && (
              <span className="p2p-mono inline-flex items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--p2p-ink)]">
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

      {/* Mobile Compact Utility Strip (< 768px, only when claimable > 0 or wrong network) */}
      {isConnected && (claimable > 0n || chainId !== CHAIN_ID) && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--p2p-border)] bg-[var(--p2p-bar)] px-4 py-2 backdrop-blur-xl md:hidden">
          <span className="p2p-mono inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--p2p-ink)]">
            <TokenUSDC variant="branded" size={14} />
            {balance !== undefined ? `${formatUsdcAmount(balance)} USDC` : 'Arc Escrow'}
          </span>
          <div className="flex items-center gap-2">
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

/** Fixed 60px 4-tab Bottom Navigation Bar for Mobile (< 768px, hidden during Active Order Execution) */
export function MobileBottomNav({
  tab,
  onTab,
  showArbiter,
}: {
  tab: TabId
  onTab: (t: TabId) => void
  showArbiter: boolean
}) {
  const { address } = useAccount()
  const { orders } = useOrders()

  const activeOrderCount = address
    ? orders.filter((o) => (sameAddr(o.buyer, address) || sameAddr(o.seller, address)) && isActiveStatus(o.status)).length
    : 0
  const disputeCount = orders.filter((o) => o.status === STATUS.DISPUTED).length

  const items: { id: TabId; label: string; icon: typeof ArrowLeftRight; badge?: number }[] = [
    { id: 'market', label: 'P2P', icon: ArrowLeftRight },
    { id: 'orders', label: 'Orders', icon: ReceiptText, badge: activeOrderCount },
    { id: 'ads', label: 'My Ads', icon: Megaphone },
    { id: 'account', label: 'Account', icon: ShieldCheck },
    ...(showArbiter ? [{ id: 'arbiter' as const, label: 'Disputes', icon: Gavel, badge: disputeCount }] : []),
  ]

  return (
    <nav
      aria-label="Mobile P2P navigation"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[60px] items-center justify-around border-t border-[var(--p2p-border)] bg-[var(--p2p-bar)] px-2 backdrop-blur-2xl md:hidden"
    >
      {items.map((item) => {
        const active = tab === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTab(item.id)}
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
}
