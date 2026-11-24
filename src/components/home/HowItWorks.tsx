import { useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'framer-motion'
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Cpu,
  Fingerprint,
  Lock,
  Search,
  ShieldCheck,
  Wallet,
  Zap,
} from 'lucide-react'
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
  if (step === 0) {
    return (
      <div className="flex w-full max-w-[340px] flex-col gap-3.5">
        {/* Orbital Radar + Connected Wallet Identity Card */}
        <div
          className="relative overflow-hidden rounded-2xl p-4"
          style={{
            background: 'var(--fill-2)',
            border: '1px solid var(--border-strong)',
            boxShadow: '0 20px 50px -18px rgba(255, 90, 0, 0.35)',
          }}
        >
          {/* Animated sweeping scanner beam */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-x-10 top-0 h-16"
            style={{
              background: 'linear-gradient(180deg, rgba(255, 90, 0, 0.18), transparent)',
            }}
            animate={{ y: ['-40px', '170px'] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'linear' }}
          />

          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative flex size-11 items-center justify-center">
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-xl border border-dashed"
                  style={{ borderColor: 'rgba(255, 90, 0, 0.6)' }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                />
                <span
                  className="relative flex size-9 items-center justify-center rounded-xl text-white"
                  style={{
                    background: 'linear-gradient(135deg, #e04e00, #FF5A00)',
                    boxShadow: '0 8px 20px -4px rgba(255, 90, 0, 0.65)',
                  }}
                >
                  <Wallet className="size-4" />
                </span>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="mono text-xs font-bold" style={{ color: 'var(--ink)' }}>
                    0x8F4a…92cE
                  </span>
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ background: 'rgba(126, 241, 179, 0.14)', color: 'var(--success)' }}
                  >
                    <span className="size-1.5 rounded-full bg-current" /> Live
                  </span>
                </div>
                <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: 'var(--subtle)' }}>
                  <Fingerprint className="size-3" style={{ color: 'var(--accent)' }} /> Session signed · Non-custodial
                </p>
              </div>
            </div>
            <ChainLogo chain="Arc_Testnet" size={24} />
          </div>

          {/* Live Wallet Balance Readout */}
          <div
            className="relative mt-3.5 flex items-center justify-between rounded-xl px-3.5 py-2.5"
            style={{ background: 'var(--panel-solid)', border: '1px solid var(--border)' }}
          >
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
                Unified Balance
              </p>
              <p className="display mt-0.5 text-lg font-bold" style={{ color: 'var(--ink)' }}>
                1,420.00 <span style={{ color: 'var(--accent)' }}>USDC</span>
              </p>
            </div>
            <motion.div
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              className="flex size-9 items-center justify-center rounded-full"
              style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
            >
              <TokenUSDC variant="branded" size={22} />
            </motion.div>
          </div>
        </div>

        {/* Real-time Arc L1 Telemetry Grid */}
        <div className="grid grid-cols-2 gap-2.5">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4, ease }}
            className="rounded-xl p-3"
            style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
              <span>Native Gas</span>
              <Zap className="size-3" style={{ color: 'var(--accent)' }} />
            </div>
            <p className="mono mt-1 text-xs font-bold" style={{ color: 'var(--ink)' }}>
              ~0.001 USDC
            </p>
            <p className="mt-0.5 text-[10px]" style={{ color: 'var(--success)' }}>
              Zero ETH needed
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.4, ease }}
            className="rounded-xl p-3"
            style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
              <span>Arc Finality</span>
              <Cpu className="size-3" style={{ color: 'var(--accent)' }} />
            </div>
            <p className="mono mt-1 text-xs font-bold" style={{ color: 'var(--ink)' }}>
              &lt; 0.5s Block
            </p>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--fill-3)' }}>
              <motion.div
                className="h-full w-1/2 rounded-full"
                style={{ background: 'var(--accent-bg)' }}
                animate={{ x: ['-100%', '200%'] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
          </motion.div>
        </div>
      </div>
    )
  }

  if (step === 1) {
    const ads = [
      { flag: 'bd', method: 'bKash', rate: '৳122.40', limit: '$20 – $1,500', stats: '99.7% · 318 trades', depth: '88%', matched: true },
      { flag: 'in', method: 'UPI', rate: '₹86.35', limit: '$10 – $2,000', stats: '99.4% · 204 trades', depth: '72%', matched: false },
      { flag: 'pk', method: 'Raast', rate: 'Rs 279.10', limit: '$15 – $800', stats: '100% · 96 trades', depth: '58%', matched: false },
    ]
    return (
      <div className="flex w-full max-w-[340px] flex-col gap-2.5">
        {/* Filter Pill Strip */}
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="flex items-center gap-1.5">
            {['Buy USDC', '0% Fee', 'Verified'].map((chip, idx) => (
              <span
                key={chip}
                className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                style={{
                  background: idx === 0 ? 'var(--accent-bg)' : 'var(--fill-2)',
                  color: idx === 0 ? '#ffffff' : 'var(--muted)',
                  border: idx === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                {chip}
              </span>
            ))}
          </div>
          <span className="mono text-[10px] font-semibold" style={{ color: 'var(--subtle)' }}>
            LIVE BOOK
          </span>
        </div>

        {/* Animated Orderbook Rows with Depth Bars */}
        {ads.map((ad, i) => (
          <motion.div
            key={ad.method}
            initial={{ opacity: 0, x: 22 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.09, duration: 0.42, ease }}
            className="relative overflow-hidden rounded-2xl p-3"
            style={{
              background: ad.matched ? 'rgba(255, 90, 0, 0.09)' : 'var(--fill-2)',
              border: `1px solid ${ad.matched ? 'var(--border-strong)' : 'var(--border)'}`,
              boxShadow: ad.matched ? '0 14px 34px -14px rgba(255, 90, 0, 0.45)' : undefined,
            }}
          >
            {/* Animated liquidity depth bar */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0"
              style={{
                background: ad.matched
                  ? 'linear-gradient(90deg, rgba(255, 90, 0, 0.14), transparent)'
                  : 'linear-gradient(90deg, var(--fill-2), transparent)',
              }}
              initial={{ width: '0%' }}
              animate={{ width: ad.depth }}
              transition={{ delay: 0.18 + i * 0.1, duration: 0.7, ease }}
            />

            {ad.matched && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-2xl border"
                style={{ borderColor: 'var(--accent)' }}
                animate={{ opacity: [0.35, 0.95, 0.35] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}

            <div className="relative flex items-center gap-3">
              <CountryFlag code={ad.flag} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>
                    {ad.rate}
                  </span>
                  {ad.matched && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                      style={{ background: 'var(--accent-bg)', color: '#ffffff' }}
                    >
                      Best Match
                    </span>
                  )}
                </div>
                <p className="truncate text-[11px]" style={{ color: 'var(--subtle)' }}>
                  {ad.stats} · {ad.limit}
                </p>
              </div>
              <MethodLogo name={ad.method} size={28} />
            </div>
          </motion.div>
        ))}
      </div>
    )
  }

  if (step === 2) {
    return (
      <div className="flex w-full max-w-[340px] flex-col gap-3.5">
        {/* Dual-Rail Atomic Escrow Pipeline */}
        <div
          className="relative overflow-hidden rounded-2xl p-4"
          style={{ background: 'var(--fill-2)', border: '1px solid var(--border-strong)' }}
        >
          <div className="flex items-center justify-between gap-2">
            {/* Buyer Node */}
            <div
              className="flex flex-col items-center gap-1.5 rounded-xl px-3 py-2.5"
              style={{ background: 'var(--panel-solid)', border: '1px solid var(--border)' }}
            >
              <MethodLogo name="bKash" size={30} />
              <span className="text-[10px] font-bold" style={{ color: 'var(--ink)' }}>
                Fiat Rail
              </span>
              <span className="mono text-[9px]" style={{ color: 'var(--success)' }}>
                Sent ✓
              </span>
            </div>

            {/* Animated Packet Stream Left -> Vault */}
            <div className="relative flex flex-1 items-center justify-center">
              <div className="h-[2px] w-full rounded-full" style={{ background: 'var(--fill-3)' }} />
              {[0, 1, 2].map((p) => (
                <motion.span
                  key={p}
                  className="absolute left-0 size-2 rounded-full"
                  style={{ background: '#FF5A00', boxShadow: '0 0 10px #FF5A00' }}
                  animate={{ left: ['0%', '92%'], opacity: [0, 1, 0] }}
                  transition={{ duration: 1.6, delay: p * 0.52, repeat: Infinity, ease: 'linear' }}
                />
              ))}
            </div>

            {/* Center Rotating Smart Contract Vault */}
            <div className="relative flex size-20 shrink-0 items-center justify-center">
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full border border-dashed"
                style={{ borderColor: 'rgba(255, 90, 0, 0.55)' }}
                animate={{ rotate: 360 }}
                transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}
              />
              <motion.span
                aria-hidden
                className="absolute inset-2 rounded-full border"
                style={{ borderColor: 'rgba(255, 90, 0, 0.28)' }}
                animate={{ rotate: -360 }}
                transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
              />
              <motion.div
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                className="relative flex size-12 flex-col items-center justify-center rounded-2xl text-white"
                style={{
                  background: 'linear-gradient(135deg, #e04e00, #FF5A00)',
                  boxShadow: '0 14px 30px -6px rgba(255, 90, 0, 0.7)',
                }}
              >
                <Lock className="size-5" />
              </motion.div>
            </div>
          </div>

          {/* Escrow Vault Telemetry Footer */}
          <div
            className="mt-3.5 flex items-center justify-between rounded-xl px-3 py-2"
            style={{ background: 'var(--panel-solid)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <TokenUSDC variant="branded" size={18} />
              <div>
                <p className="mono text-xs font-bold" style={{ color: 'var(--ink)' }}>
                  250.00 USDC Locked
                </p>
                <p className="text-[10px]" style={{ color: 'var(--subtle)' }}>
                  P2PEscrow.sol · Arc L1
                </p>
              </div>
            </div>
            <span
              className="mono rounded-lg px-2 py-1 text-[11px] font-bold"
              style={{ background: 'rgba(255, 90, 0, 0.14)', color: 'var(--accent)' }}
            >
              14:52
            </span>
          </div>
        </div>

        {/* Encrypted Payment Proof Strip */}
        <div
          className="relative flex items-center justify-between overflow-hidden rounded-xl px-3.5 py-2.5 text-xs"
          style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
        >
          <span className="flex items-center gap-2 font-semibold" style={{ color: 'var(--ink)' }}>
            <ShieldCheck className="size-4 shrink-0" style={{ color: 'var(--success)' }} />
            AES-256-GCM Sealed Receipt
          </span>
          <span className="mono text-[10px] font-bold" style={{ color: 'var(--accent)' }}>
            VERIFIED
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-[340px] flex-col gap-3.5">
      {/* 3-Node State Machine Progress */}
      <div className="flex items-center justify-between gap-1 px-1 text-[10px] font-bold uppercase tracking-wider">
        <span className="flex items-center gap-1" style={{ color: 'var(--success)' }}>
          <CheckCircle2 className="size-3.5" /> Locked
        </span>
        <div className="h-[2px] flex-1 rounded-full" style={{ background: 'var(--success)' }} />
        <span className="flex items-center gap-1" style={{ color: 'var(--success)' }}>
          <CheckCircle2 className="size-3.5" /> Paid
        </span>
        <div className="relative h-[2px] flex-1 overflow-hidden rounded-full" style={{ background: 'var(--fill-3)' }}>
          <motion.div
            className="h-full w-full rounded-full"
            style={{ background: 'var(--success)' }}
            initial={{ x: '-100%' }}
            animate={{ x: '0%' }}
            transition={{ duration: 0.6, ease }}
          />
        </div>
        <span className="flex items-center gap-1" style={{ color: 'var(--accent)' }}>
          <BadgeCheck className="size-3.5" /> Released
        </span>
      </div>

      {/* Settlement Payout Card */}
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        className="relative overflow-hidden rounded-2xl p-4 text-center"
        style={{
          background: 'var(--fill-2)',
          border: '1px solid rgba(126, 241, 179, 0.4)',
          boxShadow: '0 20px 50px -18px rgba(126, 241, 179, 0.3)',
        }}
      >
        <div className="relative mx-auto flex size-16 items-center justify-center">
          {[0, 1].map((ring) => (
            <motion.span
              key={ring}
              aria-hidden
              className="absolute inset-0 rounded-full border"
              style={{ borderColor: 'var(--success)' }}
              initial={{ scale: 0.7, opacity: 0.8 }}
              animate={{ scale: 1.65, opacity: 0 }}
              transition={{ duration: 2.2, delay: ring * 1.1, repeat: Infinity, ease: 'easeOut' }}
            />
          ))}
          <span
            className="relative flex size-12 items-center justify-center rounded-full"
            style={{
              background: 'var(--success)',
              color: '#05180e',
              boxShadow: '0 10px 28px -4px rgba(126, 241, 179, 0.6)',
            }}
          >
            <BadgeCheck className="size-7" />
          </span>
        </div>

        <p className="display mt-3 text-xl font-bold" style={{ color: 'var(--ink)' }}>
          +250.00 <span style={{ color: 'var(--success)' }}>USDC</span>
        </p>
        <p className="mono mt-0.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
          Settled to buyer wallet · 0% Trade Fee
        </p>
      </motion.div>

      {/* Arbiter & Margin Safety Net Strip */}
      <div
        className="flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs"
        style={{
          background: 'rgba(255, 90, 0, 0.09)',
          border: '1px solid rgba(255, 90, 0, 0.32)',
        }}
      >
        <span className="flex items-center gap-2 font-semibold" style={{ color: 'var(--ink)' }}>
          <ShieldCheck className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
          2-Tier Arbiter &amp; Margin Bond
        </span>
        <span className="mono text-[10px] font-bold" style={{ color: 'var(--accent)' }}>
          PROTECTED
        </span>
      </div>
    </div>
  )
}

function StackingStepCard({
  step,
  index,
  active,
  progress,
}: {
  step: (typeof STEPS)[number]
  index: number
  active: boolean
  progress: MotionValue<number>
}) {
  const restY = index * 188
  const stackedY = index * 6
  const totalTravel = 3 * 176

  const y = useTransform(progress, (v) => {
    if (index === 0) return 0
    return Math.max(stackedY, restY - v * totalTravel)
  })
  const scale = useTransform(progress, (v) => {
    if (index === 3) return 1
    const coveredByNext = Math.max(0, Math.min(1, (v * totalTravel - index * 176) / 176))
    return 1 - coveredByNext * 0.025
  })

  return (
    <motion.li
      className="absolute inset-x-0 top-0"
      style={{
        y: index === 0 ? 0 : y,
        scale,
        zIndex: index + 1,
      }}
    >
      <div
        className="flex min-h-[168px] items-center justify-between gap-5 rounded-3xl p-6 transition-colors duration-300 sm:p-7"
        style={{
          background: 'var(--panel-solid)',
          border: `1px solid ${active ? 'var(--border-strong)' : 'var(--border)'}`,
          boxShadow: active ? '0 0 0 1px rgba(255, 90, 0, 0.16)' : 'none',
        }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: active ? 'var(--accent)' : 'var(--subtle)' }}>
            STEP 0{index + 1}
          </p>
          <h3 className="display mt-1.5 text-xl font-bold sm:text-2xl">{step.title}</h3>
          <p className="mt-2 text-pretty text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
            {step.body}
          </p>
        </div>

        <span
          className="flex size-14 shrink-0 items-center justify-center rounded-2xl transition-all duration-300 sm:size-16"
          style={{
            background: active ? 'linear-gradient(135deg, #e04e00, #FF5A00)' : 'var(--fill-2)',
            color: active ? '#ffffff' : 'var(--muted)',
            boxShadow: active ? '0 12px 28px -8px rgba(255, 90, 0, 0.6)' : undefined,
            border: active ? 'none' : '1px solid var(--border)',
          }}
        >
          <step.icon className="size-6 sm:size-7" />
        </span>
      </div>
    </motion.li>
  )
}

/**
 * Desktop pins the entire section (heading + stacking deck + live visual stage)
 * until all four cards have stacked one over the next, then unpins cleanly.
 */
export function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start 88px', 'end end'],
  })

  const deckHeight = useTransform(scrollYProgress, [0, 0.75, 1], [540, 440, 420])

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    if (v < 0.26) setActive(0)
    else if (v < 0.56) setActive(1)
    else if (v < 0.84) setActive(2)
    else setActive(3)
  })

  return (
    <section ref={sectionRef} className="relative mt-24 lg:h-[235vh]" aria-labelledby="how-title">
      {/* Desktop pinned stage */}
      <div className="hidden lg:sticky lg:top-24 lg:block">
        <Reveal>
          <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
            How it works
          </p>
          <h2 id="how-title" className="display mt-2 text-balance text-5xl font-bold" style={{ color: 'var(--accent)' }}>
            From wallet to local cash in four steps
          </h2>
        </Reveal>

        {/* Matches mt-10 heading-to-content spacing across all landing sections */}
        <div className="mt-10 grid items-start gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          {/* Stacking card deck */}
          <motion.ol
            className="relative -mx-4 overflow-hidden px-4 py-0.5"
            style={{ height: deckHeight }}
          >
            {STEPS.map((s, i) => (
              <StackingStepCard key={s.title} step={s} index={i} active={active === i} progress={scrollYProgress} />
            ))}
          </motion.ol>

          {/* Pro live escrow telemetry stage */}
          <div>
            <div
              className="glass relative flex min-h-[404px] flex-col items-center justify-between overflow-hidden rounded-[2rem] p-6 sm:p-7"
              style={{
                boxShadow: 'var(--glass-shadow), 0 0 0 1px var(--border)',
              }}
            >
              {/* Subtle engineered micro-grid + top ambient glow */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-45"
                style={{
                  backgroundImage:
                    'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                  maskImage: 'radial-gradient(ellipse 80% 75% at 50% 45%, #000 30%, transparent 90%)',
                  WebkitMaskImage: 'radial-gradient(ellipse 80% 75% at 50% 45%, #000 30%, transparent 90%)',
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full"
                style={{ background: 'radial-gradient(circle, rgba(255, 90, 0, 0.22), transparent 68%)', filter: 'blur(24px)' }}
              />

              {/* Top Step Progress Track + Live Telemetry Header */}
              <div className="relative w-full space-y-2.5">
                <div className="flex w-full items-center justify-between text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
                  <span className="inline-flex items-center gap-2">
                    <span className="relative flex size-2">
                      <span
                        className="absolute inline-flex size-full animate-ping rounded-full opacity-75"
                        style={{ backgroundColor: 'var(--accent)' }}
                      />
                      <span className="relative inline-flex size-2 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                    </span>
                    <span className="mono text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ink)' }}>
                      0{active + 1} / 04
                    </span>
                  </span>
                  <span className="mono text-[11px]">{STEPS[active].title}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {STEPS.map((s, i) => (
                    <div key={s.title} className="h-1 overflow-hidden rounded-full" style={{ background: 'var(--fill-3)' }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: 'var(--accent-bg)' }}
                        initial={false}
                        animate={{ width: i <= active ? '100%' : '0%' }}
                        transition={{ duration: 0.35, ease }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Animated Scene Viewport */}
              <div className="relative my-4 flex w-full flex-1 items-center justify-center">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={active}
                    className="flex w-full justify-center"
                    initial={{ opacity: 0, y: 16, scale: 0.96, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -12, scale: 0.97, filter: 'blur(4px)' }}
                    transition={{ duration: 0.32, ease }}
                  >
                    <Visual step={active} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
              Keep scrolling <ArrowRight className="size-3 rotate-90" />
            </p>
          </div>
        </div>
      </div>

      {/* Mobile clean stacked layout */}
      <div className="lg:hidden">
        <Reveal>
          <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
            How it works
          </p>
          <h2 className="display mt-2 text-balance text-3xl font-bold sm:text-4xl" style={{ color: 'var(--accent)' }}>
            From wallet to local cash in four steps
          </h2>
        </Reveal>
        <ol className="mt-8 space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex items-center justify-between gap-4 rounded-2xl p-5" style={{ background: 'var(--panel-solid)', border: '1px solid var(--border)' }}>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--accent)' }}>
                  STEP 0{i + 1}
                </p>
                <h3 className="display mt-1 text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-pretty text-sm" style={{ color: 'var(--muted)' }}>
                  {s.body}
                </p>
              </div>
              <span
                className="flex size-12 shrink-0 items-center justify-center rounded-2xl"
                style={{ background: 'linear-gradient(135deg, #e04e00, #FF5A00)', color: '#ffffff' }}
              >
                <s.icon className="size-5" />
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
