import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  HelpCircle,
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
  HELP_COLLECTIONS[1].articles[0], // Are there any fees for P2P trading?
  HELP_COLLECTIONS[2].articles[0], // How does P2P escrow keep my USDC safe?
  HELP_COLLECTIONS[2].articles[1], // Supported countries and payment methods
  HELP_COLLECTIONS[2].articles[2], // What if the seller does not release my crypto?
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
        stroke="var(--launcher-smile, #ffffff)"
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

  const widgetSurface = isDark ? '#141417' : '#f7f7f9'
  const cardSurface = isDark ? '#1e1f24' : '#ffffff'
  const inputSurface = isDark ? '#27282f' : '#f2f3f5'
  const borderCol = isDark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(17, 24, 39, 0.08)'
  const textPrimary = isDark ? '#f5f5f7' : '#111827'
  const textSecondary = isDark ? '#9ca3af' : '#6b7280'

  return (
    <>
      {/* Floating Messenger Panel — stays mounted when closed so active AI streams persist */}
      <section
        role="dialog"
        aria-label="OnPeer Help & Assistant"
        hidden={!open}
        data-hidden={!open}
        className="panel-in fixed inset-x-3 bottom-20 z-40 flex h-[min(630px,calc(100dvh-6.25rem))] flex-col overflow-hidden rounded-[26px] data-[hidden=true]:hidden sm:inset-x-auto sm:right-5 sm:w-[388px]"
        style={{
          ['--widget-surface' as string]: cardSurface,
          backgroundColor: widgetSurface,
          border: `1px solid ${borderCol}`,
          boxShadow: isDark
            ? '0 24px 64px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(255, 255, 255, 0.06)'
            : '0 20px 56px rgba(15, 23, 42, 0.18), 0 2px 10px rgba(15, 23, 42, 0.06)',
          color: textPrimary,
        }}
      >
        {/* ==================== TAB 1: HOME ==================== */}
        {tab === 'home' && (
          <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
            {/* Brand Orange Hero Header */}
            <div
              className="relative shrink-0 px-6 pb-14 pt-5"
              style={{
                background: isDark
                  ? 'linear-gradient(180deg, #FF5A00 0%, #d94b00 62%, #141417 100%)'
                  : 'linear-gradient(180deg, #FF5A00 0%, #ff7a2e 65%, #f7f7f9 100%)',
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-white/15 p-0.5 backdrop-blur-sm">
                    <LogoMark size={28} />
                  </span>
                  <span className="display text-lg font-bold tracking-tight text-white">OnPeer</span>
                </div>

                <div className="flex items-center gap-2.5">
                  {/* Support & AI team badges */}
                  <div className="flex -space-x-2" aria-hidden="true">
                    <span className="flex size-7 items-center justify-center rounded-full bg-[#151515] text-[11px] font-bold text-white ring-2 ring-white/80">
                      AI
                    </span>
                    <span className="flex size-7 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-[#9a3412] ring-2 ring-white/80">
                      OP
                    </span>
                    <span className="flex size-7 items-center justify-center rounded-full bg-orange-50 text-[11px] font-bold text-[#c2410c] ring-2 ring-white/80">
                      24/7
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close messenger"
                    className="flex size-8 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-black/15 hover:text-white"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              <div className="mt-7">
                <p className="text-xl font-semibold text-white/85">Hi there 👋</p>
                <h2 className="display mt-0.5 text-2xl font-bold tracking-tight text-white sm:text-[26px]">
                  How can we help?
                </h2>
              </div>
            </div>

            {/* Cards Stack overlapping hero gradient */}
            <div className="-mt-9 flex flex-col gap-3 px-4 pb-4">
              {/* Card 1: Search + Top Questions */}
              <div
                className="rounded-2xl p-3 shadow-sm"
                style={{ backgroundColor: cardSurface, border: `1px solid ${borderCol}` }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedArticle(null)
                    setSelectedCollectionId(null)
                    setTab('help')
                  }}
                  className="flex h-10 w-full items-center justify-between rounded-xl px-3.5 text-left text-xs font-medium transition-opacity hover:opacity-90"
                  style={{ backgroundColor: inputSurface, color: textPrimary }}
                >
                  <span>Search for help</span>
                  <Search className="size-4" style={{ color: 'var(--accent)' }} />
                </button>

                <ul className="mt-1.5 divide-y" style={{ borderColor: borderCol }}>
                  {QUICK_ARTICLES.map((art) => (
                    <li key={art.id}>
                      <button
                        type="button"
                        onClick={() => openArticle(art)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left text-xs font-medium transition-colors hover:opacity-80"
                        style={{ color: textSecondary }}
                      >
                        <span className="line-clamp-1" style={{ color: textPrimary }}>
                          {art.title}
                        </span>
                        <ChevronRight className="size-4 shrink-0" style={{ color: textSecondary }} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Card 2: Support Ticket / Email */}
              <a
                href="mailto:support@onpeer.xyz?subject=OnPeer%20Support%20Request"
                className="flex items-center justify-between rounded-2xl px-4 py-3.5 shadow-sm transition-transform active:scale-[0.99]"
                style={{ backgroundColor: cardSurface, border: `1px solid ${borderCol}` }}
              >
                <div>
                  <p className="text-xs font-bold" style={{ color: textPrimary }}>
                    Create a support ticket
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: textSecondary }}>
                    Order, KYC or payment issue • support@onpeer.xyz
                  </p>
                </div>
                <AlertTriangle className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
              </a>

              {/* Card 3: Ask a question (AI Agent) */}
              <button
                type="button"
                onClick={startConversation}
                className="flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left shadow-sm transition-transform active:scale-[0.99]"
                style={{ backgroundColor: cardSurface, border: `1px solid ${borderCol}` }}
              >
                <div>
                  <p className="text-xs font-bold" style={{ color: textPrimary }}>
                    Ask a question
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: textSecondary }}>
                    AI Agent and team can help
                  </p>
                </div>
                <SendHorizontal className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
              </button>
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
                    className="flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
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
                    className="flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
                    style={{ color: textSecondary }}
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close messenger"
                  className="flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
                  style={{ color: textSecondary }}
                >
                  <X className="size-4" />
                </button>
              </div>
            </header>

            {showChatThread ? (
              <ChatThread variant="panel" active={open && tab === 'messages'} onNavigate={() => setOpen(false)} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-between px-6 py-10 text-center">
                <div className="my-auto flex flex-col items-center">
                  <span
                    className="flex size-12 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: inputSurface, color: textPrimary }}
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
                  className="inline-flex h-10 items-center gap-2 rounded-full px-5 text-xs font-bold text-white shadow-md transition-transform hover:scale-[1.02] active:scale-[0.98]"
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
                    className="flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
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
                  className="flex size-8 items-center justify-center rounded-full transition-colors hover:opacity-75"
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
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                    style={{ color: textPrimary }}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      style={{ color: textSecondary }}
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : (
                    <Search className="size-4 shrink-0" style={{ color: textPrimary }} />
                  )}
                </div>
              </div>
            )}

            <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-3">
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
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold"
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
                            className="flex w-full items-center justify-between gap-3 py-3 text-left"
                          >
                            <div>
                              <p className="text-xs font-bold">{art.title}</p>
                              <p className="mt-0.5 text-xs" style={{ color: textSecondary }}>
                                {art.summary}
                              </p>
                            </div>
                            <ChevronRight className="size-4 shrink-0" style={{ color: textSecondary }} />
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
                          className="flex w-full items-center justify-between gap-3 py-3 text-left"
                        >
                          <div>
                            <p className="text-xs font-bold">{art.title}</p>
                            <p className="mt-0.5 text-xs" style={{ color: textSecondary }}>
                              {art.summary}
                            </p>
                          </div>
                          <ChevronRight className="size-4 shrink-0" style={{ color: textSecondary }} />
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
                          className="flex w-full items-center justify-between gap-3 py-3.5 text-left transition-opacity hover:opacity-85"
                        >
                          <div>
                            <p className="text-xs font-bold">{col.title}</p>
                            <p className="mt-1 text-xs leading-relaxed" style={{ color: textSecondary }}>
                              {col.description}
                            </p>
                            <p className="mt-1.5 text-[11px]" style={{ color: textSecondary }}>
                              {col.articles.length} articles
                            </p>
                          </div>
                          <ChevronRight className="size-4 shrink-0" style={{ color: textSecondary }} />
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
          className="grid shrink-0 grid-cols-3 py-2"
          style={{
            backgroundColor: cardSurface,
            borderTop: `1px solid ${borderCol}`,
          }}
        >
          <button
            type="button"
            onClick={() => setTab('home')}
            className="flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors"
            style={{ color: tab === 'home' ? 'var(--accent)' : textSecondary }}
          >
            <HomeTabIcon active={tab === 'home'} />
            <span>Home</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('messages')}
            className="flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors"
            style={{ color: tab === 'messages' ? 'var(--accent)' : textSecondary }}
          >
            <MessageSquareText className="size-5" />
            <span>Messages</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedArticle(null)
              setTab('help')
            }}
            className="flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors"
            style={{ color: tab === 'help' ? 'var(--accent)' : textSecondary }}
          >
            <HelpCircle className="size-5" />
            <span>Help</span>
          </button>
        </nav>
      </section>

      {/* Circular Floating Launcher Button (Intercom-style white circle + dark chat smile / chevron) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Minimize support messenger' : 'Open support & AI assistant'}
        aria-expanded={open}
        className="fixed bottom-4 right-4 z-30 flex size-12 items-center justify-center rounded-full bg-white text-[#151515] transition-transform duration-200 hover:scale-105 active:scale-95 sm:bottom-5 sm:right-5 sm:size-14"
        style={{
          ['--launcher-smile' as string]: '#ffffff',
          boxShadow: '0 8px 28px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.06)',
        }}
      >
        {open ? <ChevronDown className="size-6 stroke-[2.2]" /> : <LauncherBubbleIcon className="size-6" />}
      </button>
    </>
  )
}
