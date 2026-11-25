import * as React from 'react'
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  ArrowLeftRight,
  BookOpen,
  ExternalLink,
  Palette,
  Repeat,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, ESCROW_ADDRESS } from '@/lib/p2p'
import {
  APP_URL,
  DOCS_URL,
  LANDING_URL,
  isAppSubdomain,
  isLandingDomain,
  navigate,
} from '@/lib/router'
import { cn } from '@/lib/utils'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger)
}

const DEFAULT_ESCROW_ADDRESS = '0xf719ebbc5080aee09e38909764b897e0bf01a9b0' as const

export interface MagneticAnchorProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  spaTo?: string
}

const MagneticButton = React.forwardRef<HTMLAnchorElement, MagneticAnchorProps>(
  ({ className, children, spaTo, onClick, ...props }, forwardedRef) => {
    const localRef = useRef<HTMLAnchorElement | null>(null)

    useEffect(() => {
      if (typeof window === 'undefined') return
      if (!window.matchMedia('(hover: hover)').matches) return
      const element = localRef.current
      if (!element) return

      const ctx = gsap.context(() => {
        const handleMouseMove = (e: MouseEvent) => {
          const rect = element.getBoundingClientRect()
          const halfW = rect.width / 2
          const halfH = rect.height / 2
          const x = e.clientX - rect.left - halfW
          const y = e.clientY - rect.top - halfH

          gsap.to(element, {
            x: x * 0.36,
            y: y * 0.36,
            rotationX: -y * 0.14,
            rotationY: x * 0.14,
            scale: 1.05,
            ease: 'power2.out',
            duration: 0.38,
          })
        }

        const handleMouseLeave = () => {
          gsap.to(element, {
            x: 0,
            y: 0,
            rotationX: 0,
            rotationY: 0,
            scale: 1,
            ease: 'elastic.out(1, 0.32)',
            duration: 1.1,
          })
        }

        element.addEventListener('mousemove', handleMouseMove)
        element.addEventListener('mouseleave', handleMouseLeave)

        return () => {
          element.removeEventListener('mousemove', handleMouseMove)
          element.removeEventListener('mouseleave', handleMouseLeave)
        }
      }, element)

      return () => ctx.revert()
    }, [])

    return (
      <a
        ref={(node) => {
          localRef.current = node
          if (typeof forwardedRef === 'function') forwardedRef(node)
          else if (forwardedRef) forwardedRef.current = node
        }}
        className={cn('cursor-pointer select-none', className)}
        onClick={(e: ReactMouseEvent<HTMLAnchorElement>) => {
          onClick?.(e)
          if (!spaTo || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          navigate(spaTo)
        }}
        {...props}
      >
        {children}
      </a>
    )
  },
)
MagneticButton.displayName = 'MagneticButton'

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function MarqueeItem() {
  return (
    <div className="flex items-center space-x-8 px-4 sm:space-x-12 sm:px-6">
      <span>Non-Custodial Escrow</span>
      <span style={{ color: 'var(--accent)' }}>✦</span>
      <span>0% P2P Trade Fee</span>
      <span style={{ color: 'var(--accent)' }}>✦</span>
      <span>South Asia Corridors</span>
      <span style={{ color: 'var(--accent)' }}>✦</span>
      <span>Instant Stablecoin Swap</span>
      <span style={{ color: 'var(--accent)' }}>✦</span>
      <span>Circle CCTP &amp; CCTPx</span>
      <span style={{ color: 'var(--accent)' }}>✦</span>
    </div>
  )
}

function resolveAppLink(path: string): { href: string; spaTo?: string } {
  if (isLandingDomain()) {
    return { href: `${APP_URL}${path}` }
  }
  return { href: path, spaTo: path }
}

function resolveLandingLink(path: string): { href: string; spaTo?: string } {
  if (isAppSubdomain()) {
    return { href: `${LANDING_URL}${path}` }
  }
  return { href: path, spaTo: path }
}

export function CinematicFooter() {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const giantTextRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const linksRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!wrapperRef.current) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        giantTextRef.current,
        { y: '10vh', scale: 0.84, opacity: 0 },
        {
          y: '0vh',
          scale: 1,
          opacity: 1,
          ease: 'power1.out',
          scrollTrigger: {
            trigger: wrapperRef.current,
            start: 'top 85%',
            end: 'bottom-=24 bottom',
            scrub: 1,
          },
        },
      )

      gsap.fromTo(
        [headingRef.current, linksRef.current],
        { y: 44, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          stagger: 0.14,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: wrapperRef.current,
            start: 'top 60%',
            end: 'bottom-=24 bottom',
            scrub: 1,
          },
        },
      )
    }, wrapperRef)

    const refreshId = window.setTimeout(() => ScrollTrigger.refresh(), 120)
    return () => {
      window.clearTimeout(refreshId)
      ctx.revert()
    }
  }, [])

  const p2pLink = resolveAppLink('/p2p')
  const swapLink = resolveAppLink('/swap')
  const bridgeLink = resolveAppLink('/bridge')
  const assistantLink = resolveAppLink('/assistant')

  const docsExternal = isLandingDomain() || isAppSubdomain()
  const brandKitLink = resolveLandingLink('/brand-kit')
  const privacyLink = { href: '/privacy', spaTo: '/privacy' }
  const escrowHref = buildAddressExplorerUrl(CHAIN_ID, ESCROW_ADDRESS ?? DEFAULT_ESCROW_ADDRESS)

  return (
    <div
      ref={wrapperRef}
      className="relative h-dvh min-h-[640px] w-full"
      style={{ clipPath: 'polygon(0% 0, 100% 0%, 100% 100%, 0 100%)' }}
    >
      <footer
        className="cinematic-footer-wrapper fixed bottom-0 left-0 flex h-dvh min-h-[640px] w-full flex-col justify-between overflow-hidden"
        style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)' }}
      >
        {/* Ambient OnPeer Orange Aurora & Grid Background */}
        <div className="footer-aurora animate-footer-breathe pointer-events-none absolute left-1/2 top-1/2 z-0 h-[58vh] w-[82vw] -translate-x-1/2 -translate-y-1/2 rounded-[50%] blur-[80px]" />
        <div className="footer-bg-grid pointer-events-none absolute inset-0 z-0" />

        {/* Giant background brand watermark */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -bottom-[3vh] z-0 flex justify-center select-none"
        >
          <div ref={giantTextRef} className="footer-giant-bg-text whitespace-nowrap">
            ONPEER
          </div>
        </div>

        {/* 1. Diagonal Sleek Marquee */}
        <div
          className="absolute left-0 top-7 z-10 w-full -rotate-2 scale-110 overflow-hidden border-y py-3.5 shadow-2xl backdrop-blur-md sm:top-11 sm:py-4"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--footer-marquee-bg)',
          }}
        >
          <div
            className="animate-footer-scroll-marquee flex w-max text-[11px] font-bold uppercase tracking-[0.26em] sm:text-xs md:text-sm"
            style={{ color: 'var(--muted)' }}
          >
            <MarqueeItem />
            <MarqueeItem />
          </div>
        </div>

        {/* 2. Main Center Content */}
        <div className="relative z-10 mx-auto mt-16 flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 sm:mt-20 sm:px-6">
          <h2
            ref={headingRef}
            className="footer-text-glow mb-7 pb-2 text-center text-4xl font-black leading-[1.08] tracking-tighter sm:mb-10 sm:text-6xl md:text-8xl"
          >
            Ready to trade?
          </h2>

          {/* Interactive Magnetic Pills */}
          <div ref={linksRef} className="flex w-full flex-col items-center gap-4 sm:gap-5">
            {/* Primary Product Links: P2P market, Swap, Bridge, Assistant */}
            <div className="flex w-full flex-wrap justify-center gap-2.5 sm:gap-3.5">
              <MagneticButton
                href={p2pLink.href}
                spaTo={p2pLink.spaTo}
                className="footer-glass-pill group flex items-center gap-2.5 rounded-full px-5 py-3 text-xs font-bold sm:px-8 sm:py-4 sm:text-base"
                style={{ color: 'var(--ink)' }}
              >
                <ArrowLeftRight
                  className="size-4 transition-transform duration-300 group-hover:scale-110 sm:size-5"
                  style={{ color: 'var(--accent)' }}
                />
                P2P market
              </MagneticButton>

              <MagneticButton
                href={swapLink.href}
                spaTo={swapLink.spaTo}
                className="footer-glass-pill group flex items-center gap-2.5 rounded-full px-5 py-3 text-xs font-bold sm:px-8 sm:py-4 sm:text-base"
                style={{ color: 'var(--ink)' }}
              >
                <Repeat
                  className="size-4 transition-transform duration-300 group-hover:scale-110 sm:size-5"
                  style={{ color: 'var(--accent)' }}
                />
                Swap
              </MagneticButton>

              <MagneticButton
                href={bridgeLink.href}
                spaTo={bridgeLink.spaTo}
                className="footer-glass-pill group flex items-center gap-2.5 rounded-full px-5 py-3 text-xs font-bold sm:px-8 sm:py-4 sm:text-base"
                style={{ color: 'var(--ink)' }}
              >
                <Waypoints
                  className="size-4 transition-transform duration-300 group-hover:scale-110 sm:size-5"
                  style={{ color: 'var(--accent)' }}
                />
                Bridge
              </MagneticButton>

              <MagneticButton
                href={assistantLink.href}
                spaTo={assistantLink.spaTo}
                className="footer-glass-pill group flex items-center gap-2.5 rounded-full px-5 py-3 text-xs font-bold sm:px-8 sm:py-4 sm:text-base"
                style={{ color: 'var(--ink)' }}
              >
                <Sparkles
                  className="size-4 transition-transform duration-300 group-hover:scale-110 sm:size-5"
                  style={{ color: 'var(--accent)' }}
                />
                Assistant
              </MagneticButton>
            </div>

            {/* Secondary Resource & Social Links: Documentation, Brand kit, Privacy & encryption, Escrow contract, X */}
            <div className="mt-1 flex w-full flex-wrap justify-center gap-2 sm:gap-3.5">
              {docsExternal ? (
                <MagneticButton
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="footer-glass-pill inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-medium sm:px-5 sm:py-2.5 sm:text-sm"
                  style={{ color: 'var(--muted)' }}
                >
                  <BookOpen className="size-3.5" style={{ color: 'var(--accent)' }} />
                  Documentation
                </MagneticButton>
              ) : (
                <MagneticButton
                  href="/docs"
                  spaTo="/docs"
                  className="footer-glass-pill inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-medium sm:px-5 sm:py-2.5 sm:text-sm"
                  style={{ color: 'var(--muted)' }}
                >
                  <BookOpen className="size-3.5" style={{ color: 'var(--accent)' }} />
                  Documentation
                </MagneticButton>
              )}

              <MagneticButton
                href={brandKitLink.href}
                spaTo={brandKitLink.spaTo}
                className="footer-glass-pill inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-medium sm:px-5 sm:py-2.5 sm:text-sm"
                style={{ color: 'var(--muted)' }}
              >
                <Palette className="size-3.5" style={{ color: 'var(--accent)' }} />
                Brand kit
              </MagneticButton>

              <MagneticButton
                href={privacyLink.href}
                spaTo={privacyLink.spaTo}
                className="footer-glass-pill inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-medium sm:px-5 sm:py-2.5 sm:text-sm"
                style={{ color: 'var(--muted)' }}
              >
                <ShieldCheck className="size-3.5" style={{ color: 'var(--accent)' }} />
                Privacy &amp; encryption
              </MagneticButton>

              <MagneticButton
                href={escrowHref}
                target="_blank"
                rel="noopener noreferrer"
                className="footer-glass-pill inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-medium sm:px-5 sm:py-2.5 sm:text-sm"
                style={{ color: 'var(--muted)' }}
              >
                Escrow contract
                <ExternalLink className="size-3.5" style={{ color: 'var(--accent)' }} />
              </MagneticButton>

              <MagneticButton
                href="https://x.com/onpeerapp"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow OnPeer on X"
                className="footer-glass-pill inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-medium sm:px-5 sm:py-2.5 sm:text-sm"
                style={{ color: 'var(--muted)' }}
              >
                <XIcon className="size-3.5" />
                <span>@onpeerapp</span>
              </MagneticButton>
            </div>
          </div>
        </div>

        {/* 3. Bottom Bar (Copyright only — Crafted-by badge & Back-to-top button omitted as requested) */}
        <div className="relative z-20 flex w-full items-center justify-center px-6 pb-7 sm:pb-8 md:px-12">
          <div
            className="text-center text-[10px] font-semibold uppercase tracking-[0.2em] md:text-xs"
            style={{ color: 'var(--subtle)' }}
          >
            © 2026 OnPeer. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}
