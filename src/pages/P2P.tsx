import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ESCROW_ADDRESS, sameAddr } from '@/lib/p2p'
import { useAds, useArbiter, type AdWithId } from '@/hooks/useEscrow'
import { replaceQuery, useSearch } from '@/lib/router'
import { Header, type TabId } from '@/components/Header'
import { Market } from '@/components/Market'
import { MyOrders, MyAds, ArbiterPanel } from '@/components/Lists'
import { TradeSheet } from '@/components/TradeSheet'
import { PostAdSheet } from '@/components/PostAdSheet'
import { OrderRoom } from '@/components/OrderRoom'
import { AccountPanel } from '@/components/AccountPanel'
import { Empty } from '@/components/ui'
import { P2PSidebar } from '@/components/P2PSidebar'
import { useEligibility } from '@/hooks/useEligibility'

const parseId = (raw: string | null): bigint | null => (raw && /^\d+$/.test(raw) ? BigInt(raw) : null)

export default function P2PPage() {
  const { address } = useAccount()
  const arbiter = useArbiter()
  const { blocked } = useEligibility()
  const [selectedTab, setTab] = useState<TabId>('market')
  const [tradeAd, setTradeAd] = useState<AdWithId | null>(null)
  const [postOpen, setPostOpen] = useState(false)
  const isArbiter = sameAddr(address, arbiter)
  const tab: TabId = selectedTab === 'arbiter' && !isArbiter ? 'market' : selectedTab
  const search = useSearch()
  const params = new URLSearchParams(search)
  const orderId = parseId(params.get('order'))
  const deepTradeId = parseId(params.get('trade'))
  const deepAmount = params.get('amount') ?? undefined
  const { ads } = useAds()
  const deepAd = deepTradeId !== null ? ads.find((a) => a.id === deepTradeId) : undefined
  const activeAd = tradeAd ?? deepAd ?? null

  const openOrder = (id: bigint | null) =>
    replaceQuery((p) => {
      if (id === null) p.delete('order')
      else p.set('order', id.toString())
    })
  const closeTrade = () => {
    setTradeAd(null)
    replaceQuery((p) => {
      p.delete('trade')
      p.delete('amount')
    })
  }

  return (
    <div className="min-h-dvh pb-24">
      <Header tab={tab} onTab={setTab} showArbiter={isArbiter} />

      <main className="w-full space-y-5 px-4 py-6 sm:px-8 lg:px-12">
        {blocked && (
          <div
            role="status"
            className="rounded-2xl px-4 py-3 text-sm"
            style={{ background: 'rgba(232,109,122,0.12)', color: 'var(--danger)' }}
          >
            {blocked}
          </div>
        )}
        {!ESCROW_ADDRESS ? (
          <Empty
            title="Marketplace contract not connected"
            body="The escrow contract address is not configured yet, so there is nothing to trade against."
          />
        ) : (
          <>
            {tab === 'market' && (
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <Market onTrade={setTradeAd} onPostAd={() => setPostOpen(true)} />
                <div className="lg:sticky lg:top-28">
                  <P2PSidebar onOpenOrder={openOrder} />
                </div>
              </div>
            )}
            {tab === 'orders' && <MyOrders onOpen={openOrder} />}
            {tab === 'ads' && <MyAds onPostAd={() => setPostOpen(true)} />}
            {tab === 'account' && <AccountPanel />}
            {tab === 'arbiter' && <ArbiterPanel onOpen={openOrder} />}
          </>
        )}

        <p className="pt-4 text-center text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
          Arc Testnet demo. Fiat payments happen outside this app, and payment details are public onchain. Check the
          rules for crypto trading in your country before you trade.
        </p>
      </main>

      <TradeSheet
        ad={activeAd}
        initialUsdc={tradeAd ? undefined : deepAmount}
        onClose={closeTrade}
        onOpened={(id) => {
          setTradeAd(null)
          setTab('orders')
          replaceQuery((p) => {
            p.delete('trade')
            p.delete('amount')
            p.set('order', id.toString())
          })
        }}
      />
      <PostAdSheet
        open={postOpen}
        onClose={() => {
          setPostOpen(false)
        }}
      />
      <OrderRoom orderId={orderId} onClose={() => openOrder(null)} />
    </div>
  )
}
