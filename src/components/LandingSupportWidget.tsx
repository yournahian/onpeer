import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  LifeBuoy,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  RotateCcw,
  Search,
  SendHorizontal,
  Smile,
  Sparkles,
  X,
} from 'lucide-react'
import { useAgentContext } from '@/agent/AgentContext'
import type { Proposal } from '@/agent/tools'
import type { UiItem } from '@/agent/useAgent'
import { BridgeCard } from '@/components/chat/BridgeCard'
import { SwapCard } from '@/components/chat/SwapCard'
import { LogoMark } from '@/components/Logo'
import { APP_URL, isLandingDomain, navigate } from '@/lib/router'
import { useTheme } from '@/lib/theme'

type WidgetTab = 'home' | 'messages' | 'help'

interface HelpArticle {
  id: string
  title: string
  summary: string
  body: string[]
}

interface HelpCollection {
  id: string
  title: string
  description: string
  articles: HelpArticle[]
}

const HELP_COLLECTIONS: HelpCollection[] = [
  {
    id: 'about',
    title: 'About OnPeer',
    description: 'Discover non-custodial P2P trading, swaps, and bridging on Arc.',
    articles: [
      {
        id: 'what-is-onpeer',
        title: 'What is OnPeer?',
        summary: 'Trade USDC in local South Asian currencies with smart-contract escrow.',
        body: [
          'OnPeer is a non-custodial peer-to-peer marketplace on Arc where you can buy and sell USDC and EURC using local South Asian currencies.',
          'Alongside P2P trading, OnPeer includes instant stablecoin swaps and cross-chain bridging via Circle CCTP & CCTPx in one unified platform.',
        ],
      },
      {
        id: 'usdc-gas',
        title: 'Do I need ETH or another gas token on Arc?',
        summary: 'USDC is the native gas token on Arc.',
        body: [
          'No separate gas token is required. On Arc, USDC itself pays for network gas with sub-second finality and predictable cent-fraction fees.',
          'A single USDC balance covers your trades, swaps, bridges, and transaction fees.',
        ],
      },
      {
        id: 'network-notice',
        title: 'What network does OnPeer run on?',
        summary: 'Arc Mainnet live network details.',
        body: [
          'OnPeer runs live on Arc Mainnet (Chain ID 5042) with USDC as the native gas token. A separate testnet sandbox is also available at testnet.onpeer.xyz.',
          'Never send real mainnet funds or upload real identity documents while testing in sandbox mode.',
        ],
      },
    ],
  },
  {
    id: 'fees',
    title: 'Fees & Pricing',
    description: 'Transparent 0% P2P trade fees, ad listing fees, and swap/bridge quotes.',
    articles: [
      {
        id: 'p2p-fees',
        title: 'Are there any fees for P2P trading?',
        summary: '0% platform fee on P2P orders, chat, and dispute resolution.',
        body: [
          'Taking an existing Buy or Sell ad on OnPeer has a 0% platform trade fee.',
          'Posting a new maker ad carries a flat 0.05 USDC listing fee on-chain to prevent orderbook spam, while refreshing an ad is free.',
        ],
      },
      {
        id: 'swap-bridge-fees',
        title: 'Fees for Swaps and Cross-Chain Bridging',
        summary: 'Review exact quotes and network costs before signing.',
        body: [
          'Every swap and Circle CCTP / CCTPx bridge quote displays the exact expected output and protocol fee upfront before your wallet prompts you to sign.',
        ],
      },
    ],
  },
  {
    id: 'p2p-escrow',
    title: 'P2P Escrow & Local Payments',
    description: 'How smart-contract escrow protects buyers and sellers across South Asia.',
    articles: [
      {
        id: 'how-escrow-works',
        title: 'How does P2P escrow keep my USDC safe?',
        summary: 'Funds lock on-chain before any fiat payment is sent.',
        body: [
          'The seller’s crypto is locked inside the P2PEscrow v2.1 smart contract the moment an order opens.',
          'Once the buyer sends fiat via bKash, Nagad, UPI, IMPS, Raast, JazzCash, Easypaisa, eSewa, or LankaQR and marks the order paid, only the seller’s release or an arbiter ruling can move the escrowed funds.',
        ],
      },
      {
        id: 'supported-corridors',
        title: 'Supported countries and payment methods',
        summary: 'BDT, INR, PKR, LKR, NPR, BTN, MVR & AFN local rails.',
        body: [
          'OnPeer supports Bangladesh (bKash, Nagad, Rocket), India (UPI, IMPS), Pakistan (Raast, JazzCash, Easypaisa), Sri Lanka (LankaQR), Nepal (eSewa, Khalti), and neighboring South Asian corridors.',
          'Always pay from an account registered in your own name so payment proof matches if verification is needed.',
        ],
      },
      {
        id: 'disputes',
        title: 'What if the seller does not release my crypto?',
        summary: 'Encrypted chat evidence and on-chain arbiter resolution.',
        body: [
          'After marking an order as paid, you can file a dispute after 15 minutes with your transfer reference and encrypted receipt.',
          'Both parties can submit evidence in the encrypted order chat, and the on-chain arbiter resolves the escrowed balance directly to the rightful party.',
        ],
      },
    ],
  },
  {
    id: 'wallets-alerts',
    title: 'Wallets, Privacy & Telegram Alerts',
    description: 'Connecting wallets, AES-256-GCM vault encryption, and live notifications.',
    articles: [
      {
        id: 'encrypted-vault',
        title: 'How are payment details and chat messages protected?',
        summary: 'AES-256-GCM envelope encryption with automatic retention cleanup.',
        body: [
          'Payment account details and per-order chat messages are encrypted with AES-256-GCM before storage and revealed only to verified counterparties of that active order.',
        ],
      },
      {
        id: 'telegram-bot',
        title: 'Instant Telegram & Email order notifications',
        summary: 'Link @OnPeerBot or your email from User Center.',
        body: [
          'Open User Center → Notifications in the P2P app to connect Telegram or email in one click.',
          'You will receive instant push alerts with a direct Open Order button whenever an order is opened, marked paid, messaged, or released.',
        ],
      },
    ],
  },
]

