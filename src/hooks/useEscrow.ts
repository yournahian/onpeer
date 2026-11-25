import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { erc20Abi, parseAbiItem, type Address, type ContractFunctionReturnType } from 'viem'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { getUsdc } from '@/onchain-facts'
import {
  CHAIN_ID,
  CIRBTC_DEPLOY_BLOCK,
  CIRBTC_ESCROW_ADDRESS,
  DEPLOY_BLOCK,
  ESCROW_ADDRESS,
  EURC_DEPLOY_BLOCK,
  EURC_ESCROW_ADDRESS,
  P2P_ASSETS,
  WETH_DEPLOY_BLOCK,
  WETH_ESCROW_ADDRESS,
  decodeScopedId,
  defaultListingFeeFor,
  encodeScopedId,
  getEscrowConfig,
  type P2pAsset,
} from '@/lib/p2p'

export type Ad = ContractFunctionReturnType<typeof p2pEscrowAbi, 'view', 'getAd'>
export type Order = ContractFunctionReturnType<typeof p2pEscrowAbi, 'view', 'getOrder'>
export type Account = ContractFunctionReturnType<typeof p2pEscrowAbi, 'view', 'getAccount'>
export type DebtItem = ContractFunctionReturnType<typeof p2pEscrowAbi, 'view', 'getDebts'>[number]
export type AdWithId = Ad & { id: bigint; rawId: bigint; asset: P2pAsset }
export type OrderWithId = Order & { id: bigint; rawId: bigint; asset: P2pAsset }

const PAGE = 200n
const POLL = 15_000

const base = { address: ESCROW_ADDRESS, abi: p2pEscrowAbi, chainId: CHAIN_ID } as const
const eurcBase = { address: EURC_ESCROW_ADDRESS, abi: p2pEscrowAbi, chainId: CHAIN_ID } as const
const cirbtcBase = { address: CIRBTC_ESCROW_ADDRESS, abi: p2pEscrowAbi, chainId: CHAIN_ID } as const
const wethBase = { address: WETH_ESCROW_ADDRESS, abi: p2pEscrowAbi, chainId: CHAIN_ID } as const
const enabled = !!ESCROW_ADDRESS

export const USDC_ADDRESS = getUsdc(CHAIN_ID)?.address as Address | undefined

// ---- Reactive P2P Asset Store ('USDC' | 'EURC' | 'cirBTC' | 'WETH') ----
let currentP2pAsset: P2pAsset = 'USDC'
const assetListeners = new Set<() => void>()

export function setP2pAsset(next: P2pAsset): void {
  if (!P2P_ASSETS.includes(next) || currentP2pAsset === next) return
  currentP2pAsset = next
  for (const l of assetListeners) l()
}

function subscribeAsset(cb: () => void) {
  assetListeners.add(cb)
  return () => {
    assetListeners.delete(cb)
  }
}

export function useP2pAsset(): readonly [P2pAsset, (next: P2pAsset) => void] {
  const asset = useSyncExternalStore(subscribeAsset, () => currentP2pAsset, () => 'USDC' as P2pAsset)
  return [asset, setP2pAsset] as const
}

function escrowBaseFor(asset: P2pAsset) {
  if (asset === 'EURC') return eurcBase
  if (asset === 'cirBTC') return cirbtcBase
  if (asset === 'WETH') return wethBase
  return base
}

/** Ticks once per second so countdowns stay live. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function useSingleAssetAds(asset: P2pAsset) {
  const contractBase = escrowBaseFor(asset)
  const count = useReadContract({
    ...contractBase,
    functionName: 'adCount',
    query: { enabled, refetchInterval: POLL, placeholderData: (prev) => prev },
  })
  const total = count.data ?? 0n
  const offset = total > PAGE ? total - PAGE : 0n
  const list = useReadContract({
    ...contractBase,
    functionName: 'getAds',
    args: [offset, PAGE],
    query: { enabled, refetchInterval: POLL, placeholderData: (prev) => prev },
  })
  const ads = useMemo<AdWithId[]>(() => {
    const data = list.data
    if (!data) return []
    return data
      .map((ad, i) => {
        const rawId = offset + BigInt(i) + 1n
        return { ...ad, rawId, id: encodeScopedId(asset, rawId), asset }
      })
      .reverse()
  }, [list.data, offset, asset])
  return {
    ads,
    isLoading: enabled && list.data === undefined && list.isLoading,
    total: total || BigInt(ads.length),
  }
}

/** Reads ads for the selected asset (or explicit override). */
export function useAds(assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  return useSingleAssetAds(assetOverride ?? activeAsset)
}

