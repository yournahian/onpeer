import { useAccount } from 'wagmi'
import { motion } from 'framer-motion'
import { ArrowRight, Lock, Send, ShieldCheck, Unlock } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useOrders } from '@/hooks/useEscrow'
import { COUNTRIES, formatUsdcAmount, hexToCurrency, isActiveStatus, sameAddr } from '@/lib/p2p'
import { StatusBadge } from '@/components/ui'
import { CountryFlag } from '@/components/logos'

const STEPS = [
  { icon: Lock, title: 'Seller locks USDC', body: 'Funds sit in escrow, not with either trader.' },
  { icon: Send, title: 'Buyer pays in local fiat', body: 'UPI, bKash, Raast, eSewa and more, outside the app.' },
  { icon: Unlock, title: 'Seller releases', body: 'USDC moves to the buyer. Disputes go to an arbiter.' },
]

const TIPS = [
  'Pay only from an account in your own name.',
  'Tap "I have paid" only after the money has left your account.',
  'Sellers: release only when the full amount is in your account.',
  'Keep every chat and proof inside the order.',
]

export function P2PSidebar({ onOpenOrder }: { onOpenOrder: (id: bigint) => void }) {
  const { address } = useAccount()
  const { orders } = useOrders()
  const mine = orders
    .filter((o) => (sameAddr(o.buyer, address) || sameAddr(o.seller, address)) && isActiveStatus(o.status))
    .slice(0, 4)

  return (
    <aside className="space-y-4" aria-label="Escrow guide">
      {address && (
        <section className="glass rounded-3xl p-5">
          <h2 className="display text-base font-semibold">Your open orders</h2>
          {mine.length === 0 ? (
            <p className="mt-2 text-sm" style={{ color: 'var(--subtle)' }}>
              Nothing in progress. Pick an ad to start a trade.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {mine.map((o, i) => {
                const country = COUNTRIES.find((c) => c.currency === hexToCurrency(o.currency))
                const youBuy = sameAddr(o.buyer, address)
                return (
                  <motion.li
                    key={o.id.toString()}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.35 }}
                  >
                    <button
                      onClick={() => onOpenOrder(o.id)}
                      className="inner group flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-left transition-colors hover:border-[var(--fill-3)]"
                    >
                      {country && <CountryFlag code={country.code} size={28} />}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                          {youBuy ? 'Buy' : 'Sell'} <TokenUSDC variant="branded" size={13} /> {formatUsdcAmount(o.amount)}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                          Order #{o.id.toString()}
                        </span>
                      </span>
                      <StatusBadge status={o.status} />
                      <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  </motion.li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <section className="glass rounded-3xl p-5">
        <h2 className="display text-base font-semibold">How escrow works</h2>
        <ol className="relative mt-4 space-y-5">
          <span
            aria-hidden
            className="absolute left-[17px] top-4 bottom-4 w-px"
            style={{ background: 'linear-gradient(180deg, var(--accent), var(--fill-3))' }}
          />
          {STEPS.map((s, i) => (
            <motion.li
              key={s.title}
              className="relative flex items-start gap-3"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.45 }}
            >
              <span
                className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border-strong)', color: 'var(--accent)' }}
              >
                <s.icon className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">{s.title}</p>
                <p className="text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
                  {s.body}
                </p>
              </div>
            </motion.li>
          ))}
        </ol>
      </section>

      <section className="glass rounded-3xl p-5">
        <h2 className="display flex items-center gap-2 text-base font-semibold">
          <ShieldCheck className="size-4" style={{ color: 'var(--success)' }} /> Stay safe
        </h2>
        <ul className="mt-3 space-y-2 text-sm" style={{ color: 'var(--muted)' }}>
          {TIPS.map((t) => (
            <li key={t} className="flex gap-2 text-pretty">
              <span className="mt-2 size-1 shrink-0 rounded-full" style={{ background: 'var(--accent-bg)' }} />
              {t}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

