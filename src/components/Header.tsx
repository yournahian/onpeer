import { useAccount, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { motion } from 'framer-motion'
import { Repeat, Sparkles, Waypoints } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { CHAIN_ID, ESCROW_ADDRESS, formatUsdcAmount, shortAddr } from '@/lib/p2p'
import { useClaimable, useUsdcBalance } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { Button } from '@/components/ui'
import { RollingNumber } from '@/components/fx/RollingNumber'
import { AppLink } from '@/components/AppLink'
import { Brand } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'

export type TabId = 'market' | 'orders' | 'ads' | 'account' | 'arbiter'

export function Header({
  tab,
  onTab,
  showArbiter,
}: {
  tab: TabId
  onTab: (t: TabId) => void
  showArbiter: boolean
}) {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const balance = useUsdcBalance()
  const claimable = useClaimable()
  const { run, writeContractAsync, pendingKey } = useTx()

  const tabs: { id: TabId; label: string }[] = [
    { id: 'market', label: 'P2P market' },
    { id: 'orders', label: 'My orders' },
    { id: 'ads', label: 'My ads' },
    { id: 'account', label: 'Trust & margin' },
    ...(showArbiter ? [{ id: 'arbiter' as const, label: 'Disputes' }] : []),
  ]

  return (
    <header className="sticky top-0 z-40" style={{ background: 'var(--bar-bg)', backdropFilter: 'blur(20px)' }}>
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8 lg:px-12">
        <Brand tagline="P2P market" />

        <div className="flex items-center gap-2">
          {isConnected && balance !== undefined && (
            <span className="glass hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold tabular-nums sm:flex">
              <TokenUSDC variant="branded" size={16} />
              <RollingNumber value={formatUsdcAmount(balance)} />
            </span>
          )}
          {claimable > 0n && (
            <Button
              variant="buy"
              className="min-h-10"
              loading={pendingKey === 'withdraw'}
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
            >
              Withdraw {formatUsdcAmount(claimable)}
            </Button>
          )}
          {isConnected && chainId !== CHAIN_ID && (
            <Button variant="danger" className="min-h-10" loading={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
              Switch to Arc Testnet
            </Button>
          )}
          <ThemeToggle className="hidden sm:inline-flex" />
          <ThemeToggle compact className="sm:hidden" />
          <ConnectKitButton.Custom>
            {({ show, isConnected: c, address }) => (
              <Button variant={c ? 'ghost' : 'primary'} className="mono min-h-10" onClick={show}>
                {c && address ? shortAddr(address) : 'Connect'}
              </Button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>

      <nav className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-4 sm:px-8 lg:px-12" aria-label="Sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className="relative min-h-11 whitespace-nowrap px-4 text-sm font-semibold transition-colors"
            style={{ color: tab === t.id ? 'var(--ink)' : 'var(--subtle)' }}
          >
            {t.label}
            {tab === t.id && (
              <motion.span
                layoutId="p2p-tab"
                className="absolute inset-x-3 bottom-0 h-0.5 rounded-full"
                style={{ background: 'var(--accent-bg)', boxShadow: '0 0 12px var(--accent-glow)' }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <AppLink
            to="/swap"
            className="flex min-h-11 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-semibold"
            style={{ color: 'var(--subtle)' }}
          >
            <Repeat className="size-3.5" /> Swap
          </AppLink>
          <AppLink
            to="/bridge"
            className="flex min-h-11 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-semibold"
            style={{ color: 'var(--subtle)' }}
          >
            <Waypoints className="size-3.5" /> Bridge
          </AppLink>
          <AppLink
            to="/assistant"
            className="flex min-h-11 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-semibold"
            style={{ color: 'var(--subtle)' }}
          >
            <Sparkles className="size-3.5" /> Assistant
          </AppLink>
        </div>
      </nav>
      <div className="h-px" style={{ background: 'var(--border)' }} />
    </header>
  )
}
