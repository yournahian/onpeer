import { Clock, Lock, ShieldCheck } from 'lucide-react'
import type { Account, AdWithId, KycInfo } from '@/hooks/useEscrow'
import {
  fiatFor,
  formatFiat,
  formatOrderCap,
  formatPrice,
  formatUsdcAmount,
  isUncapped,
  maskToMethods,
  shortAddr,
  type Country,
} from '@/lib/p2p'

export function AdCard({
  ad,
  country,
  mode,
  account,
  makerKyc,
  viewerAccount,
  own,
  onSelectAd,
}: {
  ad: AdWithId
  country: Country
  mode: 'buy' | 'sell'
  account: Account | undefined
  makerKyc?: KycInfo
  viewerAccount?: Account
  own: boolean
  onSelectAd: (ad: AdWithId) => void
}) {
  const completionPct =
    account && account.ordersCreated > 0
      ? ((account.ordersCompleted / account.ordersCreated) * 100).toFixed(1)
      : null
  const cap = ad.maxAmount > ad.available ? ad.available : ad.maxAmount
  const floor = ad.minAmount > ad.available ? ad.available : ad.minAmount
  const methods = maskToMethods(ad.paymentMask)

  const unmetRequirement =
    viewerAccount !== undefined && ad.minTakerCompleted > 0 && viewerAccount.ordersCompleted < ad.minTakerCompleted

  const viewerCapped =
    viewerAccount !== undefined && !isUncapped(viewerAccount.orderCap) && viewerAccount.orderCap < cap

  return (
    <>
      {/* MOBILE OFFER CARD (< 768px — Binance Mobile App Pattern) */}
      <li className="p2p-card rounded-[12px] p-4 md:hidden">
        {/* Card Top Row: Advertiser + Shield on left | Trades & Completion % on right */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="p2p-mono flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] text-[10px] font-bold text-[#FF5A00]">
              {ad.maker.slice(2, 4).toUpperCase()}
            </span>
            <span className="p2p-mono truncate text-xs font-bold text-[var(--p2p-ink)]">{shortAddr(ad.maker)}</span>
            {makerKyc?.verified ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-[var(--p2p-ok-border)] bg-[var(--p2p-ok-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--p2p-ok-ink)]">
                <ShieldCheck className="size-3" /> KYC
              </span>
            ) : makerKyc ? (
              <span className="inline-flex shrink-0 items-center rounded border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--p2p-warn-ink)]">
                Unverified
              </span>
            ) : null}
            {ad.merchantAd && <ShieldCheck className="size-3.5 shrink-0 text-[#FF5A00]" />}
          </div>
          <span className="p2p-mono shrink-0 text-[0.75rem] text-[var(--p2p-muted)]">
            {account ? `${account.ordersCompleted} trades` : '...'}
            {completionPct !== null && ` | ${completionPct}%`}
          </span>
        </div>

        {/* Card Middle Row: Hero Price */}
        <div className="mt-2.5">
          <span className="block text-[11px] text-[var(--p2p-muted)]">Price</span>
          <p className="p2p-mono mt-0.5 flex items-baseline gap-1.5">
            <span className="text-[1.35rem] font-bold leading-tight text-[var(--p2p-ink)]">
              {formatPrice(ad.priceE6)}
            </span>
            <span className="text-xs font-bold text-[var(--p2p-ink)]">{country.currency}</span>
          </p>
        </div>

        {/* Card Bottom Row: Left stacked details + tags | Bottom-Right Buy/Sell Pill */}
        <div className="mt-2.5 flex items-end justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1 text-xs">
            <p className="truncate text-[var(--p2p-muted)]">
              Crypto: <span className="p2p-mono font-semibold text-[var(--p2p-ink)]">{formatUsdcAmount(ad.available)} USDC</span>
            </p>
            <p className="truncate text-[var(--p2p-muted)]">
              Limit:{' '}
              <span className="p2p-mono text-[var(--p2p-ink)]">
                {country.symbol}
                {formatFiat(fiatFor(floor, ad.priceE6), 0)} - {country.symbol}
                {formatFiat(fiatFor(cap, ad.priceE6), 0)}
              </span>
            </p>
            {viewerCapped && viewerAccount && (
              <span className="p2p-mono inline-block rounded bg-[var(--p2p-tint)] px-1.5 py-0.5 text-[10px] font-semibold text-[#FF5A00]">
                Cap: {formatOrderCap(viewerAccount.orderCap)}
              </span>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {methods.map((m) => (
                <span
                  key={m.bit}
                  className="inline-flex items-center pl-1.5 text-[11px] font-medium text-[var(--p2p-ink)]"
                  style={{ borderLeft: '2px solid #FF5A00' }}
                >
                  {m.name}
                </span>
              ))}
            </div>
          </div>

          <div className="shrink-0">
            {own ? (
              <span className="inline-flex h-[38px] items-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-semibold text-[var(--p2p-muted)]">
                Your Ad
              </span>
            ) : unmetRequirement ? (
              <button
                type="button"
                disabled
                className="inline-flex h-[38px] items-center gap-1 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-[11px] font-semibold text-[var(--p2p-muted)]"
              >
                <Lock className="size-3 text-[#FF5A00]" /> {ad.minTakerCompleted}+
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSelectAd(ad)}
                className="inline-flex h-[38px] items-center justify-center rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] active:scale-95"
              >
                {mode === 'buy' ? 'Buy' : 'Sell'}
              </button>
            )}
          </div>
        </div>
      </li>

      {/* DESKTOP 5-COLUMN ROW (>= 768px) */}
      <li className="hidden border-b border-[var(--p2p-border)] bg-[var(--p2p-canvas)] transition-colors last:border-b-0 hover:bg-[var(--p2p-row-hover)] md:block">
        <div className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.45fr)_minmax(0,1.05fr)_minmax(0,1.35fr)_minmax(0,1.15fr)_150px] md:items-center">
          {/* Column 1: Advertiser */}
          <div className="flex items-start gap-3">
            <span className="p2p-mono flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] text-xs font-bold text-[#FF5A00]">
              {ad.maker.slice(2, 4).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="p2p-mono text-sm font-semibold text-[var(--p2p-ink)]">{shortAddr(ad.maker)}</span>
                {makerKyc?.verified ? (
                  <span
                    title="KYC Verified Advertiser"
                    className="inline-flex items-center gap-1 rounded border border-[var(--p2p-ok-border)] bg-[var(--p2p-ok-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--p2p-ok-ink)]"
                  >
                    <ShieldCheck className="size-3" /> KYC Verified
                  </span>
                ) : makerKyc ? (
                  <span
                    title="This advertiser has not completed KYC verification"
                    className="inline-flex items-center rounded border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--p2p-warn-ink)]"
                  >
                    Unverified
                  </span>
                ) : null}
                {ad.merchantAd && (
                  <span
                    title="Verified Merchant (100+ USDC margin staked)"
                    className="inline-flex items-center gap-1 rounded bg-[var(--p2p-tint)] px-1.5 py-0.5 text-[10px] font-bold text-[#FF5A00]"
                  >
                    <ShieldCheck className="size-3" /> Merchant
                  </span>
                )}
              </div>
              <div className="p2p-mono mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--p2p-muted)]">
                <span>{account ? `${account.ordersCompleted} orders` : '...'}</span>
                {completionPct !== null && (
                  <>
                    <span>|</span>
                    <span>{completionPct}% completion</span>
                  </>
                )}
              </div>
              <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--p2p-muted)]">
                <Clock className="size-3 text-[#FF5A00]" />
                <span className="p2p-mono">~ {ad.windowMinutes} mins window</span>
              </div>
            </div>
          </div>

          {/* Column 2: Price */}
          <div>
            <p className="p2p-mono flex items-baseline gap-1.5">
              <span className="text-[1.25rem] font-bold leading-tight text-[var(--p2p-ink)]">
                {formatPrice(ad.priceE6)}
              </span>
              <span className="text-xs font-semibold text-[var(--p2p-ink)]">{country.currency}</span>
              <span className="text-xs text-[var(--p2p-muted)]">/ USDC</span>
            </p>
          </div>

          {/* Column 3: Available & Order Limits */}
          <div className="space-y-1 text-xs">
            <div className="flex items-baseline gap-2">
              <span className="w-16 shrink-0 text-[var(--p2p-muted)]">Available</span>
              <span className="p2p-mono font-semibold text-[var(--p2p-ink)]">{formatUsdcAmount(ad.available)} USDC</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="w-16 shrink-0 text-[var(--p2p-muted)]">Limit</span>
              <span className="p2p-mono text-[var(--p2p-ink)]">
                {country.symbol}
                {formatFiat(fiatFor(floor, ad.priceE6))} - {country.symbol}
                {formatFiat(fiatFor(cap, ad.priceE6))}
              </span>
            </div>
            {viewerCapped && viewerAccount && (
              <span
                title="Your current account tier limits individual order size"
                className="p2p-mono inline-block rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-1.5 py-0.5 text-[10px] font-medium text-[#FF5A00]"
              >
                Tier cap: {formatOrderCap(viewerAccount.orderCap)}
              </span>
            )}
          </div>

          {/* Column 4: Payment Methods */}
          <div className="flex flex-wrap gap-1.5">
            {methods.map((m) => (
              <span
                key={m.bit}
                className="inline-flex items-center rounded bg-[var(--p2p-input-bg)] px-2 py-1 text-xs font-medium text-[var(--p2p-ink)] ring-1 ring-inset ring-[var(--p2p-border)]"
                style={{ borderLeft: '3px solid #FF5A00' }}
              >
                {m.name}
              </span>
            ))}
          </div>

          {/* Column 5: Action CTA */}
          <div className="flex justify-end">
            {own ? (
              <span className="inline-flex min-h-10 min-w-[136px] items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-semibold text-[var(--p2p-muted)]">
                Your Ad
              </span>
            ) : unmetRequirement ? (
              <button
                type="button"
                disabled
                title={`Advertiser requires ${ad.minTakerCompleted}+ completed trades`}
                className="inline-flex min-h-10 min-w-[136px] cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-[11px] font-semibold text-[var(--p2p-muted)]"
              >
                <Lock className="size-3.5 shrink-0 text-[#FF5A00]" />
                <span>Requires {ad.minTakerCompleted}+</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSelectAd(ad)}
                className="inline-flex min-h-10 min-w-[136px] items-center justify-center rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] transition-opacity hover:opacity-90"
              >
                {mode === 'buy' ? 'Buy USDC' : 'Sell USDC'}
              </button>
            )}
          </div>
        </div>
      </li>
    </>
  )
}
