import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Send, Sparkles } from 'lucide-react'
import { navigate } from '@/lib/router'
import { useAgentContext } from '@/agent/AgentContext'
import type { UiItem } from '@/agent/useAgent'
import type { Proposal } from '@/agent/tools'
import { Button } from '@/components/ui'
import { SwapCard } from '@/components/chat/SwapCard'
import { BridgeCard } from '@/components/chat/BridgeCard'

export const SUGGESTIONS = [
  'Find the best price to buy 100 USDC in India with UPI',
  'Swap 10 USDC to EURC',
  'Bridge 25 USDC from Arc to Base Sepolia',
  'Show my orders',
]

/** Messages, setup notices and the input box. Shared by the floating panel and the assistant page. */
export function ChatThread({
  variant,
  active = true,
  onNavigate,
}: {
  variant: 'panel' | 'page'
  /** Refreshes the backend status whenever the thread becomes visible. */
  active?: boolean
  onNavigate?: () => void
}) {
  const [draft, setDraft] = useState('')
  const { items, busy, health, send, refreshHealth, report } = useAgentContext()
  const listRef = useRef<HTMLDivElement>(null)
  const page = variant === 'page'

  useEffect(() => {
    const el = listRef.current
    if (!el || !active || items.length === 0) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [items, busy, active])

  useEffect(() => {
    if (active) refreshHealth()
  }, [active, refreshHealth])

  const ready = health.state === 'ready' && health.configured
  const submit = (text: string) => {
    if (!text.trim() || busy || !ready) return
    setDraft('')
    void send(text)
  }

  return (
    <>
      <div ref={listRef} className={`flex-1 space-y-3 overflow-y-auto ${page ? 'px-4 py-5 sm:px-6' : 'px-4 py-4'}`} aria-live="polite">
        {health.state === 'offline' && (
          <Notice>
            The assistant backend is not running. Start it with <code className="mono">bun run server</code>.
          </Notice>
        )}
        {health.state === 'ready' && !health.configured && (
          <Notice>
            No AI provider key found. Add one of <code className="mono">OPENROUTER_API_KEY</code>,{' '}
            <code className="mono">GROQ_API_KEY</code>, <code className="mono">GEMINI_API_KEY</code> or the{' '}
            <code className="mono">CUSTOM_AI_*</code> settings to <code className="mono">.env</code>, then restart{' '}
            <code className="mono">bun run server</code>.
          </Notice>
        )}

        {items.length === 0 && (
          <div className={page ? 'mx-auto max-w-xl py-6 text-center' : ''}>
            {page && (
              <motion.span
                className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl"
                style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)', boxShadow: '0 12px 36px -8px var(--accent-glow)' }}
                initial={{ scale: 0.6, rotate: -20, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              >
                <Sparkles className="size-6" />
              </motion.span>
            )}
            <p className={`text-pretty ${page ? 'display text-2xl font-semibold' : 'text-sm'}`} style={{ color: page ? undefined : 'var(--muted)' }}>
              {page ? 'What would you like to do?' : 'Ask in plain words. I can find P2P ads, check your balances and orders, and prepare a swap, bridge or order for you to review. You always confirm and sign yourself.'}
            </p>
            {page && (
              <p className="mx-auto mt-2 max-w-md text-sm text-pretty" style={{ color: 'var(--muted)' }}>
                Ask in plain words. I prepare the action and you confirm and sign it yourself.
              </p>
            )}
            <div className={`mt-4 flex flex-col gap-2 ${page ? 'sm:grid sm:grid-cols-2' : ''}`}>
              {SUGGESTIONS.map((s, i) => (
                <motion.button
                  key={s}
                  disabled={!ready}
                  onClick={() => submit(s)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.07 }}
                  className="inner rounded-xl px-3.5 py-3 text-left text-sm transition-colors hover:bg-[var(--fill-3)] disabled:opacity-40"
                >
                  {s}
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <Bubble item={item} onNavigate={onNavigate ?? (() => undefined)} onReport={report} />
          </motion.div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-xs" style={{ color: 'var(--subtle)' }}>
            <span className="flex gap-1" aria-hidden>
              {[0, 1, 2].map((d) => (
                <motion.span
                  key={d}
                  className="size-1.5 rounded-full"
                  style={{ background: 'var(--accent-bg)' }}
                  animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.14 }}
                />
              ))}
            </span>
            Thinking
          </p>
        )}
      </div>

      <form
        className={`flex gap-2 ${page ? 'p-3 sm:p-4' : 'p-3'}`}
        style={{ borderTop: '1px solid var(--border)' }}
        onSubmit={(e) => {
          e.preventDefault()
          submit(draft)
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={ready ? 'Ask me to swap, bridge or trade' : 'Assistant not set up'}
          aria-label="Message the assistant"
          disabled={!ready}
          maxLength={1000}
          className="inner min-w-0 flex-1 rounded-xl bg-transparent px-3.5 py-3 text-base outline-none disabled:opacity-50 sm:text-sm"
        />
        <Button type="submit" aria-label="Send" className="px-3.5" disabled={!ready || busy || !draft.trim()}>
          <Send className="size-4" />
        </Button>
      </form>
    </>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl px-3 py-2.5 text-xs text-pretty" style={{ background: 'rgba(232,196,109,0.12)', color: 'var(--warn)' }}>
      {children}
    </p>
  )
}

function Bubble({ item, onNavigate, onReport }: { item: UiItem; onNavigate: () => void; onReport: (t: string) => void }) {
  if (item.kind === 'proposal') return <ProposalCard proposal={item.proposal} onNavigate={onNavigate} onReport={onReport} />
  if (item.kind === 'user')
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm" style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}>
          {item.text}
        </p>
      </div>
    )
  if (item.kind === 'assistant')
    return (
      <p className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm" style={{ background: 'var(--surface-strong)' }}>
        {item.text}
      </p>
    )
  if (item.kind === 'tool')
    return (
      <p className="text-xs" style={{ color: 'var(--subtle)' }}>
        {item.text}...
      </p>
    )
  if (item.kind === 'error')
    return (
      <p className="rounded-xl px-3 py-2.5 text-sm" style={{ background: 'rgba(232,109,122,0.12)', color: 'var(--danger)' }} role="alert">
        {item.text}
      </p>
    )
  return null
}

function ProposalCard({
  proposal,
  onNavigate,
  onReport,
}: {
  proposal: Proposal
  onNavigate: () => void
  onReport: (text: string) => void
}) {
  const [inChat, setInChat] = useState(false)
  const inline = proposal.inline

  if (inChat && inline) {
    return (
      <div className="glass rounded-2xl p-4">
        {inline.kind === 'swap' ? (
          <SwapCard tokenIn={inline.tokenIn} amount={inline.amount} onSettled={onReport} />
        ) : (
          <BridgeCard from={inline.from} to={inline.to} amount={inline.amount} onSettled={onReport} />
        )}
      </div>
    )
  }

  const openPage = () => {
    navigate(proposal.url)
    onNavigate()
  }

  return (
    <div className="glass rounded-2xl p-4">
      <p className="display text-base font-semibold">{proposal.title}</p>
      <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--muted)' }}>
        {proposal.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {inline ? (
        <div className="mt-3 grid gap-2">
          <Button onClick={() => setInChat(true)}>Do it here in chat</Button>
          <Button variant="ghost" onClick={openPage}>
            Open on the {inline.kind === 'swap' ? 'Swap' : 'Bridge'} page <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : (
        <Button className="mt-3 w-full" onClick={openPage}>
          {proposal.cta} <ArrowRight className="size-4" />
        </Button>
      )}
      <p className="mt-2 text-center text-[11px]" style={{ color: 'var(--subtle)' }}>
        Nothing is sent until you confirm and sign in your wallet.
      </p>
    </div>
  )
}