const QUICK_ARTICLES: HelpArticle[] = [
  HELP_COLLECTIONS[1].articles[0],
  HELP_COLLECTIONS[2].articles[0],
  HELP_COLLECTIONS[2].articles[1],
  HELP_COLLECTIONS[2].articles[2],
]

/** Friendly smiling speech-bubble icon matching the Intercom launcher aesthetic. */
function LauncherBubbleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 4.5h14A2.5 2.5 0 0 1 21.5 7v9.5A2.5 2.5 0 0 1 19 19h-4.2l-3.9 2.8a.7.7 0 0 1-1.1-.57V19H5A2.5 2.5 0 0 1 2.5 16.5V7A2.5 2.5 0 0 1 5 4.5Z"
        fill="currentColor"
      />
      <path
        d="M8.3 12.6c1.05 1.35 2.3 2 3.7 2s2.65-.65 3.7-2"
        stroke="#ffffff"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  )
}

function HomeTabIcon({ active }: { active: boolean }) {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 10.2 12 4l7.5 6.2v8.3a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-8.3Z"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M9.4 14.1c.75.85 1.62 1.28 2.6 1.28s1.85-.43 2.6-1.28"
        stroke={active ? 'var(--widget-surface)' : 'currentColor'}
        strokeWidth="1.65"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Cute headset AI helper bot avatar matching the Askie/Intercom Fin digital helper style. */
function AiHelperBotAvatar() {
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-[#FF5A00]/12 ring-1 ring-[#FF5A00]/25">
      <svg viewBox="0 0 36 36" className="size-8" fill="none" aria-hidden="true">
        {/* Headset band */}
        <path
          d="M8.5 19a9.5 9.5 0 0 1 19 0"
          stroke="#FF5A00"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        {/* Ear cups */}
        <rect x="6" y="16.5" width="3.5" height="6.5" rx="1.75" fill="#FF5A00" />
        <rect x="26.5" y="16.5" width="3.5" height="6.5" rx="1.75" fill="#FF5A00" />
        {/* Bot head */}
        <rect x="9.5" y="12" width="17" height="14" rx="6.5" fill="#18181b" stroke="#FF5A00" strokeWidth="1.4" />
        {/* Visor eyes */}
        <circle cx="14.8" cy="18.5" r="1.6" fill="#ffffff" />
        <circle cx="21.2" cy="18.5" r="1.6" fill="#ffffff" />
        {/* Friendly smile */}
        <path d="M15.2 22c.8.8 1.75 1.15 2.8 1.15s2-.35 2.8-1.15" stroke="#FF5A00" strokeWidth="1.5" strokeLinecap="round" />
        {/* Mic boom */}
        <path d="M27.5 22.2c-.5 2.6-2.8 4.3-6.2 4.3" stroke="#FF5A00" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="20.8" cy="26.5" r="1.3" fill="#FF5A00" />
      </svg>
    </span>
  )
}

const PANEL_VARIANTS = {
  open: {
    visibility: 'visible' as const,
    opacity: 1,
    scale: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      type: 'spring' as const,
      stiffness: 420,
      damping: 31,
      mass: 0.85,
    },
  },
  closed: {
    opacity: 0,
    scale: 0.88,
    y: 18,
    filter: 'blur(6px)',
    transition: {
      duration: 0.22,
      ease: [0.32, 0, 0.67, 0] as [number, number, number, number],
    },
    transitionEnd: {
      visibility: 'hidden' as const,
    },
  },
}

