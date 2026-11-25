import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  LifeBuoy,
  MessageSquareText,
  RotateCcw,
  Search,
  SendHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { useAgentContext } from '@/agent/AgentContext'
import { ChatThread } from '@/components/chat/ChatThread'
import { LogoMark } from '@/components/Logo'
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
          'OnPeer is a non-custodial peer-to-peer marketplace on Arc where you can buy and sell USDC, EURC, cirBTC, and WETH using local South Asian currencies.',
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
        id: 'testnet-notice',
        title: 'Is OnPeer currently on Testnet?',
        summary: 'Arc Testnet sandbox environment details.',
        body: [
          'Yes. OnPeer currently runs on Arc Testnet (Chain ID 5042002) using test tokens only.',
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

/** Crisp illustrated avatar stack for the Home header (2 team portraits + live AI badge). */
function SupportAvatarCluster() {
  return (
    <div className="flex items-center -space-x-2" aria-hidden="true">
      {/* Specialist Avatar 1 */}
      <span className="relative flex size-8 items-center justify-center overflow-hidden rounded-full bg-[#fde68a] ring-2 ring-white/90 shadow-sm">
        <svg viewBox="0 0 32 32" className="size-8">
          <rect width="32" height="32" fill="#ffedd5" />
          <circle cx="16" cy="12.5" r="5.5" fill="#ea580c" />
          <path d="M7 29c1.4-5.4 5-8.2 9-8.2s7.6 2.8 9 8.2" fill="#9a3412" />
          <circle cx="16" cy="13" r="4.6" fill="#fdba74" />
          <path d="M11.2 11.8c.8-2.9 3.1-4.3 5.5-4.1 2.2.2 3.8 1.5 4.2 3.8-1.5-.8-3.1-1.1-4.9-1-1.8.1-3.4.5-4.8 1.3Z" fill="#431407" />
        </svg>
      </span>

      {/* Specialist Avatar 2 */}
      <span className="relative flex size-8 items-center justify-center overflow-hidden rounded-full bg-[#dbeafe] ring-2 ring-white/90 shadow-sm">
        <svg viewBox="0 0 32 32" className="size-8">
          <rect width="32" height="32" fill="#e0e7ff" />
          <path d="M7.5 29c1.3-5.2 4.8-8 8.5-8s7.2 2.8 8.5 8" fill="#1e293b" />
          <circle cx="16" cy="13" r="4.7" fill="#fed7aa" />
          <path d="M11 12.5c.4-3.3 2.6-5.2 5.3-5.2 2.8 0 4.8 1.9 5.1 5.1-1.4-1.1-3.1-1.6-5.1-1.6-2 0-3.8.6-5.3 1.7Z" fill="#0f172a" />
        </svg>
      </span>

      {/* Live AI Agent Avatar with emerald status indicator */}
      <span className="relative flex size-8 items-center justify-center rounded-full bg-[#141417] text-white ring-2 ring-white/90 shadow-sm">
        <Sparkles className="size-3.5 text-[#FF5A00]" />
        <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-[#d94b00]" />
      </span>
    </div>
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

  const { items, reset } = useAgentContext()
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

  const showChatThread = chatStarted || items.length > 0

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
            {/* Layered Ambient Brand Gradient Backdrop (sits BEHIND content so nothing ever clips) */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[272px]"
              style={{
                background: isDark
                  ? 'radial-gradient(120% 90% at 15% 0%, #ff8533 0%, #FF5A00 42%, rgba(224, 78, 0, 0.42) 72%, rgba(18, 19, 23, 0) 100%)'
                  : 'radial-gradient(120% 90% at 15% 0%, #ff7a2e 0%, #FF5A00 48%, rgba(255, 122, 46, 0.28) 76%, rgba(245, 246, 248, 0) 100%)',
              }}
            />
            {/* Subtle top glass mesh highlight */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[180px] opacity-25"
              style={{
                backgroundImage:
                  'radial-gradient(rgba(255, 255, 255, 0.45) 1px, transparent 1px)',
                backgroundSize: '18px 18px',
                maskImage: 'linear-gradient(to bottom, black 10%, transparent 90%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 10%, transparent 90%)',
              }}
            />

            {/* Foreground Home Content (`relative z-10` — never covered by backdrop) */}
            <div className="relative z-10 flex flex-col px-4 pb-5 pt-5">
              {/* Top Bar */}
              <div className="flex items-center justify-between px-1.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-xl bg-white/20 p-0.5 shadow-sm backdrop-blur-md ring-1 ring-white/30">
                    <LogoMark size={28} />
                  </span>
                  <span className="display text-lg font-bold tracking-tight text-white drop-shadow-sm">
                    OnPeer
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <SupportAvatarCluster />
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close messenger"
                    className="no-focus-ring flex size-8 items-center justify-center rounded-full bg-black/15 text-white/95 backdrop-blur-sm transition-colors hover:bg-black/28 hover:text-white"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              {/* Greeting */}
              <div className="mt-7 mb-5 px-1.5">
                <p className="text-lg font-medium text-white/88">Hi there 👋</p>
                <h2 className="display mt-0.5 text-[26px] font-bold leading-tight tracking-tight text-white drop-shadow-sm">
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
                      style={{ color: 'var(--accent)' }}
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
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
                      style={{ background: 'var(--accent-bg)' }}
                    >
                      <Sparkles className="size-4" />
                    </span>
                    <div>
                      <p className="text-xs font-bold" style={{ color: textPrimary }}>
                        Ask a question
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: textSecondary }}>
                        AI Agent and team can help instantly
                      </p>
                    </div>
                  </div>
                  <SendHorizontal
                    className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
                    style={{ color: 'var(--accent)' }}
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
                      style={{ backgroundColor: inputSurface, color: 'var(--accent)' }}
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

                {/* Subtle Live Status Card */}
                <div
                  className="flex items-center justify-between rounded-2xl px-4 py-3 text-[11px] font-medium"
                  style={{
                    backgroundColor: cardSurface,
                    border: `1px solid ${borderCol}`,
                  }}
                >
                  <span className="flex items-center gap-2" style={{ color: textSecondary }}>
                    <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                    Arc Testnet Escrow &amp; CCTP Bridge operational
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: MESSAGES ==================== */}
        {tab === 'messages' && (
          <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: cardSurface }}>
            <header
              className="flex shrink-0 items-center justify-between px-4 py-3.5"
              style={{ borderBottom: `1px solid ${borderCol}` }}
            >
              <div className="flex w-16 items-center">
                {showChatThread && (
                  <button
                    type="button"
                    onClick={() => {
                      if (items.length === 0) setChatStarted(false)
                      else setTab('home')
                    }}
                    aria-label="Back"
                    className="no-focus-ring flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
                    style={{ color: textSecondary }}
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                )}
              </div>

              <h2 className="text-sm font-bold">Messages</h2>

              <div className="flex w-16 items-center justify-end gap-1">
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      reset()
                      setChatStarted(false)
                    }}
                    aria-label="Clear conversation"
                    title="Clear chat"
                    className="no-focus-ring flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
                    style={{ color: textSecondary }}
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                )}
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

            {showChatThread ? (
              <ChatThread variant="panel" active={open && tab === 'messages'} onNavigate={() => setOpen(false)} />
            ) : (
              <div
                data-lenis-prevent
                className="flex flex-1 flex-col items-center justify-between overflow-y-auto overscroll-contain px-6 py-10 text-center"
              >
                <div className="my-auto flex flex-col items-center">
                  <span
                    className="flex size-14 items-center justify-center rounded-2xl p-3.5"
                    style={{ backgroundColor: inputSurface, color: 'var(--accent)' }}
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
                  className="no-focus-ring btn-shine inline-flex h-10 items-center gap-2 rounded-full px-5 text-xs font-bold text-white shadow-md transition-transform hover:scale-[1.03] active:scale-[0.98]"
                  style={{ background: 'var(--accent-bg)' }}
                >
                  <span>Ask a question</span>
                  <Sparkles className="size-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

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
                    <Search className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
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
                      style={{ color: 'var(--accent)' }}
                    >
                      Ask our AI Assistant <ChevronRight className="size-3.5" />
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
                      No matching articles. Try asking our AI Assistant in Messages!
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
                            <p className="mt-1.5 text-[11px] font-medium" style={{ color: 'var(--accent)' }}>
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

        {/* ==================== BOTTOM NAVIGATION BAR ==================== */}
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
                style={{ color: active ? 'var(--accent)' : textSecondary }}
              >
                {active && (
                  <motion.span
                    layoutId="landing-messenger-tab-bar"
                    transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                    className="absolute top-0 h-[2px] w-10 rounded-full"
                    style={{ backgroundColor: 'var(--accent)' }}
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