/** Reads ALL 4 asset markets (USDC, EURC, cirBTC, WETH) merged together. */
export function useAllAds() {
  const usdc = useSingleAssetAds('USDC')
  const eurc = useSingleAssetAds('EURC')
  const cirbtc = useSingleAssetAds('cirBTC')
  const weth = useSingleAssetAds('WETH')
  const ads = useMemo(
    () => [...usdc.ads, ...eurc.ads, ...cirbtc.ads, ...weth.ads].sort((a, b) => Number(b.createdAt - a.createdAt)),
    [usdc.ads, eurc.ads, cirbtc.ads, weth.ads],
  )
  return {
    ads,
    isLoading: usdc.isLoading && eurc.isLoading && cirbtc.isLoading && weth.isLoading,
    total: usdc.total + eurc.total + cirbtc.total + weth.total,
  }
}

function useSingleAssetOrders(asset: P2pAsset) {
  const contractBase = escrowBaseFor(asset)
  const count = useReadContract({
    ...contractBase,
    functionName: 'orderCount',
    query: { enabled, refetchInterval: POLL, placeholderData: (prev) => prev },
  })
  const total = count.data ?? 0n
  const offset = total > PAGE ? total - PAGE : 0n
  const list = useReadContract({
    ...contractBase,
    functionName: 'getOrders',
    args: [offset, PAGE],
    query: { enabled, refetchInterval: POLL, placeholderData: (prev) => prev },
  })
  const orders = useMemo<OrderWithId[]>(() => {
    if (!list.data) return []
    return list.data.map((o, i) => {
      const rawId = offset + BigInt(i) + 1n
      return { ...o, rawId, id: encodeScopedId(asset, rawId), asset }
    })
  }, [list.data, offset, asset])
  return { orders, isLoading: list.data === undefined && list.isLoading }
}

/** Reads ALL 4 asset markets (USDC, EURC, cirBTC, WETH) orders merged & sorted newest-first. */
export function useOrders() {
  const usdc = useSingleAssetOrders('USDC')
  const eurc = useSingleAssetOrders('EURC')
  const cirbtc = useSingleAssetOrders('cirBTC')
  const weth = useSingleAssetOrders('WETH')

  const orders = useMemo<OrderWithId[]>(
    () =>
      [...usdc.orders, ...eurc.orders, ...cirbtc.orders, ...weth.orders].sort((a, b) =>
        Number(b.createdAt - a.createdAt),
      ),
    [usdc.orders, eurc.orders, cirbtc.orders, weth.orders],
  )

  return {
    orders,
    isLoading: enabled && usdc.isLoading,
  }
}

export function useOrder(scopedId: bigint | undefined) {
  const decoded = scopedId !== undefined ? decodeScopedId(scopedId) : { asset: 'USDC' as P2pAsset, rawId: 0n }
  const contractBase = escrowBaseFor(decoded.asset)
  const res = useReadContract({
    ...contractBase,
    functionName: 'getOrder',
    args: [decoded.rawId],
    query: { enabled: enabled && scopedId !== undefined && decoded.rawId > 0n, refetchInterval: 4_000 },
  })
  const order = res.data
  return {
    order:
      order && order.status !== 0 && scopedId !== undefined
        ? ({ ...order, id: scopedId, rawId: decoded.rawId, asset: decoded.asset } as OrderWithId)
        : undefined,
    isLoading: res.isLoading,
  }
}

export function useAccounts(addresses: Address[], assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const unique = useMemo(
    () => Array.from(new Set(addresses.map((m) => m.toLowerCase()))) as Address[],
    [addresses],
  )
  const res = useReadContracts({
    contracts: unique.map((m) => ({ ...contractBase, functionName: 'getAccount' as const, args: [m] as const })),
    query: { enabled: enabled && unique.length > 0, refetchInterval: 20_000 },
  })
  return useMemo(() => {
    const map = new Map<string, Account>()
    unique.forEach((m, i) => {
      const r = res.data?.[i]
      if (r?.status === 'success') map.set(m, r.result as Account)
    })
    return map
  }, [res.data, unique])
}

export function useMyAccount(assetOverride?: P2pAsset) {
  const { address } = useAccount()
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const res = useReadContract({
    ...contractBase,
    functionName: 'getAccount',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: POLL, placeholderData: (prev) => prev },
  })
  return res.data
}

export function useDebts(address: Address | undefined, assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const res = useReadContract({
    ...contractBase,
    functionName: 'getDebts',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: POLL },
  })
  return res.data ?? []
}

export function useDisputeWaived(address: Address | undefined, assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const res = useReadContract({
    ...contractBase,
    functionName: 'disputeLimitWaived',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: POLL },
  })
  return res.data === true
}

export function usePaused(assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const res = useReadContract({ ...contractBase, functionName: 'paused', query: { enabled, refetchInterval: 15_000 } })
  return res.data === true
}

