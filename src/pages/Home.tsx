import { useReadContract } from 'wagmi'
import { ArrowLeftRight, ArrowRight, Repeat, Waypoints } from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { CHAIN_ID, COUNTRIES, ESCROW_ADDRESS, PAYMENT_METHODS } from '@/lib/p2p'
import { CountryFlag, MethodLogo } from '@/components/logos'
import { AppLink } from '@/components/AppLink'
import { SiteBar } from '@/components/SiteBar'
import { Reveal } from '@/components/fx/Reveal'
import { RollingNumber } from '@/components/fx/RollingNumber'
import { TiltCard } from '@/components/fx/TiltCard'
import { PlanetHero } from '@/components/home/PlanetHero'
import { HowItWorks } from '@/components/home/HowItWorks'
import { Features } from '@/components/home/Features'
import { Countries } from '@/components/home/Countries'
import { Faq } from '@/components/home/Faq'
import { FinalCta } from '@/components/home/FinalCta'

const PRODUCTS = [
  {
    to: '/p2p',
    icon: ArrowLeftRight,
    title: 'P2P',
    tagline: 'Trade USDC with people near you',
    body: 'Buy or sell USDC for rupees, taka and more. Pay with UPI, bKash, Raast or eSewa while escrow holds the USDC.',
    cta: 'Open P2P market',
  },
  {
    to: '/swap',
    icon: Repeat,
    title: 'Swap',
    tagline: 'Switch between USDC and EURC',
    body: 'Convert stablecoins on Arc in one step. See the quote and the fees before you confirm.',
    cta: 'Open swap',
  },
  {
    to: '/bridge',
    icon: Waypoints,
    title: 'Bridge',
    tagline: 'Move USDC across chains',
    body: 'Send USDC between Arc and Ethereum, Base, Arbitrum, Optimism, Avalanche or Polygon testnets with Circle CCTP.',
    cta: 'Open bridge',
  },
] as const

export default function Home() {
  return (
    <div className="min-h-dvh">
      <SiteBar overlay />
      <PlanetHero />
      <main className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-8 sm:pt-14 lg:px-12">
        <LiveStats />
        <Marquee />

        <section className="mt-24" aria-labelledby="products-title">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>Three tools, one wallet</p>
            <h2 id="products-title" className="display text-gradient mt-2 text-balance text-4xl font-bold sm:text-5xl">
              Trade, swap and bridge without leaving OnPeer
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {PRODUCTS.map((p, i) => (
              <Reveal key={p.to} delay={i * 0.08}>
                <TiltCard className="h-full rounded-3xl">
                  <AppLink to={p.to} className="glass lift group flex h-full flex-col rounded-3xl p-6">
                    <span
                      className="flex size-12 items-center justify-center rounded-2xl transition-transform duration-500 group-hover:rotate-[-6deg] group-hover:scale-110"
                      style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)', boxShadow: '0 10px 30px -8px var(--accent-glow)' }}
                    >
                      <p.icon className="size-6" />
                    </span>
                    <h3 className="display mt-5 text-3xl font-bold">{p.title}</h3>
                    <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                      {p.tagline}
                    </p>
                    <p className="mt-3 flex-1 text-pretty text-sm" style={{ color: 'var(--muted)' }}>
                      {p.body}
                    </p>
                    <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold">
                      {p.cta}
                      <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1.5" />
                    </span>
                  </AppLink>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </section>

        <HowItWorks />
        <Features />
        <Countries />
        <Faq />
        <FinalCta />
      </main>
    </div>
  )
}

function LiveStats() {
  const enabled = !!ESCROW_ADDRESS
  const ads = useReadContract({
    address: ESCROW_ADDRESS,
    abi: p2pEscrowAbi,
    functionName: 'adCount',
    chainId: CHAIN_ID,
    query: { enabled, refetchInterval: 10_000 },
  })
  const orders = useReadContract({
    address: ESCROW_ADDRESS,
    abi: p2pEscrowAbi,
    functionName: 'orderCount',
    chainId: CHAIN_ID,
    query: { enabled, refetchInterval: 10_000 },
  })

  const stats: { label: string; value: string | null; live?: boolean }[] = [
    { label: 'P2P ads posted', value: ads.data !== undefined ? String(ads.data) : null, live: true },
    { label: 'Orders opened', value: orders.data !== undefined ? String(orders.data) : null, live: true },
    { label: 'Local currencies', value: String(COUNTRIES.length) },
    { label: 'Payment methods', value: String(PAYMENT_METHODS.length) },
  ]

  return (
    <Reveal>
      <section className="glass grid grid-cols-2 gap-px overflow-hidden rounded-3xl p-0 sm:grid-cols-4" aria-label="Marketplace stats">
        {stats.map((s) => (
          <div key={s.label} className="px-5 py-5" style={{ background: 'var(--fill-1)' }}>
            <p className="display text-3xl font-bold">
              {s.value === null ? <span className="shimmer inline-block h-8 w-12 rounded-lg bg-[var(--fill-2)] align-middle" /> : <RollingNumber value={s.value} />}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
              {s.live && s.value !== null && (
                <span style={{ color: 'var(--success)' }}>
                  <span className="live-dot" />
                </span>
              )}
              {s.label}
            </p>
          </div>
        ))}
      </section>
    </Reveal>
  )
}

function Marquee() {
  const items = [
    ...COUNTRIES.map((c) => ({ key: c.code, label: `${c.symbol}  ${c.currency}`, flag: c.code, method: null as string | null })),
    ...PAYMENT_METHODS.filter((m) => m.name !== 'Bank transfer').map((m) => ({
      key: m.name,
      label: m.name,
      flag: null as string | null,
      method: m.name,
    })),
  ]
  const row = [...items, ...items]
  return (
    <div
      className="marquee-wrap relative mt-10 overflow-hidden py-2"
      aria-hidden
      style={{
        WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
        maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
      }}
    >
      <div className="marquee gap-3">
        {row.map((t, i) => (
          <span
            key={i}
            className="mr-3 inline-flex shrink-0 items-center gap-2.5 rounded-full py-1.5 pl-2 pr-4 text-sm font-semibold"
            style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
          >
            {t.flag ? <CountryFlag code={t.flag} size={24} /> : t.method ? <MethodLogo name={t.method} size={24} /> : null}
            {t.label}
          </span>
        ))}
      </div>
    </div>
  )
}
