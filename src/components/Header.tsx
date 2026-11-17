import { useAccount, useSwitchChain } from 'wagmi'
import { motion } from 'framer-motion'
import { TokenUSDC } from '@web3icons/react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { CHAIN_ID, ESCROW_ADDRESS, formatUsdcAmount } from '@/lib/p2p'
import { useClaimable, useUsdcBalance } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { Button } from '@/components/ui'
import { RollingNumber } from '@/components/fx/RollingNumber'

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
    <div style={{ background: 'var(--bar-bg)', backdropFilter: 'blur(20px)' }}>
      <nav
        className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 sm:px-8 lg:px-12"
        aria-label="P2P sections"
      >
        <div className="flex gap-1 overflow-x-auto">
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
        </div>

        {(isConnected && (balance !== undefined || claimable > 0n || chainId !== CHAIN_ID)) && (
          <div className="flex items-center gap-2 py-1.5">
            {balance !== undefined && (
              <span className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums sm:text-sm">
                <TokenUSDC variant="branded" size={16} />
                <RollingNumber value={formatUsdcAmount(balance)} />
              </span>
            )}
            {claimable > 0n && (
              <Button
                variant="buy"
                className="min-h-9 text-xs sm:text-sm"
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
            {chainId !== CHAIN_ID && (
              <Button variant="danger" className="min-h-9 text-xs sm:text-sm" loading={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
                Switch to Arc Testnet
              </Button>
            )}
          </div>
        )}
      </nav>
      <div className="h-px" style={{ background: 'var(--border)' }} />
    </div>
  )
}
