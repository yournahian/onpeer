import { ArrowRight, Bot } from 'lucide-react'
import { COUNTRIES } from '@/lib/p2p'
import { AppLink } from '@/components/AppLink'
import { CountryFlag } from '@/components/logos'
import { Reveal } from '@/components/fx/Reveal'
import { BackgroundSlot } from '@/components/fx/BackgroundSlot'

/**
 * Closing call-to-action scene at the top of the footer featuring the glowing
 * South Asia corridor map positioned cleanly on the right with top/bottom cut fade.
 */
export function FooterCta() {
  return (
    <section
      className="stage relative isolate min-h-[580px] overflow-hidden border-y bg-[#06070b] sm:min-h-[650px]"
      style={{ borderColor: 'rgba(255, 90, 0, 0.18)' }}
    >
      <BackgroundSlot
        files={['/hero/south-asia-map.jpg?v=3', '/hero/footer-bg.jpg']}
        title="South Asia corridor map"
        size="2752 x 1160"
        imgClassName="size-full object-cover object-[76%_center] lg:object-center"
        overlay={
          /* Top & bottom edge cut/fade into black, just like the first version */
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.74) 0%, rgba(0,0,0,0) 15%, rgba(0,0,0,0) 85%, rgba(0,0,0,0.82) 100%)',
            }}
          />
        }
      />

      <div className="relative z-10 mx-auto flex min-h-[580px] w-full max-w-7xl flex-col justify-center px-5 py-14 sm:min-h-[650px] sm:px-8 sm:py-16 lg:px-12">
        <Reveal className="relative z-20 w-full max-w-xl">
          <h2
            className="display text-center font-bold leading-[0.96] tracking-tight text-white lg:text-left"
            style={{
              fontSize: 'clamp(2.6rem, 6.2vw, 5.4rem)',
              textShadow: '0 10px 36px rgba(0, 0, 0, 0.7)',
            }}
          >
            Start trading
            <br />
            USDC today
          </h2>

          <div className="mt-8 flex flex-col items-stretch gap-3 sm:mt-9 sm:flex-row sm:items-center lg:justify-start">
            <div
              className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-full px-4 py-2 text-xs backdrop-blur-md sm:h-[52px] sm:justify-start sm:gap-3 sm:pl-4 sm:pr-5 sm:text-sm"
              style={{
                background: 'rgba(15, 15, 20, 0.72)',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                color: 'rgba(255, 255, 255, 0.86)',
              }}
            >
              <span className="flex -space-x-2">
                {COUNTRIES.slice(0, 4).map((c) => (
                  <span key={c.code} className="rounded-full ring-2" style={{ ['--tw-ring-color' as string]: '#0b0d17' }}>
                    <CountryFlag code={c.code} size={24} />
                  </span>
                ))}
              </span>
              Your currency, your payment app
            </div>
            <AppLink
              to="/p2p"
              className="btn-shine inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-8 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
              style={{ background: '#FF5A00', boxShadow: '0 10px 34px -8px rgba(255,90,0,0.75)' }}
            >
              Open the market <ArrowRight className="size-4" />
            </AppLink>
          </div>
        </Reveal>

        {/* Mobile-only assistant card */}
        <Reveal className="mt-8 z-20 w-full max-w-[330px] self-center lg:hidden" delay={0.2}>
          <AppLink to="/assistant" className="glass lift flex items-center gap-4 rounded-2xl p-3 pr-5">
            <span
              className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl"
              style={{ background: 'linear-gradient(135deg, #e04e00, #FF5A00)' }}
            >
              <Bot className="size-7 text-white" />
            </span>
            <span className="text-sm font-medium leading-snug text-white">
              Be the first to try the AI assistant
              <span className="mt-1 flex items-center gap-1 font-semibold" style={{ color: '#FF5A00' }}>
                Meet it <ArrowRight className="size-3.5" />
              </span>
            </span>
          </AppLink>
        </Reveal>
      </div>
    </section>
  )
}
