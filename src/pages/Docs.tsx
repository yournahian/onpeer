import { useState } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Gavel,
  Globe2,
  Layers,
  Lock,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react'
import { toast } from 'sonner'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import {
  CHAIN_ID,
  COUNTRIES,
  ESCROW_ADDRESS,
  EURC_ESCROW_ADDRESS,
  EURC_TOKEN_ADDRESS,
  PAYMENT_METHODS,
  TIER_TABLE,
  formatUsdcAmount,
} from '@/lib/p2p'
import { SiteBar } from '@/components/SiteBar'
import { AppLink } from '@/components/AppLink'
import { Footer } from '@/components/Footer'
import { CoinLogo, CountryFlag, MethodLogo } from '@/components/logos'

const USDC_TOKEN_ADDRESS = '0x3600000000000000000000000000000000000000'

const SECTIONS = [
  { id: 'overview', label: '1. Platform Overview' },
  { id: 'assets-corridors', label: '2. Assets & Corridors' },
  { id: 'p2p-lifecycle', label: '3. P2P Escrow Lifecycle' },
  { id: 'tiers-disputes', label: '4. Tiers, Margin & Disputes' },
  { id: 'safety-rules', label: '5. Anti-Scam Safety Rules' },
  { id: 'swap-bridge-ai', label: '6. Swap, Bridge & Assistant' },
  { id: 'contracts-privacy', label: '7. Contracts & Encryption' },
] as const

