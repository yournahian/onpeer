import { motion } from 'framer-motion'
import {
  ArrowLeftRight,
  CreditCard,
  Repeat,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wallet,
  Waypoints,
} from 'lucide-react'
import { useAgentContext } from '@/agent/AgentContext'
import { SiteBar } from '@/components/SiteBar'
import { ChatThread } from '@/components/chat/ChatThread'
import { RibbonBackdrop } from '@/components/fx/RibbonBackdrop'

const CAPABILITIES = [
  {
    icon: ArrowLeftRight,
    title: 'P2P Deal Finder',
    body: 'Compare live ads by currency & payment rail, then prefill an order.',
  },
  {
    icon: Repeat,
    title: 'Swap in Chat',
    body: 'Quote and swap USDC ↔ EURC on Arc without leaving this thread.',
  },
  {
    icon: Waypoints,
    title: 'Bridge in Chat',
    body: 'Move USDC across 7 testnets via Circle CCTP with live step tracking.',
  },
  {
    icon: CreditCard,
    title: 'Buy & Cash Out',
    body: 'Launch Circle Onramp sandbox or jump straight to P2P Sell USDC.',
  },
  {
    icon: Wallet,
    title: 'Wallet & Orders',
    body: 'Check Arc balances, tier limits, and open escrow order status.',
  },
] as const

export default function AssistantPage() {
  const { items, health, reset } = useAgentContext()
  const ready = health.state === 'ready' && health.configured

  const statusText =
    health.state === 'loading'
      ? 'Connecting...'
      : health.state === 'offline'
        ? 'Offline'
        : ready
          ? 'Online'
          : 'Not configured'

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SiteBar />

      <div className="relative flex min-h-0 flex-1 w-full items-center justify-center overflow-hidden px-3 py-3 sm:px-6 sm:py-4">
        <RibbonBackdrop />

        <motion.main
          aria-label="OnPeer Assistant Workspace"
          initial={{ opacity: 0, y: 14, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-20 grid h-full max-h-[620px] w-full max-w-5xl overflow-hidden rounded-[24px] backdrop-blur-2xl sm:rounded-[26px] lg:grid-cols-[minmax(0,1fr)_272px]"
          style={{
            background: 'color-mix(in srgb, var(--panel-solid) 95%, transparent)',
            border: '1px solid var(--border-strong)',
            boxShadow: '0 24px 80px -20px var(--accent-glow), 0 12px 40px -12px rgba(0,0,0,0.28)',
          }}
        >
          {/* Left: Primary Conversation Console */}
          <section aria-label="Conversation" className="flex min-h-0 flex-col overflow-hidden">
            <header
              className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-5"
              style={{ borderBottom: '1px solid var(--border)', background: 'var(--fill-1)' }}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="relative flex size-8 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}
                >
                  <Sparkles className="size-4" />
                  <span
                    className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2"
                    style={{
                      background: ready ? 'var(--success)' : 'var(--warn)',
                      ['--tw-ring-color' as string]: 'var(--panel-solid)',
                    }}
                  />
                </span>
                <div className="min-w-0 leading-tight">
                  <div className="flex items-center gap-2">
                    <h1 className="display truncate text-sm font-bold sm:text-base">OnPeer Assistant</h1>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{
                        background: 'var(--fill-2)',
                        border: '1px solid var(--border)',
                        color: ready ? 'var(--success)' : 'var(--muted)',
                      }}
                    >
                      {statusText}
                    </span>
                  </div>
                  <p className="truncate text-[11px]" style={{ color: 'var(--muted)' }}>
                    Non-custodial copilot • Prepare trades, swaps &amp; bridges
                  </p>
                </div>
              </div>

              {items.length > 0 && (
                <button
                  type="button"
                  onClick={reset}
                  aria-label="Clear chat"
                  title="Clear conversation"
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors hover:bg-[var(--fill-3)]"
                  style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                >
                  <RotateCcw className="size-3.5" />
                  <span className="hidden sm:inline">Reset</span>
                </button>
              )}
            </header>

            <ChatThread variant="page" />
          </section>

          {/* Right: Integrated Capabilities & Non-Custodial Guardrails Rail */}
          <aside
            aria-label="Assistant capabilities and guardrails"
            className="hidden min-h-0 flex-col justify-between overflow-hidden p-4 lg:flex"
            style={{ borderLeft: '1px solid var(--border)', background: 'var(--fill-1)' }}
          >
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--subtle)' }}>
                Capabilities
              </p>
              <ul className="mt-2.5 space-y-2">
                {CAPABILITIES.map((c) => (
                  <li key={c.title} className="flex items-start gap-2.5">
                    <span
                      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--accent)' }}
                    >
                      <c.icon className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-snug" style={{ color: 'var(--ink)' }}>
                        {c.title}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
                        {c.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div
              className="mt-3 rounded-xl p-3 text-[11px] leading-snug"
              style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
            >
              <p className="flex items-center gap-1.5 font-bold" style={{ color: 'var(--ink)' }}>
                <ShieldCheck className="size-3.5 shrink-0" style={{ color: 'var(--success)' }} />
                You stay in control
              </p>
              <ul className="mt-1.5 space-y-1" style={{ color: 'var(--muted)' }}>
                <li>• Every transaction requires your wallet signature.</li>
                <li>• Never marks orders paid or releases escrow.</li>
                <li>• Encrypted chat &amp; bank details stay private.</li>
              </ul>
            </div>
          </aside>
        </motion.main>
      </div>
    </div>
  )
}