export function usePrivacySwitches(assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const sealed = useReadContract({ ...contractBase, functionName: 'sealedEnabled', query: { enabled, refetchInterval: 15_000 } })
  const payerProof = useReadContract({ ...contractBase, functionName: 'payerProofRequired', query: { enabled, refetchInterval: 15_000 } })
  const kyc = useReadContract({ ...contractBase, functionName: 'kycRequired', query: { enabled, refetchInterval: 15_000 } })
  return {
    sealedEnabled: sealed.data === true,
    payerProofRequired: payerProof.data === true,
    kycRequired: kyc.data === true,
    isLoading: sealed.isLoading || payerProof.isLoading || kyc.isLoading,
  }
}

export function useListingFee(assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const target = assetOverride ?? activeAsset
  const contractBase = escrowBaseFor(target)
  const res = useReadContract({ ...contractBase, functionName: 'listingFee', query: { enabled, refetchInterval: 20_000 } })
  return res.data ?? defaultListingFeeFor(target)
}

export function useFeeConfig(assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const target = assetOverride ?? activeAsset
  const contractBase = escrowBaseFor(target)
  const fee = useReadContract({ ...contractBase, functionName: 'listingFee', query: { enabled, refetchInterval: 15_000 } })
  const recipient = useReadContract({ ...contractBase, functionName: 'feeRecipient', query: { enabled, refetchInterval: 15_000 } })
  const accrued = useReadContract({ ...contractBase, functionName: 'feesAccrued', query: { enabled, refetchInterval: POLL } })
  return {
    listingFee: fee.data ?? defaultListingFeeFor(target),
    feeRecipient: recipient.data,
    feesAccrued: accrued.data ?? 0n,
    isLoading: fee.isLoading || recipient.isLoading || accrued.isLoading,
  }
}

export function useVerifier(assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const res = useReadContract({ ...contractBase, functionName: 'verifier', query: { enabled, refetchInterval: 20_000 } })
  return res.data
}

export type KycInfo = { verified: boolean; level: number; expiry: bigint; isLoading?: boolean }

export function useVerification(address: Address | undefined, assetOverride?: P2pAsset): KycInfo {
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const ver = useReadContract({
    ...contractBase,
    functionName: 'verification',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: 15_000, placeholderData: (prev) => prev },
  })
  const ok = useReadContract({
    ...contractBase,
    functionName: 'isVerified',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: 15_000, placeholderData: (prev) => prev },
  })
  const level = ver.data ? Number(ver.data[0]) : 0
  const expiry = ver.data ? ver.data[1] : 0n
  return { verified: ok.data === true, level, expiry, isLoading: ok.isLoading || ver.isLoading }
}

export function useVerifications(addresses: Address[], assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const unique = useMemo(
    () => Array.from(new Set(addresses.map((m) => m.toLowerCase()))) as Address[],
    [addresses],
  )
  const now = useNow()
  const res = useReadContracts({
    contracts: unique.map((m) => ({ ...contractBase, functionName: 'verification' as const, args: [m] as const })),
    query: { enabled: enabled && unique.length > 0, refetchInterval: 20_000 },
  })
  return useMemo(() => {
    const map = new Map<string, KycInfo>()
    unique.forEach((m, i) => {
      const r = res.data?.[i]
      if (r?.status === 'success') {
        const [lvl, exp] = r.result as readonly [number, bigint]
        map.set(m, { verified: lvl > 0 && BigInt(now) <= exp, level: Number(lvl), expiry: exp })
      }
    })
    return map
  }, [res.data, unique, now])
}

export type ChatMessage = { sender: Address; text: string; block: bigint; index: number }

const messageEvent = parseAbiItem(
  'event OrderMessage(uint256 indexed orderId, address indexed sender, string text)',
)

const orderLifecycleEvents = [
  parseAbiItem(
    'event OrderOpened(uint256 indexed orderId, uint256 indexed adId, address indexed buyer, address seller, uint128 amount)',
  ),
  parseAbiItem('event OrderReleased(uint256 indexed orderId, address indexed buyer, uint128 amount)'),
  parseAbiItem('event OrderCancelled(uint256 indexed orderId, address indexed caller)'),
  parseAbiItem(
    'event DisputeResolved(uint256 indexed orderId, bool toBuyer, address indexed recipient, uint128 amount)',
  ),
  parseAbiItem(
    'event DisputeSettled(uint256 indexed orderId, address indexed caller, address indexed recipient, uint128 amount)',
  ),
] as const

