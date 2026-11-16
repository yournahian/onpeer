import { useState } from 'react'
import { motion, useMotionValueEvent, useScroll } from 'framer-motion'
import { ArrowLeftRight, Repeat, ShieldCheck, Sparkles, Waypoints } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { useRoute, type Route } from '@/lib/router'
import { shortAddr } from '@/lib/p2p'
import { AppLink } from '@/components/AppLink'
import { Button } from '@/components/ui'
import { Brand } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAdminRoles } from '@/hooks/useAdmin'

const LINKS: { to: string; route: Route; label: string; icon: typeof Repeat }[] = [
  { to: '/p2p', route: 'p2p', label: 'P2P', icon: ArrowLeftRight },
  { to: '/swap', route: 'swap', label: 'Swap', icon: Repeat },
  { to: '/bridge', route: 'bridge', label: 'Bridge', icon: Waypoints },
  { to: '/assistant', route: 'assistant', label: 'Assistant', icon: Sparkles },
]

/** Top bar for Home, Swap and Bridge. The P2P page has its own header with the same product links. */
export function SiteBar({ overlay = false, sticky = true }: { overlay?: boolean; sticky?: boolean }) {
  const route = useRoute()
  const { isAdmin } = useAdminRoles()
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
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8 lg:px-12">
        <Brand tagline="USDC for South Asia" />

        <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto" aria-label="Products">
          {links.map((l) => (
            <AppLink
              key={l.to}
              to={l.to}
              aria-current={route === l.route ? 'page' : undefined}
              className="relative flex min-h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold transition-colors hover:text-[var(--ink)] sm:flex-none sm:px-4 sm:text-sm"
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
              <span className="relative flex items-center gap-1.5">
                <l.icon className="size-4" /> {l.label}
              </span>
            </AppLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <ThemeToggle compact className="sm:hidden" />
          <ConnectKitButton.Custom>
            {({ show, isConnected, address }) => (
              <Button variant={isConnected ? 'ghost' : 'primary'} className="mono min-h-10" onClick={show}>
                {isConnected && address ? shortAddr(address) : 'Connect'}
              </Button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
      <div className="h-px transition-opacity duration-300" style={{ background: 'var(--border)', opacity: floating ? 0 : 1 }} />
    </header>
  )
}
