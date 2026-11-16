import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { formatPrice, formatUsdcAmount, type Country } from '@/lib/p2p'
import { RollingNumber } from '@/components/fx/RollingNumber'
import { CountryFlag } from '@/components/logos'
import { Button } from '@/components/ui'

export type MarketStats = {
  bestBuy: bigint | null // lowest price among live sell ads: what a buyer pays
  bestSell: bigint | null // highest price among live buy ads: what a seller receives
  liquidity: bigint
  liveAds: number
}

export function MarketHero({
  country,
  stats,
  onPostAd,
}: {
  country: Country
  stats: MarketStats
  onPostAd: () => void
}) {
  const tiles: { label: string; value: string; sub: string; tone?: string; usdc?: boolean }[] = [
    {
      label: 'Best price to buy',
      value: stats.bestBuy !== null ? formatPrice(stats.bestBuy) : '--',
      sub: `${country.currency} per USDC`,
      tone: 'var(--success)',
    },
    {
      label: 'Best price to sell',
      value: stats.bestSell !== null ? formatPrice(stats.bestSell) : '--',
      sub: `${country.currency} per USDC`,
      tone: 'var(--danger)',
    },
    {
      label: 'USDC for sale',
      value: formatUsdcAmount(stats.liquidity, 0),
      sub: `${stats.liveAds} live ${stats.liveAds === 1 ? 'ad' : 'ads'}`,
      usdc: true,
    },
  ]

  return (
    <section className="glass relative overflow-hidden rounded-[2rem] p-6 sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full"
        style={{ background: 'radial-gradient(circle, var(--accent-glow), transparent 68%)', filter: 'blur(30px)' }}
      />
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        <div className="flex-1">
          <p
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]"
            style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}
          >
            <span className="live-dot" style={{ background: 'var(--success)' }} /> P2P market · Arc Testnet
          </p>
          <motion.h1
            className="display text-gradient mt-3 text-balance text-4xl font-bold sm:text-5xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            Trade USDC with people near you
          </motion.h1>
          <p className="mt-3 text-pretty text-sm" style={{ color: 'var(--muted)' }}>
            Escrow holds the USDC until both sides agree. Pay in your local currency with the apps you already use.
          </p>
        </div>
        <Button onClick={onPostAd} className="glow-accent">
          <Plus className="size-4" /> Post an ad
        </Button>
      </div>

      <div className="relative mt-7 grid gap-3 sm:grid-cols-3">
        {tiles.map((t, i) => (
          <motion.div
            key={t.label}
            className="inner rounded-2xl p-4"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--subtle)' }}>
              {t.label}
            </p>
            <p className="display mt-1.5 flex items-center gap-2 text-3xl font-bold" style={{ color: t.tone }}>
              {t.usdc ? <TokenUSDC variant="branded" size={24} /> : <CountryFlag code={country.code} size={22} />}
              <RollingNumber value={t.value} />
            </p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--subtle)' }}>
              {t.sub}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
