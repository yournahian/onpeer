import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowUpRight, Send, Sparkles } from 'lucide-react'
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
  'Buy USDC with card (sandbox)',
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
      <div
        ref={listRef}
        className={`flex min-h-0 flex-1 flex-col gap-3 ${items.length > 0 ? 'overflow-y-auto' : 'overflow-hidden'} ${page ? 'px-4 py-4 sm:px-5' : 'px-4 py-3.5'}`}
        aria-live="polite"
      >
        {health.state === 'offline' && (
          <Notice>Assistant service is currently offline. Please try again in a moment.</Notice>
        )}
        {health.state === 'ready' && !health.configured && (
          <Notice>Assistant AI provider is not configured on this server yet.</Notice>
        )}

        {items.length === 0 && (
          <div className={page ? 'mx-auto my-auto w-full max-w-xl' : ''}>
            {page && (
              <div className="mb-3 flex items-center gap-2.5">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 16%, var(--fill-2))',
                    border: '1px solid color-mix(in srgb, var(--accent) 36%, var(--border))',
                    color: 'var(--accent)',
                  }}
                >
                  <Sparkles className="size-4" />
                </span>
                <div>
                  <h2 className="display text-lg font-bold leading-tight sm:text-xl">
                    What would you like to prepare?
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    Ask in plain English—I&apos;ll find rates or prefill the transaction so you can review and sign.
                  </p>
                </div>
              </div>
            )}
            {!page && (
              <p className="text-xs leading-relaxed text-pretty" style={{ color: 'var(--muted)' }}>
                Ask in plain words. I can find P2P ads, check balances and orders, or prepare a swap, bridge, or order
                for your review.
              </p>
            )}

            <div className={`mt-3 grid gap-2 ${page ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!ready}
                  onClick={() => submit(s)}
                  className="group flex items-start justify-between gap-2 rounded-xl px-3.5 py-2.5 text-left text-xs font-medium leading-snug transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--fill-2)] disabled:opacity-45"
                  style={{
                    background: 'var(--fill-1)',
                    border: '1px solid var(--border)',
                    color: 'var(--ink)',
                  }}
                >
                  <span>{s}</span>
                  <ArrowUpRight
                    className="mt-0.5 size-3.5 shrink-0 opacity-50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100"
                    style={{ color: 'var(--accent)' }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
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
                  animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.14 }}
                />
              ))}
            </span>
            Thinking...
          </p>
        )}
      </div>

      <form
        className={`shrink-0 flex items-center gap-2 ${page ? 'px-4 py-3 sm:px-5' : 'p-3'}`}
        style={{ borderTop: '1px solid var(--border)', background: 'var(--fill-1)' }}
        onSubmit={(e) => {
          e.preventDefault()
          submit(draft)
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={ready ? 'Ask to find P2P deals, swap, bridge, or check balances...' : 'Assistant unavailable'}
          aria-label="Message the assistant"
          disabled={!ready}
          maxLength={1000}
          className="inner min-w-0 flex-1 rounded-xl bg-transparent px-3.5 py-2.5 text-sm outline-none disabled:opacity-50"
        />
        <Button
          type="submit"
          aria-label="Send"
          className="h-10 rounded-xl px-3.5"
          disabled={!ready || busy || !draft.trim()}
        >
          <Send className="size-4" />
        </Button>
      </form>
    </>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-xl px-3 py-2 text-xs text-pretty"
      style={{
        background: 'color-mix(in srgb, var(--warn) 14%, var(--fill-1))',
        border: '1px solid color-mix(in srgb, var(--warn) 35%, var(--border))',
        color: 'var(--ink)',
      }}
    >
      {children}
    </p>
  )
}

function Bubble({
  item,
  onNavigate,
  onReport,
}: {
  item: UiItem
  onNavigate: () => void
  onReport: (t: string) => void
}) {
  if (item.kind === 'proposal')
    return <ProposalCard proposal={item.proposal} onNavigate={onNavigate} onReport={onReport} />
  if (item.kind === 'user')
    return (
      <div className="flex justify-end">
        <p
          className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3.5 py-2 text-sm"
          style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}
        >
          {item.text}
        </p>
      </div>
    )
  if (item.kind === 'assistant')
    return (
      <p
        className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md px-3.5 py-2 text-sm leading-relaxed"
        style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
      >
        {item.text}
      </p>
    )
  if (item.kind === 'tool')
    return (
      <p className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>
        {item.text}...
      </p>
    )
  if (item.kind === 'error')
    return (
      <p
        className="rounded-xl px-3 py-2 text-xs"
        style={{
          background: 'rgba(232,109,122,0.12)',
          border: '1px solid rgba(232,109,122,0.3)',
          color: 'var(--danger)',
        }}
        role="alert"
      >
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
      <div
        className="rounded-2xl p-3.5"
        style={{ background: 'var(--fill-1)', border: '1px solid var(--border-strong)' }}
      >
        {inline.kind === 'swap' ? (
          <SwapCard tokenIn={inline.tokenIn} tokenOut={inline.tokenOut} amount={inline.amount} onSettled={onReport} />
        ) : (
          <BridgeCard from={inline.from} to={inline.to} token={inline.token} amount={inline.amount} onSettled={onReport} />
        )}
      </div>
    )
  }

  const openPage = () => {
    navigate(proposal.url)
    onNavigate()
  }

  return (
    <div
      className="rounded-2xl p-3.5"
      style={{ background: 'var(--fill-1)', border: '1px solid var(--border-strong)' }}
    >
      <p className="display text-sm font-bold sm:text-base">{proposal.title}</p>
      <ul className="mt-1.5 space-y-1 text-xs" style={{ color: 'var(--muted)' }}>
        {proposal.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {inline ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Button className="py-2 text-xs" onClick={() => setInChat(true)}>
            Do it here in chat
          </Button>
          <Button variant="ghost" className="py-2 text-xs" onClick={openPage}>
            Open {inline.kind === 'swap' ? 'Swap' : 'Bridge'} page <ArrowRight className="size-3.5" />
          </Button>
        </div>
      ) : (
        <Button className="mt-3 w-full py-2.5 text-xs" onClick={openPage}>
          {proposal.cta} <ArrowRight className="size-3.5" />
        </Button>
      )}
      <p className="mt-2 text-center text-[10px]" style={{ color: 'var(--subtle)' }}>
        Nothing is sent until you confirm and sign in your wallet.
      </p>
    </div>
  )
}
