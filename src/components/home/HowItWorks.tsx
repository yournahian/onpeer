import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, BadgeCheck, Lock, Search, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
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
      <div className="relative flex flex-col items-center gap-5 py-2">
        <div className="relative flex size-28 items-center justify-center">
          {[0, 1].map((i) => (
            <motion.span
              key={i}
              className="absolute inset-0 rounded-full border"
              style={{ borderColor: 'rgba(255, 90, 0, 0.38)' }}
              initial={{ scale: 0.72, opacity: 0.7 }}
              animate={{ scale: 1.5, opacity: 0 }}
              transition={{ duration: 2.6, delay: i * 1.3, repeat: Infinity, ease: 'easeOut' }}
            />
          ))}
          <motion.div
            className="relative flex size-20 items-center justify-center rounded-3xl"
            style={{
              background: 'linear-gradient(135deg, #e04e00, #FF5A00)',
              color: '#ffffff',
              boxShadow: '0 20px 50px -10px rgba(255, 90, 0, 0.65), inset 0 1px 1px rgba(255,255,255,0.35)',
            }}
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Wallet className="size-9" />
          </motion.div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--fill-2)', border: '1px solid var(--border-strong)' }}
          >
            <ChainLogo chain="Arc_Testnet" size={16} /> Arc Testnet
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{ background: 'rgba(126, 241, 179, 0.12)', border: '1px solid rgba(126, 241, 179, 0.28)', color: 'var(--success)' }}
          >
            <TokenUSDC variant="branded" size={14} /> USDC as gas
          </span>
        </div>
      </div>
    )

  if (step === 1)
    return (
      <div className="w-full max-w-xs space-y-2.5">
        {[
          { flag: 'in', method: 'UPI', rate: '₹86.40', trader: '99.4% · 142 trades', tag: 'Best rate' },
          { flag: 'bd', method: 'bKash', rate: '৳122.50', trader: '98.8% · 89 trades', tag: 'Verified' },
          { flag: 'pk', method: 'Raast', rate: 'Rs 279.10', trader: '100% · 64 trades', tag: 'Instant' },
        ].map((ad, i) => (
          <motion.div
            key={ad.method}
            className="flex items-center gap-3 rounded-2xl p-3"
            style={{
              background: i === 0 ? 'rgba(255, 90, 0, 0.1)' : 'var(--fill-2)',
              border: `1px solid ${i === 0 ? 'rgba(255, 90, 0, 0.4)' : 'var(--border)'}`,
            }}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1, duration: 0.45, ease }}
          >
            <CountryFlag code={ad.flag} size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="display text-sm font-bold">{ad.rate}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}
                >
                  {ad.tag}
                </span>
              </div>
              <p className="truncate text-[11px]" style={{ color: 'var(--subtle)' }}>
                {ad.trader}
              </p>
            </div>
            <MethodLogo name={ad.method} size={28} />
          </motion.div>
        ))}
      </div>
    )

  if (step === 2)
    return (
      <div className="flex w-full max-w-xs flex-col items-center gap-5">
        <div className="flex w-full items-center justify-between gap-3">
          <motion.div
            className="flex flex-col items-center gap-1.5 rounded-2xl p-3"
            style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <MethodLogo name="UPI" size={38} />
            <span className="text-[10px] font-semibold" style={{ color: 'var(--subtle)' }}>
              Fiat sent
            </span>
          </motion.div>

          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--fill-3)' }}>
            <motion.span
              className="absolute inset-y-0 w-10 rounded-full"
              style={{ background: 'linear-gradient(90deg, transparent, #FF5A00, #ffb380)' }}
              animate={{ x: ['-40px', '140px'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            />
          </div>

          <motion.div
            className="flex flex-col items-center gap-1.5 rounded-2xl p-3"
            style={{
              background: 'rgba(255, 90, 0, 0.14)',
              border: '1px solid rgba(255, 90, 0, 0.45)',
              boxShadow: '0 12px 30px -10px rgba(255, 90, 0, 0.45)',
            }}
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Lock className="size-8" style={{ color: 'var(--accent)' }} />
            <span className="text-[10px] font-bold" style={{ color: 'var(--accent)' }}>
              Escrow
            </span>
          </motion.div>
        </div>

        <div
          className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold"
          style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
        >
          <TokenUSDC variant="branded" size={16} />
          <span>USDC locked in smart contract</span>
        </div>
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
            initial={{ scale: 0.65, opacity: 0.85 }}
            animate={{ scale: 1.65, opacity: 0 }}
            transition={{ duration: 2.1, delay: i * 1.0, repeat: Infinity, ease: 'easeOut' }}
          />
        ))}
        <motion.span
          className="relative flex size-20 items-center justify-center rounded-full"
          style={{
            background: 'var(--success)',
            color: '#06150c',
            boxShadow: '0 16px 40px -8px rgba(126, 241, 179, 0.55)',
          }}
          initial={{ scale: 0.85 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 20 }}
        >
          <BadgeCheck className="size-10" />
        </motion.span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
          <TokenUSDC variant="branded" size={16} /> USDC released
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{ background: 'rgba(255, 90, 0, 0.12)', color: 'var(--accent)', border: '1px solid rgba(255, 90, 0, 0.28)' }}
        >
          <ShieldCheck className="size-3.5" /> Arbiter protected
        </span>
      </div>
    </div>
  )
}

