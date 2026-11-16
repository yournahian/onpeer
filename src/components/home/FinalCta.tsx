import { ArrowRight } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { AppLink } from '@/components/AppLink'
import { Reveal } from '@/components/fx/Reveal'

/** Closing call to action with a slowly turning gradient edge. */
export function FinalCta() {
  return (
    <Reveal className="mt-24" y={30}>
      <section className="cta-edge relative overflow-hidden rounded-[2rem] p-px">
        <div className="relative overflow-hidden rounded-[calc(2rem-1px)] px-6 py-14 text-center sm:px-12 sm:py-20" style={{ background: 'var(--panel-solid)' }}>
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 80% at 50% 0%, var(--accent-glow), transparent 70%)' }} />
          <span className="relative mx-auto flex size-14 items-center justify-center rounded-2xl" style={{ background: 'var(--fill-3)' }}>
            <TokenUSDC variant="branded" size={30} />
          </span>
          <h2 className="display text-gradient relative mt-6 text-balance text-4xl font-bold sm:text-6xl">Ready to move your first dollar?</h2>
          <p className="relative mt-4 text-pretty text-sm sm:text-base" style={{ color: 'var(--muted)' }}>
            Open the market, post an ad, or just swap and bridge. It takes a wallet and a few seconds.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <AppLink
              to="/p2p"
              className="btn-shine glow-accent inline-flex min-h-12 items-center gap-2 rounded-xl px-7 text-sm font-semibold transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
              style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}
            >
              Open the P2P market <ArrowRight className="size-4" />
            </AppLink>
            <AppLink
              to="/swap"
              className="inline-flex min-h-12 items-center gap-2 rounded-xl px-7 text-sm font-semibold transition-colors hover:bg-[var(--fill-3)]"
              style={{ border: '1px solid var(--border)' }}
            >
              Try a swap
            </AppLink>
          </div>
        </div>
      </section>
    </Reveal>
  )
}
