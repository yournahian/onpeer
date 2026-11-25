import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { apiFetch, useBackendSession } from '@/lib/api'
import { shortAddr } from '@/lib/p2p'
import type { OrderWithId } from '@/hooks/useEscrow'
import { STATUS } from '@/lib/p2p'

export interface PublicTraderSummary {
  wallet: `0x${string}`
  displayName: string | null
  country: string | null
  emailVerified: boolean
  kycApproved: boolean
  joinedAt: string | null
  followersCount: number
  followingCount: number
  positiveCount: number
  negativeCount: number
  totalFeedback: number
  positivePct: number | null
  avgRating: number | null
}

export interface FeedbackItem {
  id: string
  orderId: string
  fromWallet: string
  fromDisplayName: string | null
  toWallet: string
  rating: number
  positive: boolean
  comment: string
  anonymous: boolean
  createdAt: string
}

export interface TraderDetailPayload {
  profile: PublicTraderSummary
  viewerFollowing: boolean
  viewerBlocked: boolean
  feedback: FeedbackItem[]
}

export function traderLabel(wallet?: string | null, profile?: PublicTraderSummary | null): string {
  if (!wallet) return 'Unknown'
  const alias = profile?.displayName?.trim()
  return alias ? alias : shortAddr(wallet)
}

export function traderInitial(wallet?: string | null, profile?: PublicTraderSummary | null): string {
  const alias = profile?.displayName?.trim()
  if (alias && alias.length > 0) {
    const ch = alias.replace(/[^A-Za-z0-9]/g, '')[0] ?? alias[0]!
    return ch.toUpperCase()
  }
  if (!wallet || wallet.length < 4) return 'T'
  return wallet.slice(2, 3).toUpperCase()
}

export interface ComputedTradeMetrics {
  trades30d: number
  completion30dPct: string
  avgReleaseMin: string
  avgPayMin: string
  allCompleted: number
  buyCompleted: number
  sellCompleted: number
  counterpartiesCount: number
  firstTradeDaysAgo: number | null
  volume30dUsdc: bigint
  buyVolumeUsdc: bigint
  sellVolumeUsdc: bigint
}

export function computeTraderOrderMetrics(
  wallet: string | undefined,
  orders: OrderWithId[],
  nowSec: number,
  onchainCompleted?: number,
  onchainCreated?: number,
): ComputedTradeMetrics {
  if (!wallet) {
    return {
      trades30d: 0,
      completion30dPct: '100.00%',
      avgReleaseMin: '—',
      avgPayMin: '0.00',
      allCompleted: 0,
      buyCompleted: 0,
      sellCompleted: 0,
      counterpartiesCount: 0,
      firstTradeDaysAgo: null,
      volume30dUsdc: 0n,
      buyVolumeUsdc: 0n,
      sellVolumeUsdc: 0n,
    }
  }
  const w = wallet.toLowerCase()
  const cutoff30d = nowSec - 30 * 86_400

  let created30d = 0
  let completed30d = 0
  let buyCompleted = 0
  let sellCompleted = 0
  let volume30dUsdc = 0n
  let buyVolumeUsdc = 0n
  let sellVolumeUsdc = 0n
  let payTotalSec = 0
  let paySamples = 0
  let releaseTotalSec = 0
  let releaseSamples = 0
  let earliestSec: number | null = null
  const counterparties = new Set<string>()

  for (const o of orders) {
    const isBuyer = o.buyer.toLowerCase() === w
    const isSeller = o.seller.toLowerCase() === w
    if (!isBuyer && !isSeller) continue

    const createdSec = Number(o.createdAt)
    const isCompleted = o.status === STATUS.COMPLETED || o.status === STATUS.RESOLVED_BUYER
    const usdcEquiv = o.asset === 'USDC' || o.asset === 'EURC' ? o.amount : 0n
    if (createdSec >= cutoff30d) {
      created30d++
      if (isCompleted) {
        completed30d++
        volume30dUsdc += usdcEquiv
      }
    }

    if (isCompleted) {
      if (isBuyer) {
        buyCompleted++
        buyVolumeUsdc += usdcEquiv
        counterparties.add(o.seller.toLowerCase())
      } else {
        sellCompleted++
        sellVolumeUsdc += usdcEquiv
        counterparties.add(o.buyer.toLowerCase())
      }
      if (earliestSec === null || createdSec < earliestSec) {
        earliestSec = createdSec
      }
    }

    if (isBuyer && o.paidAt > o.createdAt) {
      payTotalSec += Number(o.paidAt - o.createdAt)
      paySamples++
    }
  }

  const totalCompletedFromOrders = buyCompleted + sellCompleted
  const allCompleted = Math.max(onchainCompleted ?? 0, totalCompletedFromOrders)

  let completion30dPct = '100.00%'
  if (created30d > 0) {
    completion30dPct = `${((completed30d / created30d) * 100).toFixed(2)}%`
  } else if (onchainCreated && onchainCreated > 0 && onchainCompleted !== undefined) {
    completion30dPct = `${((onchainCompleted / onchainCreated) * 100).toFixed(2)}%`
  }

  const avgPayMin = paySamples > 0 ? (payTotalSec / paySamples / 60).toFixed(2) : '0.00'
  // L-01b: Never display a synthetic 2.00m release time when exact release timestamps are not stored onchain
  const avgReleaseMin = releaseSamples > 0 ? (releaseTotalSec / releaseSamples / 60).toFixed(2) : '—'
  const firstTradeDaysAgo =
    earliestSec !== null ? Math.max(0, Math.floor((nowSec - earliestSec) / 86_400)) : null

  return {
    trades30d: completed30d || allCompleted,
    completion30dPct,
    avgReleaseMin,
    avgPayMin,
    allCompleted,
    buyCompleted,
    sellCompleted,
    counterpartiesCount: counterparties.size,
    firstTradeDaysAgo,
    volume30dUsdc,
    buyVolumeUsdc,
    sellVolumeUsdc,
  }
}