function ContractRow({
  label,
  symbol,
  address,
  note,
}: {
  label: string
  symbol: 'USDC' | 'EURC'
  address: string
  note: string
}) {
  const [copied, setCopied] = useState(false)

  const onCopy = () => {
    void navigator.clipboard?.writeText(address).then(() => {
      setCopied(true)
      toast.success(`${label} address copied`)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      className="flex flex-col justify-between gap-3 rounded-2xl p-4 sm:flex-row sm:items-center"
      style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <CoinLogo symbol={symbol} size={18} />
          <span className="text-sm font-bold">{label}</span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}
          >
            Arc Testnet
          </span>
        </div>
        <p className="mono truncate text-xs font-semibold">{address}</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {note}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors hover:opacity-90"
          style={{ background: 'var(--fill-3)', border: '1px solid var(--border)' }}
        >
          {copied ? <Check className="size-3.5" style={{ color: 'var(--accent)' }} /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>

        <a
          href={buildAddressExplorerUrl(CHAIN_ID, address)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition-opacity hover:opacity-90"
          style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}
        >
          Explorer <ExternalLink className="size-3.5" />
        </a>
      </div>
    </div>
  )
}

export default function DocsPage() {
  const [activeId, setActiveId] = useState<string>('overview')

  const jumpTo = (id: string) => {
    setActiveId(id)
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div className="min-h-dvh">
      <SiteBar />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
        {/* Hero Header */}
        <header className="glass rounded-3xl p-6 sm:p-10">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
            <BookOpen className="size-4" />
            <span>Official Platform Documentation • v2.1</span>
          </div>
          <h1 className="display text-gradient mt-3 max-w-4xl text-balance text-3xl font-bold sm:text-5xl">
            OnPeer Protocol &amp; Product Documentation
          </h1>
          <p className="mt-3 max-w-3xl text-pretty text-sm leading-relaxed sm:text-base" style={{ color: 'var(--muted)' }}>
            Technical and operational reference for OnPeer — the non-custodial South Asian P2P stablecoin marketplace
            for <strong>USDC</strong> and <strong>EURC</strong> on <strong>Arc Testnet</strong>, integrated with one-step
            stablecoin Swap, Circle CCTP Cross-Chain Bridge, Sandbox Fiat Onramp, and encrypted offchain coordination.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <AppLink
              to="/p2p"
              className="inline-flex min-h-10 items-center gap-2 rounded-full px-5 text-xs font-bold transition-transform hover:-translate-y-0.5"
              style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}
            >
              Launch P2P Market <ArrowRight className="size-3.5" />
            </AppLink>
            <AppLink
              to="/privacy"
              className="inline-flex min-h-10 items-center gap-2 rounded-full px-5 text-xs font-semibold transition-colors hover:opacity-90"
              style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
            >
              Privacy &amp; Encryption Spec
            </AppLink>
          </div>
        </header>

        {/* Mobile Quick Jump Strip */}
        <nav
          aria-label="Documentation sections mobile"
          className="mt-6 flex gap-2 overflow-x-auto pb-2 lg:hidden"
        >
          {SECTIONS.map((s) => {
            const active = activeId === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => jumpTo(s.id)}
                className="shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition-colors"
                style={{
                  background: active ? 'var(--accent-bg)' : 'var(--fill-2)',
                  color: active ? 'var(--on-accent)' : 'var(--ink)',
                  border: '1px solid var(--border)',
                }}
              >
                {s.label}
              </button>
            )
          })}
        </nav>

        {/* Main 2-Column Documentation Grid */}
        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Desktop Sticky Sidebar TOC */}
          <aside className="glass sticky top-24 hidden rounded-3xl p-5 lg:block">
            <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--subtle)' }}>
              On This Page
            </p>
            <ul className="mt-3 space-y-1">
              {SECTIONS.map((s) => {
                const active = activeId === s.id
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(s.id)}
                      className="w-full rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors"
                      style={{
                        background: active ? 'var(--fill-3)' : 'transparent',
                        color: active ? 'var(--accent)' : 'var(--muted)',
                      }}
                    >
                      {s.label}
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="mt-5 border-t pt-4 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
              <p className="font-bold" style={{ color: 'var(--ink)' }}>
                Network Parameters
              </p>
              <p className="mono mt-1">Chain: Arc Testnet</p>
              <p className="mono">Chain ID: 5042002</p>
              <p className="mono">Gas Token: USDC</p>
            </div>
          </aside>

          {/* Documentation Content Articles */}
          <div className="space-y-8">
            {/* 1. PLATFORM OVERVIEW */}
            <section id="overview" className="glass scroll-mt-24 rounded-3xl p-6 sm:p-8 space-y-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 items-center justify-center rounded-2xl"
                  style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
                >
                  <Layers className="size-5" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                    Section 01
                  </p>
                  <h2 className="display text-2xl font-bold">Platform Overview &amp; Architecture</h2>
                </div>
              </div>

              <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                OnPeer is built on <strong>Arc</strong> — Circle&apos;s Layer-1 EVM blockchain where{' '}
                <strong>USDC is the native gas token</strong> with predictable transaction fees and sub-second block
                finality. Unlike traditional custodial P2P exchanges that hold user deposits inside opaque omnibus
                accounts, OnPeer never takes custody of your stablecoins:
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  {
                    icon: ArrowLeftRight,
                    title: 'Non-Custodial P2P',
                    body: 'Smart contract escrow locks USDC or EURC per order. Governance cannot withdraw active escrow.',
                  },
                  {
                    icon: Lock,
                    title: 'Encrypted Vault & Chat',
                    body: 'Saved payment methods, order chat, and dispute evidence are sealed with AES-256-GCM offchain.',
                  },
                  {
                    icon: Sparkles,
                    title: 'Zero Gas Friction',
                    body: 'Because Arc uses USDC natively for gas, users never need ETH or a separate gas token to trade.',
                  },
                ].map((c) => (
                  <div
                    key={c.title}
                    className="rounded-2xl p-4 space-y-2"
                    style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
                  >
                    <c.icon className="size-5" style={{ color: 'var(--accent)' }} />
                    <h3 className="text-sm font-bold">{c.title}</h3>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                      {c.body}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* 2. SUPPORTED ASSETS & CORRIDORS */}
            <section id="assets-corridors" className="glass scroll-mt-24 rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 items-center justify-center rounded-2xl"
                  style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
                >
                  <Globe2 className="size-5" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                    Section 02
                  </p>
                  <h2 className="display text-2xl font-bold">Supported Cryptocurrencies, Corridors &amp; Rails</h2>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div
                  className="flex items-start gap-3.5 rounded-2xl p-4"
                  style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
                >
                  <CoinLogo symbol="USDC" size={32} />
                  <div>
                    <h3 className="text-sm font-bold">USD Coin (USDC)</h3>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                      6-decimal dollar-backed stablecoin on Arc Testnet. Supported across P2P Buy/Sell, Swap, Circle
                      CCTP Bridge, and Sandbox Fiat Onramp.
                    </p>
                  </div>
                </div>

                <div
                  className="flex items-start gap-3.5 rounded-2xl p-4"
                  style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
                >
                  <CoinLogo symbol="EURC" size={32} />
                  <div>
                    <h3 className="text-sm font-bold">Euro Coin (EURC)</h3>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                      6-decimal euro-backed stablecoin on Arc Testnet. Supported directly in OnPeer P2P Buy/Sell offers
                      via a dedicated <code className="mono">P2PEscrow</code> instance and instant USDC ↔ EURC Swap.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold">8 South Asian Fiat Markets</h3>
                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {COUNTRIES.map((c) => (
                    <div
                      key={c.code}
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs"
                      style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
                    >
                      <CountryFlag code={c.code} size={20} />
                      <div>
                        <p className="font-bold">{c.currency}</p>
                        <p style={{ color: 'var(--muted)' }}>{c.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold">18 Local Mobile-Money &amp; Banking Rails</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {PAYMENT_METHODS.map((m) => (
                    <span
                      key={m.bit}
                      className="inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold"
                      style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
                    >
                      <MethodLogo name={m.name} size={16} />
                      {m.name}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            {/* 3. P2P ESCROW LIFECYCLE */}
            <section id="p2p-lifecycle" className="glass scroll-mt-24 rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 items-center justify-center rounded-2xl"
                  style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
                >
                  <ArrowLeftRight className="size-5" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                    Section 03
                  </p>
                  <h2 className="display text-2xl font-bold">P2P Smart Contract Escrow Lifecycle</h2>
                </div>
              </div>

              <ol className="space-y-3 text-xs leading-relaxed sm:text-sm" style={{ color: 'var(--muted)' }}>
                <li className="rounded-2xl p-4" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <strong style={{ color: 'var(--ink)' }}>1. Account &amp; Saved Payment Methods:</strong> Connect an
                  EVM wallet, set your public <strong>Display Alias</strong>, verify your alert email, and save up to 20
                  payment methods (bKash, Nagad, Rocket, UPI, Raast, Bank transfer) under{' '}
                  <strong>User Center → P2P Payment Methods</strong>. Saved methods auto-fill whenever you post or take
                  offers.
                </li>
                <li className="rounded-2xl p-4" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <strong style={{ color: 'var(--ink)' }}>2. Posting Buy &amp; Sell Ads:</strong> Makers choose{' '}
                  <code className="mono">USDC</code> or <code className="mono">EURC</code>, local fiat rate, min/max
                  order limits, payment window (15–60m), and ad TTL (1–168h). A flat{' '}
                  <code className="mono">0.05</code> listing fee applies per new ad;{' '}
                  <strong>refreshing TTL, opening orders, trading, chat, and releases have 0% platform fee</strong>.
                  Posting a Buy Ad requires Verified Merchant status or 3+ completed trades.
                </li>
                <li className="rounded-2xl p-4" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <strong style={{ color: 'var(--ink)' }}>3. Escrow Lock &amp; Fiat Payment:</strong> When an order
                  opens, the seller&apos;s crypto is locked inside <code className="mono">P2PEscrow</code>. The buyer
                  transfers exact fiat via the selected rail within the countdown window and clicks{' '}
                  <strong>Transferred, Notify Seller</strong> with their transfer reference (<code className="mono">payerProof</code>).
                  If the buyer paid just as the timer ended, a 5-minute late-payment recovery window allows submitting
                  the transfer ID onchain (capped at 2 late marks per 30 days).
                </li>
                <li className="rounded-2xl p-4" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <strong style={{ color: 'var(--ink)' }}>4. Verification, Release &amp; Post-Trade Feedback:</strong>{' '}
                  Once the seller verifies receipt inside their own banking/mobile-money app from a matching sender
                  name, they sign <code className="mono">release(orderId)</code>. Both parties can then leave a{' '}
                  <strong>Positive/Negative review + 1–5 star rating</strong> on each other&apos;s trader profile.
                </li>
              </ol>
            </section>

            {/* 4. TIERS, MERCHANT MARGIN & DISPUTES */}
            <section id="tiers-disputes" className="glass scroll-mt-24 rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 items-center justify-center rounded-2xl"
                  style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
                >
                  <Gavel className="size-5" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                    Section 04
                  </p>
                  <h2 className="display text-2xl font-bold">Account Tiers, Merchant Margin &amp; Dispute Rules</h2>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                {TIER_TABLE.map((t) => (
                  <div
                    key={t.tier}
                    className="rounded-2xl p-4 text-xs space-y-1.5"
                    style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
                  >
                    <p className="font-bold" style={{ color: 'var(--accent)' }}>
                      Tier {t.tier} • {t.label}
                    </p>
                    <p className="mono text-base font-bold">
                      {t.cap === null ? 'Uncapped' : `${formatUsdcAmount(t.cap, 0)} Cap`}
                    </p>
                    <p style={{ color: 'var(--muted)' }}>{t.requirement}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                <div className="rounded-2xl p-4 space-y-1.5" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <h3 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                    Merchant Security Margin (100+ Stake)
                  </h3>
                  <p>
                    Staking <code className="mono">100</code> or more in security margin grants the{' '}
                    <strong>Verified Merchant</strong> badge, unlocks Buy Ads immediately without waiting for 3 trades,
                    and raises the account to at least Tier 1 (500 per-order cap). Margin withdrawals carry a 7-day
                    timelock and require zero open orders.
                  </p>
                </div>

                <div className="rounded-2xl p-4 space-y-1.5" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <h3 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                    30m Cooling-Off &amp; Asymmetric Dispute Bond
                  </h3>
                  <p>
                    Opening a dispute requires <strong>0 upfront balance</strong>. Before an arbiter calls{' '}
                    <code className="mono">takeCase</code>, either party can settle within <strong>30 minutes</strong>{' '}
                    with zero bond, zero strike, and zero concession. If an arbiter rules with{' '}
                    <code className="mono">applyBond = true</code>, only the losing party owes{' '}
                    <code className="mono">min(5, max(2, 5%))</code> from free margin or deferred unban debt.
                  </p>
                </div>
              </div>
            </section>

            {/* 5. ANTI-SCAM SAFETY RULES */}
            <section id="safety-rules" className="glass scroll-mt-24 rounded-3xl p-6 sm:p-8 space-y-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 items-center justify-center rounded-2xl"
                  style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
                >
                  <ShieldCheck className="size-5" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                    Section 05
                  </p>
                  <h2 className="display text-2xl font-bold">Anti-Scam &amp; Triangulation Protection Rules</h2>
                </div>
              </div>

              <ul className="grid gap-3 sm:grid-cols-2 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                <li className="rounded-2xl p-4" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <strong style={{ color: 'var(--ink)' }}>Strict Name-Match Requirement:</strong> Never send fiat to,
                  or release crypto after receiving fiat from, a third-party account whose holder name does not match
                  your counterparty. Third-party triangulation is the #1 cause of bank freezes. If a user proceeds
                  despite a name mismatch, OnPeer bears no liability.
                </li>
                <li className="rounded-2xl p-4" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <strong style={{ color: 'var(--ink)' }}>Verify Inside Your Official Banking App:</strong> Never rely
                  on SMS alerts, email screenshots, or chat images as proof of payment. Always log in to your actual
                  bKash, Nagad, UPI, or bank app and confirm settled available balance before releasing escrow.
                </li>
                <li className="rounded-2xl p-4" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <strong style={{ color: 'var(--ink)' }}>Keep All Communication Inside Order Chat:</strong> Never move
                  negotiations to WhatsApp or Telegram. Encrypted OnPeer Order Chat and uploaded PDF/image receipts are
                  the official evidentiary record reviewed by arbiters.
                </li>
                <li className="rounded-2xl p-4" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <strong style={{ color: 'var(--ink)' }}>Never Cancel After Paying:</strong> If you have already sent
                  fiat, never click Cancel Order — mark the order Paid (or use the 5-minute post-deadline Transfer ID
                  recovery) and file a dispute statement if needed.
                </li>
              </ul>
            </section>

            {/* 6. SWAP, BRIDGE & ASSISTANT */}
            <section id="swap-bridge-ai" className="glass scroll-mt-24 rounded-3xl p-6 sm:p-8 space-y-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 items-center justify-center rounded-2xl"
                  style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
                >
                  <Repeat className="size-5" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                    Section 06
                  </p>
                  <h2 className="display text-2xl font-bold">Swap, Cross-Chain Bridge &amp; AI Assistant</h2>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                <div className="rounded-2xl p-4 space-y-2" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2 font-bold" style={{ color: 'var(--ink)' }}>
                    <Repeat className="size-4" style={{ color: 'var(--accent)' }} /> Stablecoin Swap
                  </div>
                  <p>
                    Convert seamlessly between <strong>USDC</strong> and <strong>EURC</strong> on Arc Testnet via Circle
                    App Kit with transparent slippage controls (0.5%, 1%, 3%) and live rate quotes prior to signing.
                  </p>
                </div>

                <div className="rounded-2xl p-4 space-y-2" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2 font-bold" style={{ color: 'var(--ink)' }}>
                    <Waypoints className="size-4" style={{ color: 'var(--accent)' }} /> CCTP Cross-Chain Bridge
                  </div>
                  <p>
                    Burn and mint native <strong>USDC</strong> across Arc Testnet, Ethereum Sepolia, Base Sepolia,
                    Arbitrum Sepolia, OP Sepolia, Avalanche Fuji, and Polygon Amoy using Circle&apos;s Cross-Chain
                    Transfer Protocol.
                  </p>
                </div>

                <div className="rounded-2xl p-4 space-y-2" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2 font-bold" style={{ color: 'var(--ink)' }}>
                    <Sparkles className="size-4" style={{ color: 'var(--accent)' }} /> Non-Custodial Assistant
                  </div>
                  <p>
                    Query live P2P rates, inspect orders, or prepare Swap/Bridge/P2P actions in natural language. Every
                    transaction requires explicit review and signature in your own wallet; ad notes and chat messages
                    are never sent to the model.
                  </p>
                </div>
              </div>
            </section>

            {/* 7. VERIFIED CONTRACTS & PRIVACY */}
            <section id="contracts-privacy" className="glass scroll-mt-24 rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 items-center justify-center rounded-2xl"
                  style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
                >
                  <Lock className="size-5" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                    Section 07
                  </p>
                  <h2 className="display text-2xl font-bold">Deployed Contracts &amp; Encryption Architecture</h2>
                </div>
              </div>

              <div className="space-y-3">
                {ESCROW_ADDRESS && (
                  <ContractRow
                    label="P2PEscrow v2.1 (USDC Market)"
                    symbol="USDC"
                    address={ESCROW_ADDRESS}
                    note="Primary non-custodial USDC escrow, KYC registry, merchant margin & dispute bond ledger."
                  />
                )}
                <ContractRow
                  label="P2PEscrow v2.1 (EURC Market)"
                  symbol="EURC"
                  address={EURC_ESCROW_ADDRESS}
                  note="Dedicated non-custodial EURC escrow supporting all 8 South Asian fiat corridors."
                />
                <ContractRow
                  label="Arc Testnet USDC (ERC-20)"
                  symbol="USDC"
                  address={USDC_TOKEN_ADDRESS}
                  note="Official 6-decimal ERC-20 USDC interface on Arc Testnet."
                />
                <ContractRow
                  label="Arc Testnet EURC (ERC-20)"
                  symbol="EURC"
                  address={EURC_TOKEN_ADDRESS}
                  note="Official 6-decimal ERC-20 Euro Coin contract on Arc Testnet."
                />
              </div>

              <div
                className="flex items-start gap-3 rounded-2xl p-4 text-xs leading-relaxed"
                style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--muted)' }}
              >
                <ShieldAlert className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warn)' }} />
                <p>
                  <strong style={{ color: 'var(--ink)' }}>Testnet &amp; Encryption Disclosure:</strong> OnPeer operates
                  on <strong>Arc Testnet</strong> for evaluation with test tokens and Didit Sandbox KYC. Offchain
                  payment details, emails, and order chats are encrypted at rest with <strong>AES-256-GCM</strong> in
                  Supabase Postgres via Cloudflare Workers; read the full{' '}
                  <AppLink to="/privacy" className="font-semibold underline" style={{ color: 'var(--accent)' }}>
                    Privacy &amp; Encryption Notice
                  </AppLink>{' '}
                  for retention schedules and account deletion controls.
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
