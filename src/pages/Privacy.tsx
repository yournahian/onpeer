import { ArrowLeft, Database, KeyRound, Lock, Mail, ShieldAlert, Trash2 } from 'lucide-react'
import { SiteBar } from '@/components/SiteBar'
import { AppLink } from '@/components/AppLink'
import { Footer } from '@/components/Footer'

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="glass rounded-3xl p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
        >
          <Icon className="size-5" />
        </span>
        <h2 className="display text-lg font-bold sm:text-xl">{title}</h2>
      </div>
      <div className="mt-3 space-y-2.5 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
        {children}
      </div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh">
      <SiteBar />
      <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--accent)' }}>
              OnPeer P2P • Arc Mainnet
            </p>
            <h1 className="display mt-1 text-3xl font-bold sm:text-4xl">Privacy &amp; Encryption Notice</h1>
          </div>
          <AppLink
            to="/p2p"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition-colors hover:opacity-90"
          >
            <ArrowLeft className="size-3.5" /> Back to P2P
          </AppLink>
        </div>

        <div
          className="flex items-start gap-3 rounded-2xl p-4 text-xs leading-relaxed sm:text-sm"
          style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--ink)' }}
        >
          <ShieldAlert className="mt-0.5 size-5 shrink-0" style={{ color: 'var(--warn)' }} />
          <p>
            <strong>Non-Custodial Onchain Escrow:</strong> OnPeer operates on <strong>Arc Mainnet</strong> (Chain ID 5042)
            with USDC as the native gas token. Swap and Bridge never require an account or personal information.
            account or KYC.
          </p>
        </div>

        <Section icon={KeyRound} title="1. Payment Details & Server-Side Envelope Encryption (Mode 2)">
          <p>
            When sealed payment details are enabled (<code className="mono">detailsMode 2</code>,{' '}
            <code className="mono">autoReveal</code>), seller receiving details, buyer transfer references, offchain
            chat messages, dispute statements, email addresses, and verified sandbox names are encrypted with{' '}
            <strong>AES-256-GCM</strong> using a unique random 256-bit data key and random 96-bit IV per record.
          </p>
          <p>
            <strong>Important trust disclosure:</strong> Each data key is wrapped by a server-held master key stored in
            Cloudflare Worker secrets by the platform operator. This protects your payment details from public
            blockchain scraping, third-party wallets, and raw database leaks, and only an order&apos;s buyer, seller,
            and authorized arbiter may request decryption.{' '}
            <strong>However, because the operator holds the master key, the operator could technically decrypt stored records.</strong>{' '}
            True end-to-end browser encryption (<code className="mono">detailsMode 1</code>) is reserved for a later
            phase.
          </p>
          <p>
            Only the <code className="mono">keccak256</code> hash of the encrypted blob (
            <code className="mono">detailsHash</code> or <code className="mono">payerProof</code>) is written onchain so
            traders and arbiters can verify that stored details were never altered after the order opened.
          </p>
        </Section>

        <Section icon={Database} title="2. Identity Verification (Didit Sandbox) & Name Matching">
          <p>
            P2P identity verification is processed by <strong>Didit</strong>. Identity
            documents and liveness checks stay with Didit under Didit&apos;s privacy terms; OnPeer never stores ID
            document images.
          </p>
          <p>
            When a sandbox session is approved, OnPeer stores only your verification status, level, expiry date, and an
            AES-256-GCM encrypted copy of the verified name so the backend can check whether a seller&apos;s payment
            holder name or a buyer&apos;s sender name matches. Counterparties only see a{' '}
            <strong>Name Matches / Name not confirmed / Unverified</strong> indicator and masked initials (for example,{' '}
            <code className="mono">T*** R***</code>)—never your full name.
          </p>
          <p>
            Onchain, a dedicated verifier key writes only a numeric level and Unix expiry timestamp (
            <code className="mono">verification[wallet]</code>)—never personal data.
          </p>
        </Section>

        <Section icon={Mail} title="3. Email Alerts, Double Opt-In & Zero Sensitive Content">
          <p>
            Providing an email address is optional. No trade or dispute notification is ever sent until you click the
            signed confirmation link sent to that address (double opt-in).
          </p>
          <p>
            Notification emails are delivered via Resend, include a one-click unsubscribe link in every message, and
            contain only the order or ad number, a generic event notice, and a link back to the app—never bank numbers,
            chat text, or personal names.
          </p>
        </Section>

        <Section icon={Lock} title="4. Data Access & Least-Privilege Storage">
          <p>
            Offchain records are stored in PostgreSQL behind Row Level Security with all privileges revoked from the{' '}
            <code className="mono">anon</code> and <code className="mono">authenticated</code> roles and explicit RLS
            policies granted only to the least-privilege Worker role (with the Supabase Data API disabled for the{' '}
            <code className="mono">public</code> schema in project settings). Every request to view order details,
            chat, evidence, or dispute filings verifies your wallet session and reads the live order roles (
            <code className="mono">buyer</code>, <code className="mono">seller</code>,{' '}
            <code className="mono">arbiter</code>, or 7-day <code className="mono">backupArbiter</code>) directly from
            the Arc escrow contract.
          </p>
        </Section>

        <Section icon={Trash2} title="5. Retention Schedule & Account Deletion">
          <p>
            Retention timers are enforced automatically by our scheduled cleanup job:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Unbound <code className="mono">order_details</code> drafts: <strong>24 hours</strong> from creation.</li>
            <li>Unbound <code className="mono">ad_details</code> blobs: <strong>8 days</strong> from creation; once bound to an ad, <strong>95 days</strong> (or ad expiry + 95 days).</li>
            <li>Bound <code className="mono">order_details</code> and buyer <code className="mono">payer</code> proofs: <strong>95 days</strong> from creation/binding (extended to at least <strong>90 days</strong> from the last order vault read).</li>
            <li>Encrypted chat messages and evidence attachments (&le; 1 MB): <strong>90 days</strong> from creation.</li>
            <li>Offchain dispute filings: <strong>365 days (1 year)</strong> from filing.</li>
            <li>Webhook deduplication records: <strong>90 days</strong>; sent/failed email outbox records: <strong>30 days</strong>; expired rate-limit buckets: <strong>7 days</strong>; expired/revoked sessions: <strong>1 day</strong>.</li>
          </ul>
          <p>
            You can delete your P2P account from the <strong>Account &amp; Margin</strong> tab in{' '}
            <AppLink to="/p2p" className="underline">
              /p2p
            </AppLink>{' '}
            whenever you have <strong>zero open orders</strong> onchain (deletion is blocked while any order is open).
            Deleting your account immediately scrubs your display name, country, encrypted email, and encrypted KYC
            name, revokes active sessions, cancels queued alerts, queues an onchain verification revocation if your
            wallet was verified, <strong>immediately deletes your unbound vault blobs</strong>, and shortens retention
            on your remaining order-bound vault blobs, chat messages, and dispute filings to <strong>7 days</strong>.
            Public blockchain transactions and events on Arc are immutable and cannot be erased.
          </p>
        </Section>
      </main>
      <Footer />
    </div>
  )
}
