import { useEffect, useState } from 'react'
import { Maximize2, RotateCcw, Sparkles, X } from 'lucide-react'
import { navigate } from '@/lib/router'
import { useAgentContext } from '@/agent/AgentContext'
import { ChatThread } from '@/components/chat/ChatThread'

/** Floating assistant: always on screen except on the dedicated assistant page. */
export function AgentChat({ route }: { route: string }) {
  const [open, setOpen] = useState(false)
  const { items, health, provider, setProvider, reset } = useAgentContext()
  const onPage = route === 'assistant'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // The page is the assistant, so the floating one steps aside (the conversation is shared).
  if (onPage) return null

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        className={`launcher-ring glow-accent btn-shine fixed right-4 z-[9999] flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-transform duration-200 hover:scale-105 active:scale-95 sm:min-h-12 sm:px-5 ${
          route === 'p2p' ? 'bottom-20 md:bottom-4' : 'bottom-4'
        }`}
        style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}
      >
        {open ? <X className="size-4" /> : <Sparkles className="size-4" />}
        <span className={route === 'p2p' ? 'hidden sm:inline' : ''}>{open ? 'Close' : 'Ask assistant'}</span>
      </button>

      {/* Always mounted so in-progress swaps and bridges survive closing the panel. */}
      <section
        role="dialog"
        aria-label="Assistant"
        hidden={!open}
        className="panel-in fixed inset-x-3 bottom-20 z-[9998] flex h-[min(620px,calc(100dvh-6.5rem))] flex-col overflow-hidden rounded-3xl data-[hidden=true]:hidden sm:inset-x-auto sm:right-4 sm:w-[400px]"
        data-hidden={!open}
        style={{
          background: 'var(--panel-bg)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(40px) saturate(180%)',
          boxShadow: 'var(--panel-shadow)',
        }}
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4" style={{ color: 'var(--accent)' }} />
            <h2 className="display text-base font-semibold">Assistant</h2>
          </div>
          <div className="flex items-center gap-1">
            {health.state === 'ready' && health.providers.length > 1 && (
              <select
                aria-label="AI provider"
                value={provider ?? health.active ?? ''}
                onChange={(e) => setProvider(e.target.value)}
                className="rounded-lg bg-transparent px-2 py-1 text-xs font-semibold outline-none"
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
              <button onClick={reset} aria-label="Clear chat" className="flex size-9 items-center justify-center rounded-full hover:bg-[var(--fill-3)]">
                <RotateCcw className="size-4" />
              </button>
            )}
            <button
              onClick={() => {
                setOpen(false)
                navigate('/assistant')
              }}
              aria-label="Open the full assistant page"
              title="Open full page"
              className="flex size-9 items-center justify-center rounded-full hover:bg-[var(--fill-3)]"
            >
              <Maximize2 className="size-4" />
            </button>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="flex size-9 items-center justify-center rounded-full hover:bg-[var(--fill-3)]">
              <X className="size-4" />
            </button>
          </div>
        </header>
        <ChatThread variant="panel" active={open} onNavigate={() => setOpen(false)} />
      </section>
    </>
  )
}
