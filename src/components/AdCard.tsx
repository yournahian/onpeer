import { motion } from 'framer-motion'
import { BadgeCheck, Clock, ShieldCheck, UserCheck } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import type { Account, AdWithId } from '@/hooks/useEscrow'
import {
  fiatFor,
  formatFiat,
  formatPrice,
  formatUsdcAmount,
  maskToMethods,
  shortAddr,
  type Country,
} from '@/lib/p2p'
import { Avatar, Button } from '@/components/ui'
import { CountryFlag, MethodLogo } from '@/components/logos'

export function AdCard({
  ad,
  country,
  mode,
  account,
  own,
  index,
  onTrade,
}: {
  ad: AdWithId
  country: Country
  mode: 'buy' | 'sell'
  account: Account | undefined
  own: boolean
  index: number
  onTrade: (ad: AdWithId) => void
}) {
  const rate =
    account && account.ordersCreated > 0 ? Math.round((account.ordersCompleted / account.ordersCreated) * 100) : null
  const cap = ad.maxAmount > ad.available ? ad.available : ad.maxAmount
  const floor = ad.minAmount > ad.available ? ad.available : ad.minAmount
  const left = ad.initialAmount > 0n ? Number((ad.available * 1000n) / ad.initialAmount) / 1000 : 0
  const methods = maskToMethods(ad.paymentMask)
  const tone = mode === 'buy' ? 'var(--success)' : 'var(--danger)'

  return (
    <motion.li
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: Math.min(index * 0.05, 0.35), ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3, transition: { type: 'spring', stiffness: 400, damping: 28 } }}
      className="glass relative overflow-hidden rounded-3xl transition-colors hover:border-[var(--accent)]"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${tone}, transparent)`, opacity: 0.7 }}
      />

      <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-center">
        <div className="flex items-center gap-3">
          <Avatar address={ad.maker} size={44} />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
              <span className="mono">{shortAddr(ad.maker)}</span>
              {ad.merchantAd && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                  style={{ background: 'rgba(141,216,159,0.14)', color: 'var(--success)' }}
                  title="Verified merchant: security margin deposited"
                >
                  <BadgeCheck className="size-3" /> Merchant
                </span>
              )}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
              <ShieldCheck className="size-3" />
              {account ? `${account.ordersCompleted} trades` : '...'}
              {rate !== null && ` · ${rate}% completion`}
            </p>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--subtle)' }}>
            Price per USDC
          </p>
          <p className="display mt-0.5 flex items-center gap-2 text-3xl font-bold tabular-nums">
            <CountryFlag code={country.code} size={24} />
            {formatPrice(ad.priceE6)}
            <span className="text-sm font-medium" style={{ color: 'var(--subtle)' }}>
              {country.currency}
            </span>
          </p>
        </div>

        <div className="space-y-2 text-sm tabular-nums">
          <div className="flex items-center justify-between gap-3">
            <span style={{ color: 'var(--subtle)' }}>Available</span>
            <span className="flex items-center gap-1.5 font-semibold">
              <TokenUSDC variant="branded" size={14} />
              {formatUsdcAmount(ad.available)}
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full"
            style={{ background: 'var(--fill-3)' }}
            role="img"
            aria-label={`${Math.round(left * 100)}% of the original inventory is left`}
          >
            <motion.div
              className="h-full origin-left rounded-full"
              style={{ background: `linear-gradient(90deg, ${tone}, var(--accent))` }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: Math.max(0.04, left) }}
              transition={{ duration: 0.9, delay: 0.1 + Math.min(index * 0.05, 0.35), ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span style={{ color: 'var(--subtle)' }}>Limit</span>
            <span>
              {country.symbol} {formatFiat(fiatFor(floor, ad.priceE6), 0)} - {formatFiat(fiatFor(cap, ad.priceE6), 0)}
            </span>
          </div>
        </div>

        {own ? (
          <span
            className="rounded-xl px-4 py-2 text-center text-xs font-semibold"
            style={{ background: 'var(--fill-2)', color: 'var(--subtle)' }}
          >
            Your ad
          </span>
        ) : (
          <Button variant={mode === 'buy' ? 'buy' : 'sell'} onClick={() => onTrade(ad)} className="md:min-w-32">
            {mode === 'buy' ? 'Buy USDC' : 'Sell USDC'}
          </Button>
        )}
      </div>

      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-xs"
        style={{ borderTop: '1px solid var(--border)', background: 'var(--fill-1)' }}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          {methods.slice(0, 5).map((m) => (
            <span
              key={m.bit}
              className="inline-flex items-center gap-1.5 rounded-lg py-0.5 pl-0.5 pr-2 font-medium"
              style={{ background: 'var(--fill-3)', color: 'var(--ink-2)' }}
            >
              <MethodLogo name={m.name} size={20} />
              {m.name}
            </span>
          ))}
          {methods.length > 5 && <span style={{ color: 'var(--subtle)' }}>+{methods.length - 5}</span>}
        </span>
        <span className="ml-auto flex items-center gap-3" style={{ color: 'var(--subtle)' }}>
          <span className="flex items-center gap-1">
            <Clock className="size-3" /> {ad.windowMinutes} min to pay
          </span>
          {ad.minTakerCompleted > 0 && (
            <span className="flex items-center gap-1" style={{ color: 'var(--warn)' }}>
              <UserCheck className="size-3" /> {ad.minTakerCompleted}+ trades required
            </span>
          )}
        </span>
      </div>
    </motion.li>
  )
}
