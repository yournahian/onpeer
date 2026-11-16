import { MotionConfig } from 'framer-motion'
import { useRoute, useSearch } from '@/lib/router'
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
import AdminPage from '@/pages/Admin'
import AssistantPage from '@/pages/Assistant'
import BrandKitPage from '@/pages/BrandKit'

export default function App() {
  const route = useRoute()
  const search = useSearch()
  // Swap and Bridge read their prefill from the URL on mount, so a new link remounts them.
  const page =
    route === 'p2p' ? (
      <P2PPage />
    ) : route === 'swap' ? (
      <SwapPage key={search} />
    ) : route === 'bridge' ? (
      <BridgePage key={search} />
    ) : route === 'admin' ? (
      <AdminPage />
    ) : route === 'assistant' ? (
      <AssistantPage />
    ) : route === 'brand-kit' ? (
      <BrandKitPage />
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
        <Footer />
      </div>
      <ErrorBoundary label="assistant" fallback={null}>
        <AgentChat route={route} />
      </ErrorBoundary>
      </AgentProvider>
    </MotionConfig>
  )
}