/** Maps scopedOrderId.toString() -> latest lifecycle transactionHash across all 4 escrows. */
export function useOrderTxHashes() {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const query = useQuery({
    queryKey: [
      'p2p-order-tx-hashes',
      ESCROW_ADDRESS,
      EURC_ESCROW_ADDRESS,
      CIRBTC_ESCROW_ADDRESS,
      WETH_ESCROW_ADDRESS,
    ],
    enabled: enabled && !!client,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Record<string, string>> => {
      if (!client || !ESCROW_ADDRESS) return {}
      const head = await client.getBlockNumber()

      const collect = async (addr: Address, fromStart: bigint, asset: P2pAsset) => {
        const fetchRange = async (fromBlock: bigint) =>
          client.getLogs({
            address: addr,
            events: orderLifecycleEvents,
            fromBlock,
            toBlock: head,
          })
        let logs
        try {
          logs = await fetchRange(fromStart)
        } catch {
          logs = await fetchRange(head > 25_000n ? head - 25_000n : 0n)
        }
        const entries: Array<[string, string]> = []
        for (const l of logs) {
          const oid = l.args.orderId
          if (oid !== undefined && l.transactionHash) {
            entries.push([encodeScopedId(asset, oid).toString(), l.transactionHash])
          }
        }
        return entries
      }

      const [usdcEntries, eurcEntries, cirbtcEntries, wethEntries] = await Promise.all([
        collect(ESCROW_ADDRESS, DEPLOY_BLOCK, 'USDC'),
        collect(EURC_ESCROW_ADDRESS, EURC_DEPLOY_BLOCK, 'EURC').catch(() => [] as Array<[string, string]>),
        collect(CIRBTC_ESCROW_ADDRESS, CIRBTC_DEPLOY_BLOCK, 'cirBTC').catch(() => [] as Array<[string, string]>),
        collect(WETH_ESCROW_ADDRESS, WETH_DEPLOY_BLOCK, 'WETH').catch(() => [] as Array<[string, string]>),
      ])

      const out: Record<string, string> = {}
      for (const [k, v] of [...usdcEntries, ...eurcEntries, ...cirbtcEntries, ...wethEntries]) {
        out[k] = v
      }
      return out
    },
  })
  return query.data ?? {}
}

export function useOrderMessages(scopedOrderId: bigint) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const decoded = decodeScopedId(scopedOrderId)
  const cfg = getEscrowConfig(decoded.asset)
  return useQuery({
    queryKey: ['order-messages', scopedOrderId.toString()],
    enabled: enabled && !!client,
    refetchInterval: 5_000,
    queryFn: async (): Promise<ChatMessage[]> => {
      if (!client) return []
      const head = await client.getBlockNumber()
      const fetchFrom = async (fromBlock: bigint) =>
        client.getLogs({
          address: cfg.escrowAddress,
          event: messageEvent,
          args: { orderId: decoded.rawId },
          fromBlock,
          toBlock: head,
        })
      let logs
      try {
        logs = await fetchFrom(cfg.deployBlock)
      } catch {
        logs = await fetchFrom(head > 9_000n ? head - 9_000n : 0n)
      }
      return logs.map((l) => ({
        sender: l.args.sender as Address,
        text: l.args.text as string,
        block: l.blockNumber,
        index: l.logIndex,
      }))
    },
  })
}

export function useUsdcBalance(assetOverride?: P2pAsset) {
  const { address } = useAccount()
  const [activeAsset] = useP2pAsset()
  const cfg = getEscrowConfig(assetOverride ?? activeAsset)
  const res = useReadContract({
    address: cfg.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Address],
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 10_000 },
  })
  return res.data
}

export function useUsdcAllowance(assetOverride?: P2pAsset) {
  const { address } = useAccount()
  const [activeAsset] = useP2pAsset()
  const cfg = getEscrowConfig(assetOverride ?? activeAsset)
  const res = useReadContract({
    address: cfg.tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [address as Address, cfg.escrowAddress],
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 10_000 },
  })
  return res.data
}

export function useOpenOrderCount(assetOverride?: P2pAsset) {
  const { address } = useAccount()
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const res = useReadContract({
    ...contractBase,
    functionName: 'openOrderCount',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: POLL },
  })
  return Number(res.data ?? 0n)
}

export function useClaimable(assetOverride?: P2pAsset) {
  const { address } = useAccount()
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const res = useReadContract({
    ...contractBase,
    functionName: 'claimable',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: POLL },
  })
  return res.data ?? 0n
}

export function useArbiter(assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const res = useReadContract({ ...contractBase, functionName: 'arbiter', query: { enabled, refetchInterval: 30_000 } })
  return res.data
}

export function useBackupArbiter(assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const res = useReadContract({ ...contractBase, functionName: 'backupArbiter', query: { enabled, refetchInterval: 30_000 } })
  return res.data
}

export function useOwner(assetOverride?: P2pAsset) {
  const [activeAsset] = useP2pAsset()
  const contractBase = escrowBaseFor(assetOverride ?? activeAsset)
  const res = useReadContract({ ...contractBase, functionName: 'owner', query: { enabled, refetchInterval: 30_000 } })
  return res.data
}
