import { useState } from 'react'
import { motion, useMotionValueEvent, useScroll } from 'framer-motion'
import { ArrowLeftRight, ArrowRight, CreditCard, Orbit, Repeat, ShieldCheck, Sparkles, Waypoints } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { isLandingDomain, useRoute, type Route } from '@/lib/router'
import { shortAddr } from '@/lib/p2p'
import { AppLink } from '@/components/AppLink'
import { Button } from '@/components/ui'
import { Brand } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useTheme } from '@/lib/theme'
import { useAdminRoles } from '@/hooks/useAdmin'

const LINKS: { to: string; route: Route; label: string; icon: typeof Repeat }[] = [
  { to: '/p2p', route: 'p2p', label: 'P2P', icon: ArrowLeftRight },
  { to: '/buy', route: 'buy', label: 'Buy USDC', icon: CreditCard },
  { to: '/swap', route: 'swap', label: 'Swap', icon: Repeat },
  { to: '/bridge', route: 'bridge', label: 'Bridge', icon: Waypoints },
  { to: '/assistant', route: 'assistant', label: 'Assistant', icon: Sparkles },
]

/** Top bar for Home, Swap and Bridge. The P2P page has its own header with the same product links. */
export function SiteBar({ overlay = false, sticky = true }: { overlay?: boolean; sticky?: boolean }) {
  const route = useRoute()
  const { isAdmin } = useAdminRoles()
  const { helixMotion, setHelixMotion } = useTheme()
  const { scrollY } = useScroll()
  const [scrolled, setScrolled] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 32))
  // Over the full-bleed hero the bar is transparent and always dark-styled; it turns solid once you scroll.
  const floating = overlay && !scrolled
  const links = isAdmin ? [...LINKS, { to: '/admin', route: 'admin' as Route, label: 'Admin', icon: ShieldCheck }] : LINKS
  return (
    <header
      className={`${overlay ? 'fixed inset-x-0 top-0' : sticky ? 'sticky top-0' : 'relative'} z-40 transition-colors duration-300 ${floating ? 'stage' : ''}`}
      style={floating ? { background: 'linear-gradient(180deg, rgba(6,3,13,0.7), transparent)' } : { background: 'var(--bar-bg)', backdropFilter: 'blur(20px)' }}
    >
      <div className={`mx-auto flex w-full ${route === 'p2p' ? 'max-w-[1440px]' : 'max-w-7xl'} flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8 lg:px-12`}>
        <Brand tagline="USDC for South Asia" />

        {!isLandingDomain() && (
          <nav className="order-last flex w-full gap-0.5 overflow-x-auto sm:order-none sm:w-auto sm:gap-1" aria-label="Products">
            {links.map((l) => (
              <AppLink
                key={l.to}
                to={l.to}
                aria-current={route === l.route ? 'page' : undefined}
                className="relative flex min-h-10 shrink-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 text-xs font-semibold transition-colors hover:text-[var(--ink)] sm:flex-none sm:gap-1.5 sm:px-3.5 sm:text-sm"
                style={{ color: route === l.route ? 'var(--ink)' : 'var(--subtle)' }}
              >
                {route === l.route && (
                  <motion.span
                    layoutId="site-pill"
                    className="absolute inset-0 rounded-lg"
                    style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative flex items-center gap-1 sm:gap-1.5">
                  <l.icon className="hidden size-3.5 min-[420px]:inline-block sm:size-4" /> {l.label}
                </span>
              </AppLink>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={helixMotion}
            aria-label={helixMotion ? 'Disable 3D background motion' : 'Enable 3D background motion'}
            title={helixMotion ? '3D Motion: On (click to pause)' : '3D Motion: Off (click to resume)'}
            onClick={() => setHelixMotion(!helixMotion)}
            className="group hidden h-9 items-center gap-2 rounded-full pl-3 pr-1.5 text-xs font-semibold transition-colors hover:border-[var(--border-strong)] sm:inline-flex"
            style={{
              background: 'var(--fill-2)',
              border: '1px solid var(--border)',
              color: helixMotion ? 'var(--ink)' : 'var(--muted)',
            }}
          >
            <Orbit
              className="size-3.5 transition-colors"
              style={{ color: helixMotion ? 'var(--accent)' : 'var(--subtle)' }}
            />
            <span className="tracking-wide">FX</span>
            <span
              className="relative flex h-5 w-9 items-center rounded-full p-0.5 transition-colors duration-200"
              style={{
                background: helixMotion ? 'var(--accent-bg)' : 'var(--fill-3)',
                boxShadow: helixMotion ? '0 2px 10px -2px var(--accent-glow)' : 'inset 0 1px 2px rgba(0,0,0,0.25)',
              }}
            >
              <motion.span
                layout
                transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                className="size-4 rounded-full bg-white shadow-sm"
                style={{ marginLeft: helixMotion ? 'auto' : 0 }}
              />
            </span>
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={helixMotion}
            aria-label={helixMotion ? 'Disable 3D background motion' : 'Enable 3D background motion'}
            title={helixMotion ? '3D Motion: On' : '3D Motion: Off'}
            onClick={() => setHelixMotion(!helixMotion)}
            className="flex size-10 items-center justify-center rounded-full sm:hidden"
            style={{
              background: 'var(--fill-2)',
              border: '1px solid var(--border)',
              color: helixMotion ? 'var(--accent)' : 'var(--muted)',
            }}
          >
            <Orbit className="size-4" />
          </button>
          <ThemeToggle className="hidden sm:inline-flex" />
          <ThemeToggle compact className="sm:hidden" />
          {isLandingDomain() ? (
            <AppLink
              to="/p2p"
              className="btn-shine inline-flex min-h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
              style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}
            >
              Open App <ArrowRight className="size-4" />
            </AppLink>
          ) : (
            <ConnectKitButton.Custom>
              {({ show, isConnected, address }) => (
                <Button variant={isConnected ? 'ghost' : 'primary'} className="mono min-h-10" onClick={show}>
                  {isConnected && address ? shortAddr(address) : 'Connect'}
                </Button>
              )}
            </ConnectKitButton.Custom>
          )}
        </div>
      </div>
      <div className="h-px transition-opacity duration-300" style={{ background: 'var(--border)', opacity: floating ? 0 : 1 }} />
    </header>
  )
}
