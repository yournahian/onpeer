import { Gavel, Lock, PauseOctagon, ShieldCheck, TimerReset, UserCheck } from 'lucide-react'
import { Reveal } from '@/components/fx/Reveal'
import { SpotlightCard } from '@/components/fx/SpotlightCard'

const FEATURES = [
  { icon: Lock, title: 'Escrow on every order', body: 'The seller’s USDC is locked in a smart contract the moment an order opens. Nobody can run off with it.' },
  { icon: Gavel, title: 'Arbiter and evidence', body: 'If a payment goes wrong, either side opens a dispute. Order messages become the evidence the arbiter reviews.' },
  { icon: ShieldCheck, title: 'Merchant margin', body: 'Traders can post a security deposit. Lose a dispute and part of it goes to the person who was wronged.' },
  { icon: TimerReset, title: 'Cancel cooldowns', body: 'Three cancelled or unpaid orders in a day trigger a 24 hour cooldown, so time-wasters cannot clog the market.' },
  { icon: UserCheck, title: 'Trader requirements', body: 'Ads can require a minimum number of completed trades, and brand-new accounts have lower order limits.' },
  { icon: PauseOctagon, title: 'Emergency pause', body: 'New ads and orders can be paused instantly, while releases, disputes and withdrawals keep working.' },
] as const

export function Features() {
  return (
    <section className="mt-24" aria-labelledby="safe-title">
      <Reveal>
        <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>Why OnPeer</p>
        <h2 id="safe-title" className="display text-gradient mt-2 text-balance text-4xl font-bold sm:text-5xl">
          Built so both sides can trade with a stranger
        </h2>
        <p className="mt-3 text-pretty text-sm sm:text-base" style={{ color: 'var(--muted)' }}>
          The same protections people expect from the biggest P2P markets, enforced by a contract instead of a company.
        </p>
      </Reveal>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <li key={f.title}>
            <Reveal delay={(i % 3) * 0.08} className="h-full">
              <SpotlightCard className="glass lift group h-full rounded-3xl p-6">
                <span
                  className="flex size-11 items-center justify-center rounded-2xl transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[-6deg]"
                  style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}
                >
                  <f.icon className="size-5" />
                </span>
                <h3 className="display mt-4 text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-pretty text-sm" style={{ color: 'var(--muted)' }}>{f.body}</p>
              </SpotlightCard>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  )
}