function ConversationProposalCard({
  proposal,
  onCloseWidget,
  onReport,
  bubbleBg,
  borderCol,
  textPrimary,
  textSecondary,
}: {
  proposal: Proposal
  onCloseWidget: () => void
  onReport: (text: string) => void
  bubbleBg: string
  borderCol: string
  textPrimary: string
  textSecondary: string
}) {
  const [inChat, setInChat] = useState(false)
  const inline = proposal.inline

  if (inChat && inline) {
    return (
      <div className="rounded-2xl p-3.5" style={{ backgroundColor: bubbleBg, border: `1px solid ${borderCol}` }}>
        {inline.kind === 'swap' ? (
          <SwapCard tokenIn={inline.tokenIn} tokenOut={inline.tokenOut} amount={inline.amount} onSettled={onReport} />
        ) : (
          <BridgeCard
            from={inline.from}
            to={inline.to}
            token={inline.token}
            amount={inline.amount}
            onSettled={onReport}
          />
        )}
      </div>
    )
  }

  const openPage = () => {
    if (isLandingDomain()) {
      window.location.href = `${APP_URL}${proposal.url}`
      return
    }
    navigate(proposal.url)
    onCloseWidget()
  }

  return (
    <div
      className="max-w-[92%] rounded-2xl p-3.5"
      style={{ backgroundColor: bubbleBg, border: `1px solid ${borderCol}`, color: textPrimary }}
    >
      <p className="display text-sm font-bold">{proposal.title}</p>
      <ul className="mt-1.5 space-y-1 text-xs" style={{ color: textSecondary }}>
        {proposal.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {inline && !isLandingDomain() ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setInChat(true)}
            className="no-focus-ring rounded-xl bg-[#FF5A00] px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
          >
            Do it here
          </button>
          <button
            type="button"
            onClick={openPage}
            className="no-focus-ring inline-flex items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold"
            style={{ border: `1px solid ${borderCol}`, color: textPrimary }}
          >
            Open page <ArrowRight className="size-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openPage}
          className="no-focus-ring mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#FF5A00] py-2.5 text-xs font-bold text-white transition-opacity hover:opacity-90"
        >
          {proposal.cta} <ArrowRight className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Askie / Fin-style dedicated AI Agent conversation screen (matches Screenshot 2):
 * - Header with `<` back chevron, AI bot headset avatar, `OnPeer AI` + `The team can also help`, `•••` menu & `×` close
 * - Friendly greeting bubbles (`Hey! I'm your digital helper...` + `How can I help?`)
 * - Rounded composer card with `Ask a question...` input, subtle helper icons, and circular `↑` send button
 */
function AskieConversationView({
  active,
  isDark,
  cardSurface,
  inputSurface,
  borderCol,
  textPrimary,
  textSecondary,
  onBack,
  onClose,
}: {
  active: boolean
  isDark: boolean
  cardSurface: string
  inputSurface: string
  borderCol: string
  textPrimary: string
  textSecondary: string
  onBack: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const { items, busy, health, send, reset, refreshHealth, report } = useAgentContext()

  useEffect(() => {
    if (active) refreshHealth()
  }, [active, refreshHealth])

  useEffect(() => {
    const el = listRef.current
    if (!el || !active) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [items, busy, active])

  const ready = health.state === 'loading' || (health.state === 'ready' && health.configured)
  const canSend = draft.trim().length > 0 && !busy && health.state === 'ready' && health.configured

  const submit = () => {
    const trimmed = draft.trim()
    if (!trimmed || busy || health.state !== 'ready' || !health.configured) return
    setDraft('')
    void send(trimmed)
  }

  const assistantBubbleBg = isDark ? '#252730' : '#f2f3f5'

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: cardSurface }}>
      {/* Top Conversation Header */}
      <header
        className="relative flex shrink-0 items-center justify-between gap-2 px-3.5 py-3"
        style={{ borderBottom: `1px solid ${borderCol}` }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="no-focus-ring flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:opacity-75"
            style={{ color: textSecondary }}
          >
            <ChevronLeft className="size-5" />
          </button>

          <AiHelperBotAvatar />

          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold leading-tight" style={{ color: textPrimary }}>
              OnPeer AI
            </h2>
            <p className="truncate text-[11.5px] leading-tight" style={{ color: textSecondary }}>
              The team can also help
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Conversation options"
              className="no-focus-ring flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
              style={{ color: textSecondary }}
            >
              <MoreHorizontal className="size-4" />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full z-20 mt-1 w-48 rounded-2xl p-1.5 shadow-xl"
                style={{
                  backgroundColor: cardSurface,
                  border: `1px solid ${borderCol}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    reset()
                    setMenuOpen(false)
                  }}
                  className="no-focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ color: textPrimary }}
                >
                  <RotateCcw className="size-3.5" style={{ color: '#FF5A00' }} />
                  Clear conversation
                </button>
                <a
                  href="mailto:support@onpeer.xyz?subject=OnPeer%20Human%20Support"
                  onClick={() => setMenuOpen(false)}
                  className="no-focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ color: textPrimary }}
                >
                  <Mail className="size-3.5" style={{ color: '#FF5A00' }} />
                  Email human team
                </a>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close messenger"
            className="no-focus-ring flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
            style={{ color: textSecondary }}
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      {/* Scrollable Messages Stream */}
      <div
        ref={listRef}
        data-lenis-prevent
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-5"
        aria-live="polite"
      >
        {/* Default Welcome Greeting Bubbles (exact match to Screenshot 2) */}
        <div className="flex flex-col items-start">
          <div
            className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3 text-[13.5px] leading-relaxed"
            style={{ backgroundColor: assistantBubbleBg, color: textPrimary }}
          >
            Hey! I’m your digital helper. Ask me anything! And if I ever get stuck, a real human is just a click away.
          </div>
          <div
            className="mt-1.5 rounded-2xl rounded-tl-md px-4 py-2.5 text-[13.5px] leading-relaxed"
            style={{ backgroundColor: assistantBubbleBg, color: textPrimary }}
          >
            How can I help?
          </div>
          <span className="mt-1.5 px-1 text-[11px]" style={{ color: textSecondary }}>
            OnPeer AI • AI Agent • Just now
          </span>
        </div>

        {health.state === 'offline' && (
          <p
            className="rounded-xl px-3.5 py-2.5 text-xs"
            style={{ backgroundColor: assistantBubbleBg, color: textSecondary }}
          >
            Assistant is currently offline. You can reach our human team anytime at{' '}
            <a href="mailto:support@onpeer.xyz" className="font-semibold underline" style={{ color: '#FF5A00' }}>
              support@onpeer.xyz
            </a>
            .
          </p>
        )}

        {items.map((item: UiItem) => {
          if (item.kind === 'user') {
            return (
              <div key={item.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[#FF5A00] px-4 py-2.5 text-[13.5px] leading-relaxed text-white">
                  {item.text}
                </p>
              </div>
            )
          }
          if (item.kind === 'assistant') {
            return (
              <div key={item.id} className="flex flex-col items-start">
                <p
                  className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md px-4 py-3 text-[13.5px] leading-relaxed"
                  style={{ backgroundColor: assistantBubbleBg, color: textPrimary }}
                >
                  {item.text}
                </p>
                <span className="mt-1 px-1 text-[11px]" style={{ color: textSecondary }}>
                  OnPeer AI • AI Agent
                </span>
              </div>
            )
          }
          if (item.kind === 'proposal') {
            return (
              <ConversationProposalCard
                key={item.id}
                proposal={item.proposal}
                onCloseWidget={onClose}
                onReport={report}
                bubbleBg={assistantBubbleBg}
                borderCol={borderCol}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
              />
            )
          }
          if (item.kind === 'tool') {
            return (
              <p key={item.id} className="px-1 text-xs font-medium" style={{ color: textSecondary }}>
                {item.text}…
              </p>
            )
          }
          if (item.kind === 'error') {
            return (
              <p
                key={item.id}
                role="alert"
                className="rounded-xl px-3.5 py-2 text-xs text-red-400"
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
              >
                {item.text}
              </p>
            )
          }
          return null
        })}

        {busy && (
          <div className="flex items-center gap-1.5 px-1 text-xs" style={{ color: textSecondary }}>
            <span className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map((d) => (
                <motion.span
                  key={d}
                  className="size-1.5 rounded-full bg-[#FF5A00]"
                  animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.14 }}
                />
              ))}
            </span>
            <span>Thinking…</span>
          </div>
        )}
      </div>

      {/* Bottom Rounded Composer Card (matches Screenshot 2) */}
      <form
        className="shrink-0 px-3.5 pb-3.5 pt-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div
          className="rounded-2xl px-3.5 pb-2.5 pt-3 transition-colors"
          style={{
            backgroundColor: isDark ? inputSurface : '#ffffff',
            border: `1px solid ${draft.trim() ? '#FF5A00' : borderCol}`,
          }}
        >
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            disabled={!ready}
            maxLength={1000}
            placeholder={ready ? 'Ask a question...' : 'Assistant unavailable'}
            aria-label="Ask a question"
            className="no-focus-ring block max-h-24 w-full resize-none bg-transparent text-[13.5px] leading-snug outline-none disabled:opacity-50"
            style={{ color: textPrimary }}
          />

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2.5" style={{ color: textSecondary }}>
              <a
                href="mailto:support@onpeer.xyz?subject=OnPeer%20Support%20Attachment"
                title="Send attachment via email support"
                aria-label="Send attachment to support"
                className="no-focus-ring transition-opacity hover:opacity-80"
              >
                <Paperclip className="size-4" />
              </a>
              <button
                type="button"
                title="Insert wave"
                aria-label="Insert wave emoji"
                onClick={() => setDraft((prev) => `${prev}${prev ? ' ' : ''}👋`)}
                className="no-focus-ring transition-opacity hover:opacity-80"
              >
                <Smile className="size-4" />
              </button>
            </div>

            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              className="no-focus-ring flex size-8 items-center justify-center rounded-full transition-all duration-150"
              style={{
                backgroundColor: canSend ? '#FF5A00' : isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb',
                color: canSend ? '#ffffff' : textSecondary,
              }}
            >
              <ArrowUp className="size-4 stroke-[2.3]" />
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

/**
 * Intercom-style Home / Messages / Help support & AI assistant messenger
 * rendered exclusively on the Landing site (`onpeer.xyz` / Home).
 */
export function LandingSupportWidget() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<WidgetTab>('home')
  const [chatStarted, setChatStarted] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null)

  const { items } = useAgentContext()
  const { resolved } = useTheme()
  const isDark = resolved === 'dark'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const inConversation = tab === 'messages' && (chatStarted || items.length > 0)

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null
    const results: HelpArticle[] = []
    for (const col of HELP_COLLECTIONS) {
      for (const art of col.articles) {
        if (
          art.title.toLowerCase().includes(q) ||
          art.summary.toLowerCase().includes(q) ||
          art.body.some((p) => p.toLowerCase().includes(q))
        ) {
          results.push(art)
        }
      }
    }
    return results
  }, [searchQuery])

  const activeCollection = useMemo(
    () => HELP_COLLECTIONS.find((c) => c.id === selectedCollectionId) ?? null,
    [selectedCollectionId],
  )

  const openArticle = (article: HelpArticle) => {
    setSelectedArticle(article)
    setTab('help')
  }

  const startConversation = () => {
    setSelectedArticle(null)
    setChatStarted(true)
    setTab('messages')
  }

  const widgetSurface = isDark ? '#121317' : '#f5f6f8'
  const cardSurface = isDark ? '#1b1c22' : '#ffffff'
  const inputSurface = isDark ? '#252730' : '#f1f2f5'
  const rowHoverBg = isDark ? 'rgba(255, 255, 255, 0.045)' : 'rgba(15, 23, 42, 0.035)'
  const borderCol = isDark ? 'rgba(255, 255, 255, 0.085)' : 'rgba(15, 23, 42, 0.075)'
  const textPrimary = isDark ? '#f5f5f7' : '#111827'
  const textSecondary = isDark ? '#9ca3af' : '#6b7280'
  const cardShadow = isDark
    ? '0 10px 28px -10px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
    : '0 8px 24px -8px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04)'

  return (
    <>
      {/* Smoothly animated Messenger Panel — stays mounted so active AI streams persist */}
      <motion.section
        role="dialog"
        aria-label="OnPeer Help & Assistant"
        aria-hidden={!open}
        data-lenis-prevent
        initial={false}
        animate={open ? 'open' : 'closed'}
        variants={PANEL_VARIANTS}
        onWheel={(e) => e.stopPropagation()}
        className={`fixed inset-x-3 bottom-20 z-40 flex h-[min(636px,calc(100dvh-6.25rem))] flex-col overflow-hidden rounded-[28px] sm:inset-x-auto sm:right-5 sm:w-[392px] ${
          open ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        style={{
          ['--widget-surface' as string]: cardSurface,
          transformOrigin: 'calc(100% - 28px) calc(100% + 14px)',
          backgroundColor: widgetSurface,
          border: `1px solid ${borderCol}`,
          boxShadow: isDark
            ? '0 28px 72px -8px rgba(0, 0, 0, 0.82), 0 0 0 1px rgba(255, 255, 255, 0.07)'
            : '0 24px 64px -8px rgba(15, 23, 42, 0.22), 0 4px 16px rgba(15, 23, 42, 0.06)',
          color: textPrimary,
        }}
      >
        {/* ==================== TAB 1: HOME ==================== */}
        {tab === 'home' && (
          <div
            data-lenis-prevent
            className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
          >
            {/* Pure Solid #FF5A00 Brand Orange Backdrop with smooth bottom edge transition */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[256px]"
              style={{
                background: `linear-gradient(180deg, #FF5A00 0%, #FF5A00 76%, ${widgetSurface} 100%)`,
              }}
            />

            {/* Foreground Home Content (`relative z-10`) */}
            <div className="relative z-10 flex flex-col px-4 pb-5 pt-5">
              {/* Top Bar: Logo on left, Close X on right (avatars removed) */}
              <div className="flex items-center justify-between px-1.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-xl bg-white/15 p-0.5">
                    <LogoMark size={28} />
                  </span>
                  <span className="display text-lg font-bold tracking-tight text-white">
                    OnPeer
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close messenger"
                  className="no-focus-ring flex size-8 items-center justify-center rounded-full text-white/95 transition-colors hover:bg-black/15 hover:text-white"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Greeting */}
              <div className="mt-7 mb-5 px-1.5">
                <p className="text-lg font-medium text-white/90">Hi there 👋</p>
                <h2 className="display mt-0.5 text-[26px] font-bold leading-tight tracking-tight text-white">
                  How can we help?
                </h2>
              </div>

              {/* Cards Stack */}
              <div className="flex flex-col gap-3">
                {/* Card 1: Search for help + Quick Articles */}
                <div
                  className="rounded-2xl p-3"
                  style={{
                    backgroundColor: cardSurface,
                    border: `1px solid ${borderCol}`,
                    boxShadow: cardShadow,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedArticle(null)
                      setSelectedCollectionId(null)
                      setTab('help')
                    }}
                    className="no-focus-ring group flex h-10 w-full items-center justify-between rounded-xl px-3.5 text-left text-xs font-semibold transition-colors"
                    style={{ backgroundColor: inputSurface, color: textPrimary }}
                  >
                    <span>Search for help</span>
                    <Search
                      className="size-4 transition-transform duration-200 group-hover:scale-110"
                      style={{ color: '#FF5A00' }}
                    />
                  </button>

                  <ul className="mt-2 space-y-0.5">
                    {QUICK_ARTICLES.map((art) => (
                      <li key={art.id}>
                        <button
                          type="button"
                          onClick={() => openArticle(art)}
                          className="no-focus-ring group flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2.5 text-left text-xs font-medium transition-colors"
                          style={{ color: textPrimary }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = rowHoverBg
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent'
                          }}
                        >
                          <span className="line-clamp-1">{art.title}</span>
                          <ChevronRight
                            className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
                            style={{ color: textSecondary }}
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Card 2: Ask a question (Live AI Agent) */}
                <button
                  type="button"
                  onClick={startConversation}
                  className="no-focus-ring group flex w-full items-center justify-between gap-3 rounded-2xl p-3.5 text-left transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
                  style={{
                    backgroundColor: cardSurface,
                    border: `1px solid ${borderCol}`,
                    boxShadow: cardShadow,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#FF5A00] text-white">
                      <Sparkles className="size-4" />
                    </span>
                    <div>
                      <p className="text-xs font-bold" style={{ color: textPrimary }}>
                        Ask a question
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: textSecondary }}>
                        AI Agent and team can help
                      </p>
                    </div>
                  </div>
                  <SendHorizontal
                    className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
                    style={{ color: '#FF5A00' }}
                  />
                </button>

                {/* Card 3: Create a support ticket */}
                <a
                  href="mailto:support@onpeer.xyz?subject=OnPeer%20Support%20Request"
                  className="no-focus-ring group flex items-center justify-between gap-3 rounded-2xl p-3.5 transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
                  style={{
                    backgroundColor: cardSurface,
                    border: `1px solid ${borderCol}`,
                    boxShadow: cardShadow,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                      style={{ backgroundColor: inputSurface, color: '#FF5A00' }}
                    >
                      <LifeBuoy className="size-4" />
                    </span>
                    <div>
                      <p className="text-xs font-bold" style={{ color: textPrimary }}>
                        Create a support ticket
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: textSecondary }}>
                        Order, KYC or payment issue • support@onpeer.xyz
                      </p>
                    </div>
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
                    style={{ color: textSecondary }}
                  />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: MESSAGES ==================== */}
        {tab === 'messages' &&
          (inConversation ? (
            <AskieConversationView
              active={open && tab === 'messages'}
              isDark={isDark}
              cardSurface={cardSurface}
              inputSurface={inputSurface}
              borderCol={borderCol}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
              onBack={() => {
                if (items.length === 0) setChatStarted(false)
                else setTab('home')
              }}
              onClose={() => setOpen(false)}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: cardSurface }}>
              <header
                className="flex shrink-0 items-center justify-between px-4 py-3.5"
                style={{ borderBottom: `1px solid ${borderCol}` }}
              >
                <div className="w-8" />
                <h2 className="text-sm font-bold">Messages</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close messenger"
                  className="no-focus-ring flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
                  style={{ color: textSecondary }}
                >
                  <X className="size-4" />
                </button>
              </header>

              <div
                data-lenis-prevent
                className="flex flex-1 flex-col items-center justify-between overflow-y-auto overscroll-contain px-6 py-10 text-center"
              >
                <div className="my-auto flex flex-col items-center">
                  <span
                    className="flex size-14 items-center justify-center rounded-2xl p-3.5"
                    style={{ backgroundColor: inputSurface, color: '#FF5A00' }}
                  >
                    <MessageSquareText className="size-6" />
                  </span>
                  <h3 className="mt-4 text-base font-bold">No messages</h3>
                  <p className="mt-1.5 max-w-[240px] text-xs leading-relaxed" style={{ color: textSecondary }}>
                    Messages from the AI assistant and team will be shown here
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setChatStarted(true)}
                  className="no-focus-ring inline-flex h-10 items-center gap-2 rounded-full bg-[#FF5A00] px-5 text-xs font-bold text-white shadow-md transition-transform hover:scale-[1.03] active:scale-[0.98]"
                >
                  <span>Ask a question</span>
                  <Sparkles className="size-3.5" />
                </button>
              </div>
            </div>
          ))}

        {/* ==================== TAB 3: HELP ==================== */}
        {tab === 'help' && (
          <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: cardSurface }}>
            <header
              className="flex shrink-0 items-center justify-between px-4 py-3.5"
              style={{ borderBottom: `1px solid ${borderCol}` }}
            >
              <div className="flex w-10 items-center">
                {(selectedArticle || activeCollection) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedArticle) setSelectedArticle(null)
                      else setSelectedCollectionId(null)
                    }}
                    aria-label="Back"
                    className="no-focus-ring flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
                    style={{ color: textSecondary }}
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                )}
              </div>

              <h2 className="text-sm font-bold">Help</h2>

              <div className="flex w-10 items-center justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close messenger"
                  className="no-focus-ring flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
                  style={{ color: textSecondary }}
                >
                  <X className="size-4" />
                </button>
              </div>
            </header>

            {!selectedArticle && (
              <div className="shrink-0 px-4 py-3" style={{ borderBottom: `1px solid ${borderCol}` }}>
                <div
                  className="flex h-10 items-center gap-2 rounded-xl px-3.5"
                  style={{ backgroundColor: inputSurface }}
                >
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for help"
                    aria-label="Search help articles"
                    className="no-focus-ring min-w-0 flex-1 bg-transparent text-xs outline-none"
                    style={{ color: textPrimary }}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      className="no-focus-ring"
                      style={{ color: textSecondary }}
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : (
                    <Search className="size-4 shrink-0" style={{ color: '#FF5A00' }} />
                  )}
                </div>
              </div>
            )}

            <div
              data-lenis-prevent
              className="flex-1 overflow-y-auto overscroll-contain px-4 py-3"
            >
              {selectedArticle ? (
                <article className="space-y-3 py-1">
                  <h3 className="display text-base font-bold leading-snug">{selectedArticle.title}</h3>
                  {selectedArticle.body.map((p, idx) => (
                    <p key={idx} className="text-xs leading-relaxed" style={{ color: textSecondary }}>
                      {p}
                    </p>
                  ))}
                  <div
                    className="mt-5 rounded-2xl p-3.5"
                    style={{ backgroundColor: inputSurface, border: `1px solid ${borderCol}` }}
                  >
                    <p className="text-xs font-semibold">Still have questions?</p>
                    <button
                      type="button"
                      onClick={startConversation}
                      className="no-focus-ring mt-2 inline-flex items-center gap-1.5 text-xs font-bold"
                      style={{ color: '#FF5A00' }}
                    >
                      Ask OnPeer AI <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                </article>
              ) : filteredArticles ? (
                <div>
                  <p className="mb-2 text-xs font-bold" style={{ color: textSecondary }}>
                    {filteredArticles.length} {filteredArticles.length === 1 ? 'result' : 'results'}
                  </p>
                  {filteredArticles.length === 0 ? (
                    <p className="py-8 text-center text-xs" style={{ color: textSecondary }}>
                      No matching articles. Try asking OnPeer AI in Messages!
                    </p>
                  ) : (
                    <ul className="divide-y" style={{ borderColor: borderCol }}>
                      {filteredArticles.map((art) => (
                        <li key={art.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedArticle(art)}
                            className="no-focus-ring group flex w-full items-center justify-between gap-3 rounded-xl px-2 py-3 text-left transition-colors"
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = rowHoverBg
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                            }}
                          >
                            <div>
                              <p className="text-xs font-bold">{art.title}</p>
                              <p className="mt-0.5 text-xs" style={{ color: textSecondary }}>
                                {art.summary}
                              </p>
                            </div>
                            <ChevronRight
                              className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
                              style={{ color: textSecondary }}
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : activeCollection ? (
                <div>
                  <p className="text-xs font-bold">{activeCollection.title}</p>
                  <p className="mt-0.5 mb-3 text-xs" style={{ color: textSecondary }}>
                    {activeCollection.description}
                  </p>
                  <ul className="divide-y" style={{ borderColor: borderCol }}>
                    {activeCollection.articles.map((art) => (
                      <li key={art.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedArticle(art)}
                          className="no-focus-ring group flex w-full items-center justify-between gap-3 rounded-xl px-2 py-3 text-left transition-colors"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = rowHoverBg
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent'
                          }}
                        >
                          <div>
                            <p className="text-xs font-bold">{art.title}</p>
                            <p className="mt-0.5 text-xs" style={{ color: textSecondary }}>
                              {art.summary}
                            </p>
                          </div>
                          <ChevronRight
                            className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
                            style={{ color: textSecondary }}
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-xs font-bold">{HELP_COLLECTIONS.length} collections</p>
                  <ul className="divide-y" style={{ borderColor: borderCol }}>
                    {HELP_COLLECTIONS.map((col) => (
                      <li key={col.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedCollectionId(col.id)}
                          className="no-focus-ring group flex w-full items-center justify-between gap-3 rounded-xl px-2 py-3.5 text-left transition-colors"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = rowHoverBg
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent'
                          }}
                        >
                          <div>
                            <p className="text-xs font-bold">{col.title}</p>
                            <p className="mt-1 text-xs leading-relaxed" style={{ color: textSecondary }}>
                              {col.description}
                            </p>
                            <p className="mt-1.5 text-[11px] font-medium" style={{ color: '#FF5A00' }}>
                              {col.articles.length} articles
                            </p>
                          </div>
                          <ChevronRight
                            className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
                            style={{ color: textSecondary }}
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== BOTTOM NAVIGATION BAR (hidden during active Askie chat) ==================== */}
        {!inConversation && (
          <nav
            aria-label="Messenger sections"
            className="grid shrink-0 grid-cols-3 py-1.5"
            style={{
              backgroundColor: cardSurface,
              borderTop: `1px solid ${borderCol}`,
            }}
          >
            {(
              [
                { id: 'home', label: 'Home' },
                { id: 'messages', label: 'Messages' },
                { id: 'help', label: 'Help' },
              ] as const
            ).map((item) => {
              const active = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'help') setSelectedArticle(null)
                    setTab(item.id)
                  }}
                  className="no-focus-ring relative flex flex-col items-center justify-center gap-1 py-1.5 text-[11px] font-semibold transition-colors"
                  style={{ color: active ? '#FF5A00' : textSecondary }}
                >
                  {active && (
                    <motion.span
                      layoutId="landing-messenger-tab-bar"
                      transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                      className="absolute top-0 h-[2px] w-10 rounded-full bg-[#FF5A00]"
                    />
                  )}
                  {item.id === 'home' ? (
                    <HomeTabIcon active={active} />
                  ) : item.id === 'messages' ? (
                    <MessageSquareText className="size-5" />
                  ) : (
                    <HelpCircle className="size-5" />
                  )}
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        )}
      </motion.section>

      {/* Smoothly morphing Circular Floating Launcher Button */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Minimize support messenger' : 'Open support & AI assistant'}
        aria-expanded={open}
        className="no-focus-ring fixed bottom-4 right-4 z-40 flex size-12 items-center justify-center rounded-full bg-white text-[#151515] sm:bottom-5 sm:right-5 sm:size-14"
        style={{
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(0, 0, 0, 0.06)',
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="chevron"
              initial={{ opacity: 0, rotate: -65, scale: 0.65 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 65, scale: 0.65 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center justify-center"
            >
              <ChevronDown className="size-6 stroke-[2.3]" />
            </motion.span>
          ) : (
            <motion.span
              key="bubble"
              initial={{ opacity: 0, rotate: 65, scale: 0.65 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: -65, scale: 0.65 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center justify-center"
            >
              <LauncherBubbleIcon className="size-6" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </>
  )
}
