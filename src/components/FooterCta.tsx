import { motion } from 'framer-motion'
import { ArrowLeftRight, ArrowRight, Play, Repeat, ShieldCheck, Waypoints } from 'lucide-react'
import { COUNTRIES } from '@/lib/p2p'
import { AppLink } from '@/components/AppLink'
import { CountryFlag } from '@/components/logos'
import { Reveal } from '@/components/fx/Reveal'
import { BackgroundSlot } from '@/components/fx/BackgroundSlot'

const PILLS = [
  { to: '/p2p', label: 'P2P market', icon: ArrowLeftRight },
  { to: '/swap', label: 'Swap', icon: Repeat },
  { to: '/bridge', label: 'Bridge', icon: Waypoints },
] as const

const outline = {
  WebkitTextStroke: '12px #0a0712',
  paintOrder: 'stroke fill',
  color: '#ffffff',
} as const

/**
 * The closing scene at the top of the footer: a warm purple alley, comic-style panel cuts,
 * a poster-size headline, the three tools as white pills and an assistant teaser.
 */
export function FooterCta() {
  return (
    <section className="stage relative isolate min-h-[720px] overflow-hidden border-y sm:min-h-[760px]" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
      <BackgroundSlot
        files={['/hero/footer-bg.webp', '/hero/footer-bg.jpg', '/hero/footer-bg.png']}
        title="Footer background"
        size="1920 x 900"
        imgClassName="size-full object-cover object-[30%_35%]"
        overlay={
          <>
            <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(120,30,120,0.45), rgba(40,10,70,0.55))', mixBlendMode: 'multiply' }} />
            <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(8,4,16,0.55), rgba(8,4,16,0.1) 55%, rgba(8,4,16,0.5))' }} />
          </>
        }
      />

      {/* comic-panel cuts */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="absolute inset-y-0 left-[31%] hidden w-5 -skew-x-[4deg] bg-[#0a0712] lg:block" />
        <span className="absolute inset-y-0 left-[68%] hidden w-5 skew-x-[3deg] bg-[#0a0712] lg:block" />
        <span className="absolute left-[69%] right-0 top-[55%] hidden h-5 -rotate-[2deg] bg-[#0a0712] lg:block" />
      </div>

      <div className="relative flex min-h-[720px] w-full flex-col justify-center px-5 py-16 sm:min-h-[760px] sm:px-8 lg:px-12">
        <Reveal className="relative z-20 w-full">
          <h2 className="display text-center font-bold leading-[0.95] lg:text-left" style={{ fontSize: 'clamp(3.4rem, 9.5vw, 8.4rem)', ...outline }}>
            Start trading
            <br />
            USDC today
          </h2>

          <div className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <div
              className="inline-flex h-[52px] items-center gap-3 rounded-full pl-4 pr-5 text-sm"
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.7)' }}
            >
              <span className="flex -space-x-2">
                {COUNTRIES.slice(0, 4).map((c) => (
                  <span key={c.code} className="rounded-full ring-2" style={{ ['--tw-ring-color' as string]: '#1a0b2e' }}>
                    <CountryFlag code={c.code} size={24} />
                  </span>
                ))}
              </span>
              Your currency, your payment app
            </div>
            <AppLink
              to="/p2p"
              className="btn-shine inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-8 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
              style={{ background: '#ff2e93', boxShadow: '0 10px 34px -8px rgba(255,46,147,0.7)' }}
            >
              Open the market <ArrowRight className="size-4" />
            </AppLink>
          </div>

          <div className="mt-6 flex items-center justify-center gap-3 text-xs font-medium lg:justify-start" style={{ color: 'rgba(255,255,255,0.8)' }}>
            Or jump to
            <AppLink to="/swap" aria-label="Swap" className="flex size-8 items-center justify-center rounded-full bg-white text-[#12081f] transition-transform hover:scale-110">
              <Repeat className="size-4" />
            </AppLink>
            <AppLink to="/bridge" aria-label="Bridge" className="flex size-8 items-center justify-center rounded-full bg-white text-[#12081f] transition-transform hover:scale-110">
              <Waypoints className="size-4" />
            </AppLink>
          </div>

          <p className="mt-10 flex items-center justify-center gap-2.5 text-lg font-semibold text-white lg:justify-start">
            <ShieldCheck className="size-6" style={{ color: '#7ef1b3' }} />
            Escrow on Arc
          </p>
        </Reveal>

        {/* white pills, like the reference's feature list */}
        <div className="relative z-20 mt-10 flex flex-wrap justify-center gap-3 lg:absolute lg:bottom-16 lg:right-10 lg:mt-0 lg:flex-col lg:items-stretch">
          {PILLS.map((p, i) => (
            <motion.div key={p.to} initial={{ opacity: 0, x: 24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 + i * 0.1 }}>
              <AppLink to={p.to} className="stage-pill group flex min-w-[176px] items-center gap-3 rounded-xl px-4 py-3 text-xs font-extrabold uppercase tracking-wide transition-transform hover:-translate-y-0.5">
                <p.icon className="size-4" style={{ color: '#12081f' }} /> {p.label}
              </AppLink>
            </motion.div>
          ))}
        </div>

        {/* assistant teaser, like the video card */}
        <Reveal className="absolute right-5 top-6 z-20 hidden w-[330px] sm:right-10 lg:block" delay={0.2}>
          <AppLink to="/assistant" className="glass lift flex items-center gap-4 rounded-2xl p-3 pr-5">
            <span
              className="relative flex size-[76px] shrink-0 items-center justify-center overflow-hidden rounded-xl"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #ec4899)' }}
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-white/90 text-[#7c3aed]">
                <Play className="size-5 translate-x-px fill-current" />
              </span>
            </span>
            <span className="text-sm font-medium leading-snug text-white">
              Be the first to try the AI assistant
              <span className="mt-1 flex items-center gap-1 font-semibold" style={{ color: '#e879f9' }}>
                Meet it <ArrowRight className="size-3.5" />
              </span>
            </span>
          </AppLink>
        </Reveal>
      </div>
    </section>
  )
}