/** Batch load public display aliases & feedback summaries for up to 100 wallets. */
export function useTraderProfiles(wallets: string[]) {
  const uniqueSorted = useMemo(
    () =>
      Array.from(
        new Set(
          wallets
            .filter((w) => /^0x[0-9a-fA-F]{40}$/.test(w))
            .map((w) => w.toLowerCase()),
        ),
      )
        .slice(0, 100)
        .sort(),
    [wallets],
  )

  const key = uniqueSorted.join(',')
  const query = useQuery({
    queryKey: ['p2p-profiles-batch', key],
    queryFn: async () => {
      if (!key) return {} as Record<string, PublicTraderSummary>
      const res = await apiFetch<{ profiles: Record<string, PublicTraderSummary> }>(
        `/p2p/profiles?wallets=${encodeURIComponent(key)}`,
        { auth: false },
      )
      return res.profiles ?? {}
    },
    enabled: uniqueSorted.length > 0,
    staleTime: 25_000,
    placeholderData: (prev) => prev,
  })

  return useMemo(() => {
    const map = new Map<string, PublicTraderSummary>()
    const data = query.data
    if (data) {
      for (const [k, v] of Object.entries(data)) {
        map.set(k.toLowerCase(), v)
      }
    }
    return map
  }, [query.data])
}

/** Detailed trader profile + received feedback list + follow/block mutations. */
export function useTraderDetail(wallet: string | null | undefined) {
  const { address, isConnected } = useAccount()
  const session = useBackendSession()
  const queryClient = useQueryClient()

  const normTarget = wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet.toLowerCase() : null
  const viewerSignedIn = !!(isConnected && address && session && session.wallet === address.toLowerCase())

  const queryKey = ['p2p-trader-detail', normTarget, viewerSignedIn ? session?.wallet : 'anon'] as const

  const query = useQuery({
    queryKey,
    queryFn: () =>
      apiFetch<TraderDetailPayload>(`/p2p/profile/${normTarget}`, {
        auth: viewerSignedIn,
      }),
    enabled: !!normTarget,
    staleTime: 15_000,
  })

  const relationMutation = useMutation({
    mutationFn: (input: { target: string; kind: 'follow' | 'block'; active: boolean }) =>
      apiFetch<{ ok: boolean }>('/p2p/relations', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['p2p-trader-detail'] })
      void queryClient.invalidateQueries({ queryKey: ['p2p-my-relations'] })
      void queryClient.invalidateQueries({ queryKey: ['p2p-profiles-batch'] })
    },
  })

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    refetch: query.refetch,
    setRelation: relationMutation.mutateAsync,
    updatingRelation: relationMutation.isPending,
  }
}

/** Signed-in user's followed and blocked traders. */
export function useMyRelations() {
  const { address, isConnected } = useAccount()
  const session = useBackendSession()
  const queryClient = useQueryClient()
  const norm = address?.toLowerCase() ?? null
  const isSignedIn = !!(isConnected && norm && session && session.wallet === norm)

  const query = useQuery({
    queryKey: ['p2p-my-relations', norm, session?.token ?? null],
    queryFn: () =>
      apiFetch<{ following: PublicTraderSummary[]; blocked: PublicTraderSummary[] }>('/p2p/relations'),
    enabled: isSignedIn,
    staleTime: 20_000,
  })

  const toggleMutation = useMutation({
    mutationFn: (input: { target: string; kind: 'follow' | 'block'; active: boolean }) =>
      apiFetch<{ ok: boolean }>('/p2p/relations', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['p2p-my-relations'] })
      void queryClient.invalidateQueries({ queryKey: ['p2p-trader-detail'] })
      void queryClient.invalidateQueries({ queryKey: ['p2p-profiles-batch'] })
    },
  })

  const followingSet = useMemo(
    () => new Set((query.data?.following ?? []).map((p) => p.wallet.toLowerCase())),
    [query.data?.following],
  )
  const blockedSet = useMemo(
    () => new Set((query.data?.blocked ?? []).map((p) => p.wallet.toLowerCase())),
    [query.data?.blocked],
  )

  return {
    isSignedIn,
    following: query.data?.following ?? [],
    blocked: query.data?.blocked ?? [],
    followingSet,
    blockedSet,
    isLoading: query.isLoading,
    setRelation: toggleMutation.mutateAsync,
    updating: toggleMutation.isPending,
  }
}

