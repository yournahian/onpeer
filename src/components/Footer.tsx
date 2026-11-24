import { ExternalLink, Mail, ShieldAlert } from 'lucide-react'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, COUNTRIES, ESCROW_ADDRESS } from '@/lib/p2p'
import { DOCS_URL, isAppSubdomain, isLandingDomain } from '@/lib/router'
import { useAdminRoles } from '@/hooks/useAdmin'
import { AppLink } from '@/components/AppLink'
import { Brand } from '@/components/Logo'
import { CountryFlag } from '@/components/logos'
import { ThemeToggle } from '@/components/ThemeToggle'
import { FooterCta } from '@/components/FooterCta'

const linkClass = 'inline-flex min-h-9 items-center gap-1.5 text-sm transition-colors hover:text-[var(--ink)]'

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--subtle)' }}>
        {title}
      </h3>
      <ul className="mt-3 space-y-0.5" style={{ color: 'var(--muted)' }}>
        {children}
      </ul>
    </div>
  )
}

/** Site footer shared by every page. */
export function Footer() {
  const { isAdmin } = useAdminRoles()
  return (
    <footer className="relative mt-20 pb-28 sm:pb-24">
      <FooterCta />
      <div className="mx-auto mt-14 w-full max-w-7xl px-4 sm:px-8 lg:px-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Brand />
            <p className="mt-4 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
              Trade USDC with people near you, swap tokens and bridge across chains. Funds sit in escrow on Arc until both
              sides are happy.
            </p>
            <div className="mt-5 flex -space-x-2" aria-label="Supported countries">
              {COUNTRIES.map((c) => (
                <span key={c.code} title={c.name} className="rounded-full ring-2" style={{ ['--tw-ring-color' as string]: 'var(--bg)' }}>
                  <CountryFlag code={c.code} size={26} />
                </span>
              ))}
            </div>
          </div>

          <Col title="Product">
            <li>
              <AppLink to="/p2p" className={linkClass}>
                P2P market
              </AppLink>
            </li>
            <li>
              <AppLink to="/buy" className={linkClass}>
                Buy USDC (sandbox)
              </AppLink>
            </li>
            <li>
              <AppLink to="/p2p?mode=sell" className={linkClass}>
                Cash out (P2P)
              </AppLink>
            </li>
            <li>
              <AppLink to="/swap" className={linkClass}>
                Swap
              </AppLink>
            </li>
            <li>
              <AppLink to="/bridge" className={linkClass}>
                Bridge
              </AppLink>
            </li>
            <li>
              <AppLink to="/assistant" className={linkClass}>
                Assistant
              </AppLink>
            </li>
            {isAdmin && (
              <li>
                <AppLink to="/admin" className={linkClass}>
                  Admin panel
                </AppLink>
              </li>
            )}
          </Col>

          <Col title="Trust">
            <li className="text-sm">Escrow on every order</li>
            <li className="text-sm">Dispute arbiter</li>
            <li className="text-sm">Merchant margin</li>
            <li className="text-sm">Cancel cooldowns</li>
          </Col>

          <Col title="Resources">
            <li>
              {isLandingDomain() || isAppSubdomain() ? (
                <a className={linkClass} href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                  Documentation <ExternalLink className="size-3" />
                </a>
              ) : (
                <AppLink to="/docs" className={linkClass}>
                  Documentation
                </AppLink>
              )}
            </li>
            <li>
              <AppLink to="/brand-kit" className={linkClass}>
                Brand kit
              </AppLink>
            </li>
            <li>
              <AppLink to="/privacy" className={linkClass}>
                Privacy &amp; encryption
              </AppLink>
            </li>
            {ESCROW_ADDRESS && (
              <li>
                <a
                  className={linkClass}
                  href={buildAddressExplorerUrl(CHAIN_ID, ESCROW_ADDRESS)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Escrow contract <ExternalLink className="size-3" />
                </a>
              </li>
            )}
            <li>
              <a className={linkClass} href="https://docs.arc.io" target="_blank" rel="noopener noreferrer">
                Arc docs <ExternalLink className="size-3" />
              </a>
            </li>
            <li>
              <a className={linkClass} href="https://developers.circle.com" target="_blank" rel="noopener noreferrer">
                Circle developers <ExternalLink className="size-3" />
              </a>
            </li>
            <li className="pt-2">
              <span className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
                Support
              </span>
              <a
                className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-[var(--ink)]"
                href="mailto:support@onpeer.xyz"
              >
                <Mail className="size-3.5 shrink-0" style={{ color: 'var(--accent)' }} /> support@onpeer.xyz
              </a>
            </li>
            <li className="pt-2">
              <span className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
                Feedback, Collaboration &amp; Partnerships
              </span>
              <a
                className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-[var(--ink)]"
                href="mailto:hello@onpeer.xyz"
              >
                <Mail className="size-3.5 shrink-0" style={{ color: 'var(--accent)' }} /> hello@onpeer.xyz
              </a>
            </li>
          </Col>
        </div>

        <div
          className="mt-10 flex items-start gap-3 rounded-2xl p-4 text-xs text-pretty"
          style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--muted)' }}
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warn)' }} />
          <p>
            OnPeer runs on Arc Testnet with test funds only. Fiat payments happen outside the app and the contract cannot
            verify them, so pay only from accounts in your own name and check the rules for crypto trading in your country.
            Nothing here is financial advice.
          </p>
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            © 2026 OnPeer. All logos belong to their owners.
          </p>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  )
}
