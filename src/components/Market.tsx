import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount } from 'wagmi'
import { useAds, useAccounts, type AdWithId } from '@/hooks/useEscrow'
import {
  COUNTRIES,
  SIDE_BUY,
  SIDE_SELL,
  fiatFor,
  formatPrice,
  hexToCurrency,
  methodsForCountry,
  sameAddr,
} from '@/lib/p2p'
import { parseUnitsExact } from '@/onchain-money'
import { Chip, Empty, SkeletonRows, inputClass } from '@/components/ui'
import { CountryFlag, MethodLabel } from '@/components/logos'
import { AdCard } from '@/components/AdCard'
import { MarketHero, type MarketStats } from '@/components/MarketHero'

export function Market({
  onTrade,
  onPostAd,
}: {
  onTrade: (ad: AdWithId) => void
  onPostAd: () => void
}) {
  const { address } = useAccount()
  const { ads, isLoading } = useAds()
  const [mode, setMode] = useState<'buy' | 'sell'>('buy')
  const [countryCode, setCountryCode] = useState('IN')
  const [method, setMethod] = useState<number | null>(null)
  const [amount, setAmount] = useState('')

  const country = COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0]
  const wantedSide = mode === 'buy' ? SIDE_SELL : SIDE_BUY

  const live = useMemo(() => ads.filter((ad) => !ad.paused && !ad.closed && ad.available > 0n), [ads])

  // Best price per country for the current direction, shown on the country cards.
  const bestByCountry = useMemo(() => {
    const map = new Map<string, bigint>()
    for (const ad of live) {
      if (ad.side !== wantedSide) continue
      const cur = hexToCurrency(ad.currency)
      const prev = map.get(cur)
      const better = prev === undefined || (mode === 'buy' ? ad.priceE6 < prev : ad.priceE6 > prev)
      if (better) map.set(cur, ad.priceE6)
    }
    return map
  }, [live, wantedSide, mode])

  const stats = useMemo<MarketStats>(() => {
    const here = live.filter((ad) => hexToCurrency(ad.currency) === country.currency)
    const sells = here.filter((ad) => ad.side === SIDE_SELL)
    const buys = here.filter((ad) => ad.side === SIDE_BUY)
    return {
      bestBuy: sells.length ? sells.reduce((m, a) => (a.priceE6 < m ? a.priceE6 : m), sells[0].priceE6) : null,
      bestSell: buys.length ? buys.reduce((m, a) => (a.priceE6 > m ? a.priceE6 : m), buys[0].priceE6) : null,
      liquidity: sells.reduce((sum, a) => sum + a.available, 0n),
      liveAds: here.length,
    }
  }, [live, country.currency])

  const filtered = useMemo(() => {
    let fiatFilter: bigint | null = null
    try {
      fiatFilter = amount ? parseUnitsExact(amount, 6) : null
    } catch {
      fiatFilter = null
    }
    return live
      .filter((ad) => ad.side === wantedSide && hexToCurrency(ad.currency) === country.currency)
      .filter((ad) => method === null || (ad.paymentMask & (1 << method)) !== 0)
      .filter((ad) => {
        if (fiatFilter === null) return true
        const lo = fiatFor(ad.minAmount > ad.available ? ad.available : ad.minAmount, ad.priceE6)
        const hi = fiatFor(ad.maxAmount > ad.available ? ad.available : ad.maxAmount, ad.priceE6)
        return fiatFilter >= lo && fiatFilter <= hi
      })
      .sort((a, b) => (mode === 'buy' ? Number(a.priceE6 - b.priceE6) : Number(b.priceE6 - a.priceE6)))
  }, [live, wantedSide, country.currency, method, amount, mode])

  const accounts = useAccounts(filtered.map((a) => a.maker))

  return (
    <div className="min-w-0 space-y-5">
      <MarketHero country={country} stats={stats} onPostAd={onPostAd} />

      <section className="glass rounded-3xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Trade direction"
            className="inline-flex rounded-2xl p-1"
            style={{ background: 'var(--fill-2)' }}
          >
            {(['buy', 'sell'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className="relative min-h-11 rounded-xl px-7 text-sm font-bold transition-colors"
                style={{ color: mode === m ? 'var(--on-accent)' : 'var(--muted)' }}
              >
                {mode === m && (
                  <motion.span
                    layoutId="market-mode"
                    className="absolute inset-0 rounded-xl"
                    style={{
                      background: m === 'buy' ? 'var(--success)' : 'var(--danger)',
                      boxShadow: `0 8px 24px -8px ${m === 'buy' ? 'rgba(141,216,159,0.7)' : 'rgba(232,109,122,0.7)'}`,
                    }}
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative">{m === 'buy' ? 'Buy USDC' : 'Sell USDC'}</span>
              </button>
            ))}
          </div>

          <label className="relative block w-full sm:w-64">
            <span className="sr-only">Filter by amount in {country.currency}</span>
            <span
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold"
              style={{ color: 'var(--subtle)' }}
            >
              {country.symbol}
            </span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, '')
                if (/^\d*\.?\d{0,2}$/.test(v)) setAmount(v)
              }}
              placeholder={`I want to trade ${country.currency}...`}
              className={`${inputClass} pl-12`}
            />
          </label>
        </div>

        <div
          className="-mx-1 mt-4 flex snap-x gap-2 overflow-x-auto px-1 pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible"
          role="group"
          aria-label="Country"
        >
          {COUNTRIES.map((c) => {
            const active = c.code === countryCode
            const best = bestByCountry.get(c.currency)
            return (
              <button
                key={c.code}
                onClick={() => {
                  setCountryCode(c.code)
                  setMethod(null)
                }}
                aria-pressed={active}
                className="relative flex min-h-16 min-w-[9.5rem] shrink-0 snap-start items-center gap-3 rounded-2xl px-3.5 text-left transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.98] lg:min-w-0"
                style={{ background: 'var(--fill-1)', border: '1px solid var(--border)' }}
              >
                {active && (
                  <motion.span
                    layoutId="country-ring"
                    className="absolute inset-0 rounded-2xl"
                    style={{
                      border: '1px solid var(--accent)',
                      background: 'var(--fill-3)',
                      boxShadow: '0 0 28px -6px var(--accent-glow)',
                    }}
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative flex items-center gap-3">
                  <CountryFlag code={c.code} size={34} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight">{c.name}</span>
                    <span className="block text-xs tabular-nums" style={{ color: best !== undefined ? 'var(--accent-hover)' : 'var(--subtle)' }}>
                      {best !== undefined ? `${c.symbol} ${formatPrice(best)}` : c.currency}
                    </span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Payment method">
          <Chip active={method === null} onClick={() => setMethod(null)}>
            All methods
          </Chip>
          {methodsForCountry(country.code).map((m) => (
            <Chip key={m.bit} active={method === m.bit} onClick={() => setMethod(m.bit)}>
              <MethodLabel method={m} />
            </Chip>
          ))}
        </div>
      </section>

      {isLoading ? (
        <SkeletonRows />
      ) : filtered.length === 0 ? (
        <Empty
          title={`No ${mode === 'buy' ? 'sell' : 'buy'} ads for ${country.currency} yet`}
          body="Be the first. Post an ad with your price and payment method, and traders in your country can find you."
        />
      ) : (
        <ul className="space-y-4">
          <AnimatePresence mode="popLayout">
            {filtered.map((ad, index) => (
              <AdCard
                key={`${mode}-${country.code}-${ad.id.toString()}`}
                ad={ad}
                country={country}
                mode={mode}
                account={accounts.get(ad.maker.toLowerCase())}
                own={sameAddr(ad.maker, address)}
                index={index}
                onTrade={onTrade}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}
