import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, BadgeCheck, Lock, Search, Wallet } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { ChainLogo, CountryFlag, MethodLogo } from '@/components/logos'
import { Reveal } from '@/components/fx/Reveal'

const STEPS = [
  {
    icon: Wallet,
    title: 'Connect your wallet',
    body: 'Use any wallet on Arc Testnet. USDC is the gas token, so one balance covers trades and fees.',
  },
  {
    icon: Search,
    title: 'Pick an ad',
    body: 'Choose your country, your payment method and an amount. Ads show the price, limits and the trader’s record.',
  },
  {
    icon: Lock,
    title: 'Pay locally, USDC stays locked',
    body: 'The seller’s USDC sits in escrow while you send your own currency by UPI, bKash, Raast and more.',
  },
  {
    icon: BadgeCheck,
    title: 'Release or dispute',
    body: 'When the seller confirms the money arrived, the USDC is released to you. If something is wrong, an arbiter steps in.',
  },
] as const

const ease = [0.22, 1, 0.36, 1] as const

function Visual({ step }: { step: number }) {
  if (step === 0)
    return (
      <div className="flex flex-col items-center gap-5">
        <motion.span
          className="flex size-20 items-center justify-center rounded-3xl"
          style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)', boxShadow: '0 16px 40px -10px var(--accent-glow)' }}
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Wallet className="size-9" />
        </motion.span>
        <div className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
          <ChainLogo chain="Arc_Testnet" size={18} /> Arc Testnet
        </div>
      </div>
    )
  if (step === 1)
    return (
      <div className="w-full max-w-xs space-y-3">
        {[0, 1].map((i) => (
          <motion.div
            key={i}
            className="inner flex items-center gap-3 rounded-2xl p-3"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.12, duration: 0.5, ease }}
          >
            <CountryFlag code={i ? 'bd' : 'in'} size={34} />
            <div className="flex-1 space-y-1.5">
              <span className="shimmer block h-3 w-24 rounded-full" style={{ background: 'var(--fill-3)' }} />
              <span className="shimmer block h-2.5 w-36 rounded-full" style={{ background: 'var(--fill-2)' }} />
            </div>
            <MethodLogo name={i ? 'bKash' : 'UPI'} size={30} />
          </motion.div>
        ))}
        <p className="text-center text-xs" style={{ color: 'var(--subtle)' }}>Your country, your payment method</p>
      </div>
    )
  if (step === 2)
    return (
      <div className="flex items-center gap-4">
        <MethodLogo name="UPI" size={52} />
        <div className="relative h-1 w-16 overflow-hidden rounded-full" style={{ background: 'var(--fill-3)' }}>
          <motion.span className="absolute inset-y-0 w-6 rounded-full" style={{ background: 'var(--accent-bg)' }} animate={{ x: [-24, 64] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }} />
        </div>
        <motion.span
          className="flex size-16 items-center justify-center rounded-2xl"
          style={{ background: 'var(--fill-3)', border: '1px solid var(--border)' }}
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: 2.4, repeat: Infinity }}
        >
          <Lock className="size-7" style={{ color: 'var(--accent)' }} />
        </motion.span>
      </div>
    )
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex size-24 items-center justify-center">
        {[0, 1].map((i) => (
          <motion.span
            key={i}
            className="absolute inset-0 rounded-full border"
            style={{ borderColor: 'var(--success)' }}
            initial={{ scale: 0.6, opacity: 0.8 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 2, delay: i * 0.9, repeat: Infinity, ease: 'easeOut' }}
          />
        ))}
        <span className="flex size-20 items-center justify-center rounded-full" style={{ background: 'var(--success)', color: 'var(--on-accent)' }}>
          <BadgeCheck className="size-9" />
        </span>
      </div>
      <p className="flex items-center gap-2 text-sm font-semibold"><TokenUSDC variant="branded" size={18} /> USDC released</p>
    </div>
  )
}

/** Four steps; the sticky panel on the right follows whichever step is in view. */
export function HowItWorks() {
  const [active, setActive] = useState(0)
  return (
    <section className="mt-24" aria-labelledby="how-title">
      <Reveal>
        <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>How it works</p>
        <h2 id="how-title" className="display text-gradient mt-2 text-balance text-4xl font-bold sm:text-5xl">From wallet to local cash in four steps</h2>
      </Reveal>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:gap-8">
        <ol className="relative space-y-4">
          <span aria-hidden className="absolute bottom-6 left-[23px] top-6 hidden w-px lg:block" style={{ background: 'var(--border)' }} />
          {STEPS.map((s, i) => (
            <motion.li
              key={s.title}
              onViewportEnter={() => setActive(i)}
              viewport={{ margin: '-35% 0px -35% 0px' }}
              className="relative flex items-center gap-4"
            >
              <motion.span
                className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-2xl"
                animate={{
                  scale: active === i ? 1.08 : 1,
                  background: active === i ? 'var(--accent-bg)' : 'var(--surface-muted)',
                  color: active === i ? 'var(--on-accent)' : 'var(--muted)',
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                style={{ boxShadow: active === i ? '0 10px 30px -8px var(--accent-glow)' : undefined }}
              >
                <s.icon className="size-5" />
              </motion.span>
              <motion.div
                className="glass flex-1 rounded-3xl p-5"
                animate={{ opacity: active === i ? 1 : 0.62 }}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ y: 0 }}
                viewport={{ once: true, margin: '0px 0px -10% 0px' }}
                transition={{ duration: 0.6, ease }}
              >
                <p className="text-xs font-bold" style={{ color: 'var(--subtle)' }}>STEP {i + 1}</p>
                <h3 className="display mt-1 text-xl font-bold">{s.title}</h3>
                <p className="mt-2 text-pretty text-sm" style={{ color: 'var(--muted)' }}>{s.body}</p>
              </motion.div>
            </motion.li>
          ))}
        </ol>

        <div className="hidden lg:block">
          <div className="sticky top-32">
            <div className="glass flex min-h-[340px] flex-col items-center justify-center overflow-hidden rounded-[2rem] p-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  className="flex w-full justify-center"
                  initial={{ opacity: 0, y: 18, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.98 }}
                  transition={{ duration: 0.35, ease }}
                >
                  <Visual step={active} />
                </motion.div>
              </AnimatePresence>
              <div className="mt-8 flex gap-1.5" aria-hidden>
                {STEPS.map((_, i) => (
                  <motion.span key={i} className="h-1.5 rounded-full" animate={{ width: active === i ? 28 : 8, backgroundColor: active === i ? 'var(--accent)' : 'var(--fill-3)' }} />
                ))}
              </div>
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
              Keep scrolling <ArrowRight className="size-3 rotate-90" />
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
