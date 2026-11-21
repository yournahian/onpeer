import { useEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import { APP_URL, isLandingDomain, useRoute, useSearch } from '@/lib/router'
import { AgentChat } from '@/components/AgentChat'
import { AgentProvider } from '@/agent/AgentContext'
import { Backdrop } from '@/components/fx/Backdrop'
import { ScrollProgress } from '@/components/fx/ScrollProgress'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Footer } from '@/components/Footer'
import Home from '@/pages/Home'
import P2PPage from '@/pages/P2P'
import SwapPage from '@/pages/Swap'
import BridgePage from '@/pages/Bridge'
import BuyPage from '@/pages/Buy'
import AdminPage from '@/pages/Admin'
import AssistantPage from '@/pages/Assistant'
import BrandKitPage from '@/pages/BrandKit'
import PrivacyPage from '@/pages/Privacy'

export default function App() {
  const route = useRoute()
  const search = useSearch()
  const redirectToApp = isLandingDomain() && route !== 'home' && route !== 'brand-kit' && route !== 'privacy'

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
      {/* Plain keyed div + CSS fade: a route change swaps the page at once, with nothing that can hold it back. */}
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
