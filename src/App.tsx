import { useEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import { APP_URL, isLandingDomain, useRoute, useSearch } from '@/lib/router'
import { AgentChat } from '@/components/AgentChat'
import { AgentProvider } from '@/agent/AgentContext'
import { Backdrop } from '@/components/fx/Backdrop'
import { ScrollProgress } from '@/components/fx/ScrollProgress'
import { RibbonBackdrop } from '@/components/fx/RibbonBackdrop'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Footer } from '@/components/Footer'
import Home from '@/pages/Home'
import P2PPage from '@/pages/P2P'
import SwapPage from '@/pages/Swap'
import BridgePage from '@/pages/Bridge'
import BuyPage from '@/pages/Buy'
import AdminPage from '@/pages/Admin'
import AssistantPage from '@/pages/Assistant'
import DocsPage from '@/pages/Docs'
import BrandKitPage from '@/pages/BrandKit'
import PrivacyPage from '@/pages/Privacy'

// Routes that show the 3D RibbonBackdrop full-screen behind the page content.
const RIBBON_ROUTES = new Set(['swap', 'bridge', 'buy', 'assistant', 'p2p'])

export default function App() {
  const route = useRoute()
  const search = useSearch()
  const redirectToApp =
    isLandingDomain() &&
    route !== 'home' &&
    route !== 'docs' &&
    route !== 'brand-kit' &&
    route !== 'privacy'

  useEffect(() => {
    if (redirectToApp) {
      window.location.replace(`${APP_URL}${window.location.pathname}${window.location.search}`)
      return
    }
    if (window.location.pathname.startsWith('/cashout')) {
      const q = new URLSearchParams(window.location.search)
      if (!q.has('mode')) q.set('mode', 'sell')
      window.history.replaceState(null, '', `/p2p?${q.toString()}`)
    }
  }, [redirectToApp, search])

  if (redirectToApp) return null
  // Swap and Bridge read their prefill from the URL on mount, so a new link remounts them.
  const page =
    route === 'p2p' ? (
      <P2PPage />
    ) : route === 'swap' ? (
      <SwapPage key={search} />
    ) : route === 'bridge' ? (
      <BridgePage key={search} />
    ) : route === 'buy' ? (
      <BuyPage />
    ) : route === 'admin' ? (
      <AdminPage />
    ) : route === 'assistant' ? (
      <AssistantPage />
    ) : route === 'docs' ? (
      <DocsPage />
    ) : route === 'brand-kit' ? (
      <BrandKitPage />
    ) : route === 'privacy' ? (
      <PrivacyPage />
    ) : (
      <Home />
    )
  return (
    <MotionConfig reducedMotion="user">
      <AgentProvider route={route}>
      <Backdrop />
      <ScrollProgress />
      {/*
        RibbonBackdrop lives OUTSIDE the keyed page-in div so it is never torn down on route
        change — the WebGL context persists and the transition is seamless with no flash.
        Visibility is controlled by CSS (opacity 0 on routes that don't need it).
      */}
      {RIBBON_ROUTES.has(route) && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 bottom-0 z-0"
          style={{ top: route === 'p2p' ? '104px' : '0' }}
        >
          <RibbonBackdrop />
        </div>
      )}
      {/* Plain keyed div + CSS fade: a route change swaps the page at once. */}
      <div key={route} className="page-in">
        <ErrorBoundary key={route} label={route}>
          {page}
        </ErrorBoundary>
        {route === 'home' && <Footer />}
      </div>
      <ErrorBoundary label="assistant" fallback={null}>
        <AgentChat route={route} />
      </ErrorBoundary>
      </AgentProvider>
    </MotionConfig>
  )
}
