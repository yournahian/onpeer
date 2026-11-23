import { BadgeCheck, Clock, Lock, ShieldCheck, ThumbsUp } from 'lucide-react'
import type { Account, AdWithId, KycInfo } from '@/hooks/useEscrow'
import {
  fiatFor,
  formatFiat,
  formatOrderCap,
  formatPrice,
  formatUsdcAmount,
  isUncapped,
  maskToMethods,
  type Country,
} from '@/lib/p2p'
import { traderInitial, traderLabel, type PublicTraderSummary } from '@/hooks/useSocial'

export function AdCard({
  ad,
  country,
  mode,
  account,
  makerKyc,
  makerProfile,
  viewerAccount,
  own,
  onSelectAd,
  onOpenTrader,
}: {
  ad: AdWithId
  country: Country
  mode: 'buy' | 'sell'
  account: Account | undefined
  makerKyc?: KycInfo
  makerProfile?: PublicTraderSummary
  viewerAccount?: Account
  own: boolean
  onSelectAd: (ad: AdWithId) => void
  onOpenTrader?: (wallet: string) => void
}) {
  const completionPct =
    account && account.ordersCreated > 0
      ? ((account.ordersCompleted / account.ordersCreated) * 100).toFixed(2)
      : '100.00'
  const positivePct =
    makerProfile && makerProfile.positivePct !== null ? makerProfile.positivePct.toFixed(2) : '100.00'
  const displayName = traderLabel(ad.maker, makerProfile)
  const initial = traderInitial(ad.maker, makerProfile)

  const cap = ad.maxAmount > ad.available ? ad.available : ad.maxAmount
  const floor = ad.minAmount > ad.available ? ad.available : ad.minAmount
  const methods = maskToMethods(ad.paymentMask)
  const kycVerified = makerKyc?.verified || makerProfile?.kycApproved === true

  const unmetRequirement =
    viewerAccount !== undefined && ad.minTakerCompleted > 0 && viewerAccount.ordersCompleted < ad.minTakerCompleted

  const viewerCapped =
    viewerAccount !== undefined && !isUncapped(viewerAccount.orderCap) && viewerAccount.orderCap < cap

  return (
    <>
      {/* =====================================================================
          MOBILE OFFER ROW (< 768px — SS 1 Clean Flat Divider Pattern)
         ===================================================================== */}
      <li className="border-b border-[var(--p2p-border)] bg-[var(--p2p-canvas)] px-4 py-4 last:border-b-0 md:hidden">
        {/* Row 1: Clickable Avatar + Online Dot + Display Alias + Badges */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpenTrader?.(ad.maker)}
            className="group flex min-w-0 items-center gap-2 text-left"
          >
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--p2p-tint)] text-xs font-extrabold text-[#FF5A00] ring-1 ring-[var(--p2p-border-active)]">
              {initial}
              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--p2p-canvas)] bg-emerald-400" />
            </span>
            <span className="truncate text-sm font-bold text-[var(--p2p-ink)] group-hover:text-[#FF5A00]">
              {displayName}
            </span>
            {ad.merchantAd && (
              <span title="Verified Merchant">
                <ShieldCheck className="size-4 shrink-0 text-[#FF5A00]" />
              </span>
            )}
            {kycVerified && (
              <span title="KYC Verified">
                <BadgeCheck className="size-4 shrink-0 text-emerald-400" />
              </span>
            )}
          </button>
        </div>

        {/* Row 2: Trades (Completion %) | ThumbsUp Feedback % */}
        <div className="p2p-mono mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[var(--p2p-muted)]">
          <span>
            Trade: {account ? `${account.ordersCompleted} Trades` : '0 Trades'} ({completionPct}%)
          </span>
          <span className="opacity-40">|</span>
          <span className="inline-flex items-center gap-1">
            <ThumbsUp className="size-3 text-[var(--p2p-muted)]" /> {positivePct}%
          </span>
        </div>

        {/* Row 3: Price + Right Payment Stack & CTA */}
        <div className="mt-2.5 flex items-end justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="p2p-mono flex items-baseline gap-1">
              <span className="text-xs font-semibold text-[var(--p2p-muted)]">{country.symbol}</span>
              <span className="text-2xl font-extrabold leading-none text-[var(--p2p-ink)]">
                {formatPrice(ad.priceE6)}
              </span>
              <span className="text-[11px] text-[var(--p2p-muted)]">/{ad.asset}</span>
            </p>

            <p className="truncate pt-1 text-xs text-[var(--p2p-muted)]">
              Limit{' '}
              <span className="p2p-mono text-[var(--p2p-ink)]">
                {formatFiat(fiatFor(floor, ad.priceE6, ad.asset), 0)} - {formatFiat(fiatFor(cap, ad.priceE6, ad.asset), 0)}{' '}
                {country.currency}
              </span>
            </p>
            <p className="truncate text-xs text-[var(--p2p-muted)]">
              Available{' '}
              <span className="p2p-mono font-semibold text-[var(--p2p-ink)]">
                {formatUsdcAmount(ad.available, undefined, ad.asset)} {ad.asset}
              </span>
            </p>

            {(ad.minTakerCompleted > 0 || viewerCapped) && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {ad.minTakerCompleted > 0 && (
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--p2p-muted)]">
                    Requires {ad.minTakerCompleted}+ trades
                  </span>
                )}
                {viewerCapped && viewerAccount && (
                  <span className="p2p-mono inline-block rounded bg-[var(--p2p-tint)] px-1.5 py-0.5 text-[10px] font-semibold text-[#FF5A00]">
                    Cap: {formatOrderCap(viewerAccount.orderCap, ad.asset)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Payment Methods + Window + Action Button */}
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex flex-col items-end gap-1">
              {methods.slice(0, 3).map((m) => (
                <span
                  key={m.bit}
                  className="inline-flex items-center pr-2 text-[11px] font-medium text-[var(--p2p-ink)]"
                  style={{ borderRight: '2.5px solid #FF5A00' }}
                >
                  {m.name}
                </span>
              ))}
              {methods.length > 3 && (
                <span className="text-[10px] text-[var(--p2p-muted)]">+{methods.length - 3} more</span>
              )}
            </div>

            <span className="p2p-mono inline-flex items-center gap-1 text-[11px] text-[var(--p2p-muted)]">
              <Clock className="size-3" /> {ad.windowMinutes} min
            </span>

            <div className="pt-1">
              {own ? (
                <span className="inline-flex h-9 min-w-[92px] items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-semibold text-[var(--p2p-muted)]">
                  Your Ad
                </span>
              ) : unmetRequirement ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex h-9 min-w-[92px] items-center justify-center gap-1 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-[11px] font-semibold text-[var(--p2p-muted)]"
                >
                  <Lock className="size-3 text-[#FF5A00]" /> {ad.minTakerCompleted}+
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectAd(ad)}
                  className="inline-flex h-9 min-w-[92px] items-center justify-center rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-white transition-transform hover:opacity-90 active:scale-95"
                >
                  {mode === 'buy' ? 'Buy' : 'Sell'}
                </button>
              )}
            </div>
          </div>
        </div>
      </li>

      {/* =====================================================================
          DESKTOP 5-COLUMN ROW (>= 768px — SS 12 Pattern)
         ===================================================================== */}
      <li className="hidden border-b border-[var(--p2p-border)] bg-[var(--p2p-canvas)] transition-colors last:border-b-0 hover:bg-[var(--p2p-row-hover)] md:block">
        <div className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_150px] md:items-center">
          {/* Column 1: Advertiser */}
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => onOpenTrader?.(ad.maker)}
              className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--p2p-tint)] text-xs font-extrabold text-[#FF5A00] ring-1 ring-[var(--p2p-border-active)] transition-transform hover:scale-105"
            >
              {initial}
              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--p2p-canvas)] bg-emerald-400" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenTrader?.(ad.maker)}
                  className="truncate text-sm font-bold text-[var(--p2p-ink)] hover:text-[#FF5A00] hover:underline"
                >
                  {displayName}
                </button>
                {ad.merchantAd && (
                  <span
                    title="Verified Merchant (100+ USDC margin staked)"
                    className="inline-flex items-center gap-0.5 rounded bg-[var(--p2p-tint)] px-1.5 py-0.5 text-[10px] font-bold text-[#FF5A00]"
                  >
                    <ShieldCheck className="size-3" /> Merchant
                  </span>
                )}
                {kycVerified && (
                  <span
                    title="KYC Verified Advertiser"
                    className="inline-flex items-center gap-0.5 rounded border border-[var(--p2p-ok-border)] bg-[var(--p2p-ok-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--p2p-ok-ink)]"
                  >
                    <BadgeCheck className="size-3" /> Verified
                  </span>
                )}
              </div>
              <div className="p2p-mono mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--p2p-muted)]">
                <span>{account ? `${account.ordersCompleted} orders` : '0 orders'}</span>
                <span className="opacity-40">|</span>
                <span>{completionPct}% completion</span>
              </div>
              <div className="p2p-mono mt-1 flex flex-wrap items-center gap-x-2.5 text-[11px] text-[var(--p2p-muted)]">
                <span className="inline-flex items-center gap-1">
                  <ThumbsUp className="size-3 text-emerald-400" /> {positivePct}%
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3 text-[#FF5A00]" /> {ad.windowMinutes} min
                </span>
              </div>
            </div>
          </div>

          {/* Column 2: Price */}
          <div>
            <p className="p2p-mono flex items-baseline gap-1.5">
              <span className="text-[1.3rem] font-extrabold leading-tight text-[var(--p2p-ink)]">
                {formatPrice(ad.priceE6)}
              </span>
              <span className="text-xs font-semibold text-[var(--p2p-ink)]">{country.currency}</span>
            </p>
          </div>

          {/* Column 3: Available & Order Limits */}
          <div className="space-y-1 text-xs">
            <p className="p2p-mono font-bold text-[var(--p2p-ink)]">
              {formatUsdcAmount(ad.available, undefined, ad.asset)} {ad.asset}
            </p>
            <p className="p2p-mono text-[var(--p2p-muted)]">
              {country.symbol}
              {formatFiat(fiatFor(floor, ad.priceE6, ad.asset), 0)} - {country.symbol}
              {formatFiat(fiatFor(cap, ad.priceE6, ad.asset), 0)}
            </p>
            {viewerCapped && viewerAccount && (
              <span className="p2p-mono inline-block rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-1.5 py-0.5 text-[10px] font-medium text-[#FF5A00]">
                Tier cap: {formatOrderCap(viewerAccount.orderCap, ad.asset)}
              </span>
            )}
          </div>

          {/* Column 4: Payment Methods */}
          <div className="flex flex-col items-start gap-1">
            {methods.map((m) => (
              <span
                key={m.bit}
                className="inline-flex items-center pl-2 text-xs font-medium text-[var(--p2p-ink)]"
                style={{ borderLeft: '2.5px solid #FF5A00' }}
              >
                {m.name}
              </span>
            ))}
          </div>

          {/* Column 5: Action CTA */}
          <div className="flex flex-col items-end gap-1">
            {own ? (
              <span className="inline-flex min-h-10 min-w-[126px] items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-semibold text-[var(--p2p-muted)]">
                Your Ad
              </span>
            ) : unmetRequirement ? (
              <button
                type="button"
                disabled
                title={`Advertiser requires ${ad.minTakerCompleted}+ completed trades`}
                className="inline-flex min-h-10 min-w-[126px] cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-[11px] font-semibold text-[var(--p2p-muted)]"
              >
                <Lock className="size-3.5 shrink-0 text-[#FF5A00]" />
                <span>Requires {ad.minTakerCompleted}+</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSelectAd(ad)}
                className="inline-flex min-h-10 min-w-[126px] items-center justify-center rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white transition-opacity hover:opacity-90"
              >
                {mode === 'buy' ? `Buy ${ad.asset}` : `Sell ${ad.asset}`}
              </button>
            )}
          </div>
        </div>
      </li>
    </>
  )
}
