import { motion } from 'framer-motion'
import { useAccount } from 'wagmi'
import { ArrowLeftRight, Repeat, RotateCcw, ShieldCheck, Sparkles, Waypoints, Wallet } from 'lucide-react'
import { useAgentContext } from '@/agent/AgentContext'
import { shortAddr } from '@/lib/p2p'
import { SiteBar } from '@/components/SiteBar'
import { ChatThread } from '@/components/chat/ChatThread'
import { Reveal } from '@/components/fx/Reveal'

const ease = [0.22, 1, 0.36, 1] as const

const CAPABILITIES = [
  { icon: ArrowLeftRight, title: 'Find P2P deals', body: 'Search ads by country, payment method and amount, then prepare an order.' },
  { icon: Repeat, title: 'Swap in chat', body: 'USDC and EURC on Arc. Get a quote, confirm and sign without leaving the chat.' },
  { icon: Waypoints, title: 'Bridge in chat', body: 'Move USDC between Arc and six testnets with live progress and retry.' },
  { icon: Wallet, title: 'Check your account', body: 'Balances, open orders and where each trade stands.' },
]

export default function AssistantPage() {
  const { address, isConnected } = useAccount()
  const { items, health, provider, setProvider, reset } = useAgentContext()
  const ready = health.state === 'ready' && health.configured
  const activeLabel =
    health.state === 'ready' ? (health.providers.find((p) => p.id === (provider ?? health.active))?.label ?? null) : null

  return (
    <div className="min-h-dvh">
      <SiteBar sticky={false} />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 sm:py-10 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease }}
          className="w-full"
        >
          <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
            OnPeer assistant
          </p>
          <h1 className="display text-gradient mt-2 text-balance text-4xl font-bold sm:text-5xl">Do it by chatting</h1>
          <p className="mt-3 text-pretty" style={{ color: 'var(--muted)' }}>
            Tell me what you want in plain words. I find the deal, prepare the swap or bridge, and you confirm and sign in
            your own wallet.
          </p>
        </motion.div>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <motion.section
            aria-label="Conversation"
            className="glass flex min-h-[600px] flex-col overflow-hidden rounded-[2rem] lg:h-[min(78dvh,780px)] lg:min-h-[640px]"
            initial={{ opacity: 0, y: 20, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.65, delay: 0.1, ease }}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2.5">
                <span className="relative flex size-9 items-center justify-center rounded-xl" style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}>
                  <Sparkles className="size-4" />
                  {ready && (
                    <span
                      className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2"
                      style={{ background: 'var(--success)', ['--tw-ring-color' as string]: 'var(--bg)' }}
                    />
                  )}
                </span>
                <div className="leading-tight">
                  <h2 className="display text-base font-semibold">Assistant</h2>
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                    {health.state === 'loading'
                      ? 'Connecting...'
                      : health.state === 'offline'
                        ? 'Backend offline'
                        : ready
                          ? `Online${activeLabel ? ` · ${activeLabel}` : ''}`
                          : 'Needs setup'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {health.state === 'ready' && health.providers.length > 1 && (
                  <select
                    aria-label="AI provider"
                    value={provider ?? health.active ?? ''}
                    onChange={(e) => setProvider(e.target.value)}
                    className="rounded-lg bg-transparent px-2 py-1.5 text-xs font-semibold outline-none"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    {health.providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                )}
                {items.length > 0 && (
                  <button
                    onClick={reset}
                    aria-label="Clear chat"
                    title="Clear chat"
                    className="flex size-10 items-center justify-center rounded-full hover:bg-[var(--fill-3)]"
                  >
                    <RotateCcw className="size-4" />
                  </button>
                )}
              </div>
            </div>
            <ChatThread variant="page" />
          </motion.section>

          <aside className="space-y-4 lg:sticky lg:top-28" aria-label="What the assistant can do">
            <Reveal>
              <div className="glass rounded-3xl p-5">
                <h2 className="display text-lg font-semibold">What I can do</h2>
                <ul className="mt-4 space-y-4">
                  {CAPABILITIES.map((c, i) => (
                    <motion.li
                      key={c.title}
                      className="flex gap-3"
                      initial={{ opacity: 0, x: 14 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.25 + i * 0.08, ease }}
                    >
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-xl"
                        style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
                      >
                        <c.icon className="size-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{c.title}</p>
                        <p className="mt-0.5 text-xs text-pretty" style={{ color: 'var(--muted)' }}>
                          {c.body}
                        </p>
                      </div>
                    </motion.li>
                  ))}
                </ul>
              </div>
            </Reveal>

            <Reveal delay={0.08}>
              <div className="glass rounded-3xl p-5">
                <h2 className="display flex items-center gap-2 text-lg font-semibold">
                  <ShieldCheck className="size-4" style={{ color: 'var(--success)' }} /> You stay in control
                </h2>
                <ul className="mt-3 space-y-2 text-xs text-pretty" style={{ color: 'var(--muted)' }}>
                  <li>Nothing is sent until you confirm and sign in your wallet.</li>
                  <li>I can never pay fiat, mark an order as paid or release USDC for you.</li>
                  <li>Ad notes, payment details and order messages are never shown to the AI.</li>
                </ul>
                <p className="mt-4 text-xs" style={{ color: 'var(--subtle)' }}>
                  {isConnected && address ? `Wallet connected: ${shortAddr(address)}` : 'No wallet connected yet. You can connect it when a card asks.'}
                </p>
              </div>
            </Reveal>
          </aside>
        </div>
      </main>
    </div>
  )
}
