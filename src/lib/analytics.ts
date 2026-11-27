import { ACTIVE_ARC_CHAIN } from '@/lib/network'

const VISIT_DAY_KEY = 'onpeer:an:visit-day'
const trackedRoutesThisSession = new Set<string>()

/** Fire-and-forget lightweight page visit ping (1x per route per browser session). */
export function trackVisit(route: string) {
  if (typeof window === 'undefined') return
  const key = route || 'home'
  if (trackedRoutesThisSession.has(key)) return
  trackedRoutesThisSession.add(key)

  const today = new Date().toISOString().slice(0, 10)
  let isUnique = false
  try {
    if (window.localStorage.getItem(VISIT_DAY_KEY) !== today) {
      window.localStorage.setItem(VISIT_DAY_KEY, today)
      isUnique = true
    }
  } catch {
    /* ignore storage errors */
  }

  void fetch('/api/analytics/visit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ route: key, isUnique }),
    keepalive: true,
  }).catch(() => undefined)
}

export interface TrackTxPayload {
  kind: 'p2p' | 'swap' | 'bridge'
  action: string
  wallet: string
  chain?: string
  token?: string
  amountUsd?: number
  networkFeeUsd?: number
  status: 'success' | 'failed'
  txHash?: string | null
  note?: string
}

/** Fire-and-forget transaction telemetry for Admin Analytics (never throws or blocks UX). */
export function trackTx(payload: TrackTxPayload) {
  if (typeof window === 'undefined' || !payload.wallet) return
  void fetch('/api/analytics/tx', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: payload.kind,
      action: payload.action.slice(0, 48),
      wallet: payload.wallet.toLowerCase(),
      chain: (payload.chain ?? ACTIVE_ARC_CHAIN.name).slice(0, 32),
      token: (payload.token ?? 'USDC').toUpperCase().slice(0, 16),
      amountUsd: Number.isFinite(payload.amountUsd) && (payload.amountUsd ?? 0) > 0 ? payload.amountUsd : 0,
      networkFeeUsd:
        Number.isFinite(payload.networkFeeUsd) && (payload.networkFeeUsd ?? 0) > 0 ? payload.networkFeeUsd : 0,
      status: payload.status,
      txHash: payload.txHash ?? undefined,
      note: payload.note?.slice(0, 200),
    }),
    keepalive: true,
  }).catch(() => undefined)
}

/** Compute exact gas fee in USDC (Arc native gas token has 18 decimals) from a viem transaction receipt. */
export function feeUsdFromReceipt(receipt?: { gasUsed?: bigint; effectiveGasPrice?: bigint } | null): number {
  if (!receipt?.gasUsed || !receipt?.effectiveGasPrice) return 0
  const wei = receipt.gasUsed * receipt.effectiveGasPrice
  const usdc = Number(wei) / 1e18
  return Number.isFinite(usdc) && usdc > 0 ? Number(usdc.toFixed(8)) : 0
}