/** Four sticky stacking step cards on the left; a live animated preview panel on the right. */
export function HowItWorks() {
  const [active, setActive] = useState(0)
  return (
    <section className="mt-24" aria-labelledby="how-title">
      <Reveal>
        <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
          How it works
        </p>
        <h2 id="how-title" className="display text-gradient mt-2 text-balance text-3xl font-bold sm:text-5xl">
          From wallet to local cash in four steps
        </h2>
      </Reveal>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10">
        {/* Sticky stacking cards */}
        <ol className="relative space-y-4 pb-6 sm:space-y-5">
          {STEPS.map((s, i) => {
            const isActive = active === i
            return (
              <motion.li
                key={s.title}
                onViewportEnter={() => setActive(i)}
                viewport={{ margin: '-35% 0px -35% 0px' }}
                onClick={() => setActive(i)}
                className="sticky cursor-pointer"
                style={{
                  top: `calc(6rem + ${i * 12}px)`,
                  zIndex: i + 1,
                }}
              >
                <motion.div
                  className="flex items-center justify-between gap-5 rounded-3xl p-6 backdrop-blur-2xl sm:p-7"
                  animate={{
                    scale: isActive ? 1 : 0.985,
                  }}
                  transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                  style={{
                    background: 'color-mix(in srgb, var(--panel-solid) 94%, transparent)',
                    border: `1px solid ${isActive ? 'var(--border-strong)' : 'var(--border)'}`,
                    boxShadow: isActive
                      ? '0 24px 60px -18px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 90, 0, 0.16)'
                      : '0 16px 40px -16px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: isActive ? 'var(--accent)' : 'var(--subtle)' }}>
                      STEP 0{i + 1}
                    </p>
                    <h3 className="display mt-1.5 text-xl font-bold sm:text-2xl">{s.title}</h3>
                    <p className="mt-2 text-pretty text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                      {s.body}
                    </p>
                  </div>

                  <motion.span
                    className="flex size-14 shrink-0 items-center justify-center rounded-2xl sm:size-16"
                    animate={{
                      background: isActive ? 'linear-gradient(135deg, #e04e00, #FF5A00)' : 'var(--fill-2)',
                      color: isActive ? '#ffffff' : 'var(--muted)',
                    }}
                    transition={{ duration: 0.25 }}
                    style={{
                      boxShadow: isActive ? '0 12px 28px -8px rgba(255, 90, 0, 0.6)' : undefined,
                      border: isActive ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    <s.icon className="size-6 sm:size-7" />
                  </motion.span>
                </motion.div>
              </motion.li>
            )
          })}
        </ol>

        {/* Premium sticky right-hand animation stage */}
        <div className="hidden lg:block lg:sticky lg:top-24">
          <div
            className="glass relative flex min-h-[380px] flex-col items-center justify-between overflow-hidden rounded-[2rem] p-8"
            style={{
              boxShadow: '0 28px 70px -22px rgba(0, 0, 0, 0.65), 0 0 0 1px var(--border)',
            }}
          >
            {/* Ambient radial glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(255, 90, 0, 0.22), transparent 68%)', filter: 'blur(24px)' }}
            />

            <div className="relative flex w-full items-center justify-between text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="size-3.5" style={{ color: 'var(--accent)' }} />
                Step 0{active + 1} of 04
              </span>
              <span className="mono">{STEPS[active].title}</span>
            </div>

            <div className="relative my-6 flex w-full flex-1 items-center justify-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  className="flex w-full justify-center"
                  initial={{ opacity: 0, y: 18, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -14, scale: 0.96 }}
                  transition={{ duration: 0.35, ease }}
                >
                  <Visual step={active} />
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="relative flex gap-2" aria-hidden>
              {STEPS.map((s, i) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => setActive(i)}
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: active === i ? 30 : 10,
                    backgroundColor: active === i ? 'var(--accent)' : 'var(--fill-3)',
                  }}
                />
              ))}
            </div>
          </div>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
            Keep scrolling or click a step <ArrowRight className="size-3 rotate-90" />
          </p>
        </div>
      </div>
    </section>
  )
}
