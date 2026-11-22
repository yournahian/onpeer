import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion'
import {
  ArrowLeftRight,
  ArrowRight,
  CreditCard,
  Menu,
  Orbit,
  Repeat,
  ShieldCheck,
  Sparkles,
  Waypoints,
  X,
} from 'lucide-react'
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

function FxSwitch({
  active,
  onToggle,
  compact = false,
}: {
  active: boolean
  onToggle: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={active ? 'Disable 3D background motion' : 'Enable 3D background motion'}
      title={active ? '3D Motion: On (click to pause)' : '3D Motion: Off (click to resume)'}
      onClick={onToggle}
      className={`group inline-flex items-center rounded-full font-semibold transition-colors hover:border-[var(--border-strong)] ${
        compact ? 'h-8 gap-1.5 pl-2.5 pr-1 text-[11px]' : 'h-9 gap-2 pl-3 pr-1.5 text-xs'
      }`}
      style={{
        background: 'var(--fill-2)',
        border: '1px solid var(--border)',
        color: active ? 'var(--ink)' : 'var(--muted)',
      }}
    >
      <Orbit
        className="size-3.5 transition-colors"
        style={{ color: active ? 'var(--accent)' : 'var(--subtle)' }}
      />
      <span className="tracking-wide">FX</span>
      <span
        className={`relative flex items-center rounded-full p-0.5 transition-colors duration-200 ${
          compact ? 'h-4 w-7' : 'h-5 w-9'
        }`}
        style={{
          background: active ? 'var(--accent-bg)' : 'var(--fill-3)',
          boxShadow: active ? '0 2px 10px -2px var(--accent-glow)' : 'inset 0 1px 2px rgba(0,0,0,0.25)',
        }}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          className={`${compact ? 'size-3' : 'size-4'} rounded-full bg-white shadow-sm`}
          style={{ marginLeft: active ? 'auto' : 0 }}
        />
      </span>
    </button>
  )
}

/** Top bar across all pages: desktop single-row nav, mobile 2-row header with hamburger menu. */
export function SiteBar({ overlay = false, sticky = true }: { overlay?: boolean; sticky?: boolean }) {
  const route = useRoute()
  const { isAdmin } = useAdminRoles()
  const { helixMotion, setHelixMotion } = useTheme()
  const { scrollY } = useScroll()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)

  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 32))

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    const onPointerDown = (e: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [menuOpen])

  const landing = isLandingDomain()
  // Landing / Home uses PlanetHero rather than RibbonBackdrop, so FX switch is omitted there.
  const showFx = !landing && route !== 'home'
  // Over the full-bleed hero the bar is transparent and always dark-styled; it turns solid once you scroll or open the menu.
  const floating = overlay && !scrolled && !menuOpen
  const links = isAdmin ? [...LINKS, { to: '/admin', route: 'admin' as Route, label: 'Admin', icon: ShieldCheck }] : LINKS
  const maxW = route === 'p2p' ? 'max-w-[1440px]' : 'max-w-7xl'

  return (
    <header
      ref={headerRef}
      className={`${overlay ? 'fixed inset-x-0 top-0' : sticky ? 'sticky top-0' : 'relative'} z-40 transition-colors duration-300 ${floating ? 'stage' : ''}`}
      style={
        floating
          ? { background: 'linear-gradient(180deg, rgba(6,3,13,0.7), transparent)' }
          : { background: 'var(--bar-bg)', backdropFilter: 'blur(20px)' }
      }
    >
      {/* Desktop (>= 768px): single horizontal bar */}
      <div className={`mx-auto hidden w-full ${maxW} items-center justify-between gap-3 px-6 py-3 md:flex lg:px-12`}>
        <Brand tagline="USDC for South Asia" />

        {!landing && (
          <nav className="flex items-center gap-0.5 lg:gap-1" aria-label="Products">
            {links.map((l) => (
              <AppLink
                key={l.to}
                to={l.to}
                aria-current={route === l.route ? 'page' : undefined}
                className="relative flex min-h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold transition-colors hover:text-[var(--ink)] lg:px-3.5 lg:text-sm"
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
        )}

        <div className="flex shrink-0 items-center gap-2">
          {showFx && <FxSwitch active={helixMotion} onToggle={() => setHelixMotion(!helixMotion)} />}
          <ThemeToggle />
          {landing ? (
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

      {/* Mobile (< 768px): Row 1 Logo + Wallet, Row 2 FX + Theme + Hamburger */}
      <div className={`mx-auto w-full ${maxW} px-4 py-2.5 md:hidden`}>
        <div className="flex items-center justify-between gap-2">
          <div className="shrink-0" onClick={() => setMenuOpen(false)}>
            <Brand tagline="USDC for South Asia" />
          </div>

          {landing ? (
            <AppLink
              to="/p2p"
              className="btn-shine inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition-transform active:scale-[0.98]"
              style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}
            >
              Open App <ArrowRight className="size-3.5" />
            </AppLink>
          ) : (
            <ConnectKitButton.Custom>
              {({ show, isConnected, address }) => (
                <Button
                  variant={isConnected ? 'ghost' : 'primary'}
                  className="mono min-h-9 shrink-0 px-3 py-1.5 text-xs"
                  onClick={show}
                >
                  {isConnected && address ? shortAddr(address) : 'Connect'}
                </Button>
              )}
            </ConnectKitButton.Custom>
          )}
        </div>

        <div
          className="mt-2.5 flex items-center justify-between gap-2 border-t pt-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            {showFx && <FxSwitch compact active={helixMotion} onToggle={() => setHelixMotion(!helixMotion)} />}
            <ThemeToggle size="sm" />
          </div>

          {!landing && (
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="mobile-products-menu"
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors"
              style={{
                background: menuOpen ? 'var(--surface-strong)' : 'var(--fill-2)',
                border: `1px solid ${menuOpen ? 'var(--border-strong)' : 'var(--border)'}`,
                color: 'var(--ink)',
              }}
            >
              {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
              <span>Menu</span>
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {menuOpen && !landing && (
            <motion.nav
              id="mobile-products-menu"
              aria-label="Mobile products"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div
                className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-2xl p-2"
                style={{
                  background: 'var(--surface-strong)',
                  border: '1px solid var(--border)',
                  boxShadow: 'var(--glass-shadow)',
                }}
              >
                {links.map((l) => {
                  const active = route === l.route
                  return (
                    <AppLink
                      key={l.to}
                      to={l.to}
                      onClick={() => setMenuOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className="flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition-colors"
                      style={{
                        background: active ? 'var(--fill-3)' : 'transparent',
                        border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
                        color: active ? 'var(--ink)' : 'var(--muted)',
                      }}
                    >
                      <l.icon
                        className="size-4 shrink-0"
                        style={{ color: active ? 'var(--accent)' : 'var(--subtle)' }}
                      />
                      <span className="truncate">{l.label}</span>
                    </AppLink>
                  )
                })}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>

      <div className="h-px transition-opacity duration-300" style={{ background: 'var(--border)', opacity: floating ? 0 : 1 }} />
    </header>
  )
}