/** Post-trade feedback & rating for a completed order. */
export function useOrderFeedback(orderId: bigint | null | undefined, enabled = true) {
  const session = useBackendSession()
  const queryClient = useQueryClient()
  const idStr = orderId !== null && orderId !== undefined ? orderId.toString() : null

  const query = useQuery({
    queryKey: ['p2p-order-feedback', idStr, session?.wallet ?? 'anon'],
    queryFn: () =>
      apiFetch<{ orderId: string; items: FeedbackItem[] }>(`/orders/${idStr}/feedback`, {
        auth: !!session,
      }),
    enabled: enabled && !!idStr,
    staleTime: 10_000,
  })

  const submitMutation = useMutation({
    mutationFn: (input: {
      rating: number
      positive: boolean
      comment: string
      anonymous?: boolean
    }) =>
      apiFetch<{ orderId: string; items: FeedbackItem[] }>(`/orders/${idStr}/feedback`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(['p2p-order-feedback', idStr, session?.wallet ?? 'anon'], res)
      void queryClient.invalidateQueries({ queryKey: ['p2p-trader-detail'] })
      void queryClient.invalidateQueries({ queryKey: ['p2p-profiles-batch'] })
    },
  })

  return {
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    submitFeedback: submitMutation.mutateAsync,
    submitting: submitMutation.isPending,
  }
}

// ---- Local Storage Helpers: Recently Viewed, Saved Filters & Custom Alerts ----

export interface RecentlyViewedTrader {
  wallet: string
  displayName: string | null
  adId?: string
  priceText?: string
  currency?: string
  viewedAt: string
}

const RECENT_KEY = 'onpeer:p2p:recent_viewed'
const FILTER_KEY = 'onpeer:p2p:saved_filter'
const ALERTS_KEY = 'onpeer:p2p:custom_alerts'

export function loadRecentlyViewed(): RecentlyViewedTrader[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as RecentlyViewedTrader[]).slice(0, 25) : []
  } catch {
    return []
  }
}

export function recordRecentlyViewed(item: Omit<RecentlyViewedTrader, 'viewedAt'>): void {
  if (typeof window === 'undefined') return
  try {
    const prev = loadRecentlyViewed().filter((x) => x.wallet.toLowerCase() !== item.wallet.toLowerCase())
    const next: RecentlyViewedTrader[] = [
      { ...item, wallet: item.wallet.toLowerCase(), viewedAt: new Date().toISOString() },
      ...prev,
    ].slice(0, 25)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // ignore storage quota errors
  }
}

export function clearRecentlyViewed(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(RECENT_KEY)
  } catch {
    // ignore
  }
}

export interface SavedP2pFilterState {
  saveForNextUse: boolean
  tradableOnly: boolean
  merchantsOnly: boolean
  kycOnly: boolean
  noVerificationOnly: boolean
  beginnerFriendlyOnly: boolean
  tradedWithOnly: boolean
  followedOnly: boolean
  windowLimitMin: number | null
  sortBy: 'price' | 'trades' | 'completion'
}

export const DEFAULT_P2P_FILTER: SavedP2pFilterState = {
  saveForNextUse: false,
  tradableOnly: false,
  merchantsOnly: false,
  kycOnly: false,
  noVerificationOnly: false,
  beginnerFriendlyOnly: false,
  tradedWithOnly: false,
  followedOnly: false,
  windowLimitMin: null,
  sortBy: 'price',
}

export function loadSavedP2pFilter(): SavedP2pFilterState {
  if (typeof window === 'undefined') return DEFAULT_P2P_FILTER
  try {
    const raw = window.localStorage.getItem(FILTER_KEY)
    if (!raw) return DEFAULT_P2P_FILTER
    const parsed = JSON.parse(raw) as Partial<SavedP2pFilterState>
    if (!parsed.saveForNextUse) return DEFAULT_P2P_FILTER
    return { ...DEFAULT_P2P_FILTER, ...parsed }
  } catch {
    return DEFAULT_P2P_FILTER
  }
}

export function persistP2pFilter(state: SavedP2pFilterState): void {
  if (typeof window === 'undefined') return
  try {
    if (state.saveForNextUse) {
      window.localStorage.setItem(FILTER_KEY, JSON.stringify(state))
    } else {
      window.localStorage.removeItem(FILTER_KEY)
    }
  } catch {
    // ignore
  }
}

export interface CustomPriceAlert {
  id: string
  currency: string
  side: 'buy' | 'sell'
  targetPrice: string
  createdAt: string
}

export function loadCustomAlerts(): CustomPriceAlert[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(ALERTS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as CustomPriceAlert[]) : []
  } catch {
    return []
  }
}

export function saveCustomAlerts(alerts: CustomPriceAlert[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts.slice(0, 20)))
  } catch {
    // ignore
  }
}
