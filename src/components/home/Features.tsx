import { Gavel, Lock, PauseOctagon, ShieldCheck, TimerReset, UserCheck } from 'lucide-react'
import { Reveal } from '@/components/fx/Reveal'
import { SpotlightCard } from '@/components/fx/SpotlightCard'

const FEATURES = [
  {
    icon: Lock,
    title: 'Escrow on every order',
    body: 'The seller’s USDC is locked in a smart contract the moment an order opens. Nobody can run off with it.',
    span: 'lg:row-span-2',
    layout: 'tall' as const,
  },
  {
    icon: Gavel,
    title: 'Arbiter and evidence',
    body: 'If a payment goes wrong, either side opens a dispute. Order messages become the evidence the arbiter reviews.',
    span: 'lg:col-span-2',
    layout: 'wide' as const,
  },
  {
    icon: ShieldCheck,
    title: 'Merchant margin',
    body: 'Traders can post a security deposit. Lose a dispute and part of it goes to the person who was wronged.',
    span: '',
    layout: 'compact' as const,
  },
  {
    icon: TimerReset,
    title: 'Cancel cooldowns',
    body: 'Three cancelled or unpaid orders in a day trigger a 24 hour cooldown, so time-wasters cannot clog the market.',
    span: '',
    layout: 'compact' as const,
  },
  {
    icon: UserCheck,
    title: 'Trader requirements',
    body: 'Ads can require a minimum number of completed trades, and brand-new accounts have lower order limits.',
    span: 'lg:col-span-2',
    layout: 'wide' as const,
  },
  {
    icon: PauseOctagon,
    title: 'Emergency pause',
    body: 'New ads and orders can be paused instantly, while releases, disputes and withdrawals keep working.',
    span: '',
    layout: 'stacked' as const,
  },
] as const

function BentoIcon({ Icon, large = false }: { Icon: typeof Lock; large?: boolean }) {
  return (
    <div
      aria-hidden
      className={`relative flex shrink-0 items-center justify-center rounded-3xl transition-transform duration-500 group-hover:scale-105 group-hover:rotate-[-4deg] ${
        large ? 'size-28 sm:size-36' : 'size-20 sm:size-24'
      }`}
      style={{
        background: 'radial-gradient(circle at 30% 25%, rgba(255, 90, 0, 0.24), var(--fill-2) 72%)',
        border: '1px solid var(--border)',
        boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.14), 0 18px 40px -16px rgba(0, 0, 0, 0.55)',
        color: 'var(--accent)',
      }}
    >
      <Icon className={large ? 'size-12 sm:size-16' : 'size-9 sm:size-11'} strokeWidth={1.75} />
    </div>
  )
}

export function Features() {
  return (
    <section className="mt-16 lg:mt-14" aria-labelledby="safe-title">
      <Reveal>
        <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
          Why OnPeer
        </p>
        <h2 id="safe-title" className="display mt-2 max-w-3xl text-balance text-4xl font-bold sm:text-5xl" style={{ color: 'var(--accent)' }}>
          Built so both sides can trade with a stranger
        </h2>
        <p className="mt-3 max-w-2xl text-pretty text-sm sm:text-base" style={{ color: 'var(--muted)' }}>
          The same protections people expect from the biggest P2P markets, enforced by a contract instead of a company.
        </p>
      </Reveal>

      <ul className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:auto-rows-[minmax(210px,auto)]">
        {FEATURES.map((f, i) => (
          <li key={f.title} className={f.span}>
            <Reveal delay={(i % 3) * 0.06} className="h-full">
              <SpotlightCard className="glass lift group relative flex h-full overflow-hidden rounded-3xl p-6 sm:p-7">
                {f.layout === 'tall' ? (
                  <div className="flex h-full w-full flex-col justify-between gap-8">
                    <div className="flex justify-start">
                      <BentoIcon Icon={f.icon} large />
                    </div>
                    <div>
                      <h3 className="display text-2xl font-bold sm:text-3xl">{f.title}</h3>
                      <p className="mt-2.5 text-pretty text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                        {f.body}
                      </p>
                    </div>
                  </div>
                ) : f.layout === 'wide' ? (
                  <div className="flex h-full w-full flex-col justify-between gap-6 sm:flex-row sm:items-center">
                    <div className="max-w-md">
                      <h3 className="display text-xl font-bold sm:text-2xl">{f.title}</h3>
                      <p className="mt-2 text-pretty text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                        {f.body}
                      </p>
                    </div>
                    <div className="flex justify-end sm:shrink-0">
                      <BentoIcon Icon={f.icon} large />
                    </div>
                  </div>
                ) : f.layout === 'stacked' ? (
                  <div className="flex h-full w-full flex-col justify-between gap-5">
                    <div>
                      <h3 className="display text-lg font-bold sm:text-xl">{f.title}</h3>
                      <p className="mt-2 text-pretty text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                        {f.body}
                      </p>
                    </div>
                    <div className="flex justify-end">
                      <BentoIcon Icon={f.icon} />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="display text-lg font-bold sm:text-xl">{f.title}</h3>
                      <p className="mt-2 text-pretty text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                        {f.body}
                      </p>
                    </div>
                    <BentoIcon Icon={f.icon} />
                  </div>
                )}
              </SpotlightCard>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  )
}
