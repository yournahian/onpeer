import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { erc20Abi, parseAbiItem, type Address, type ContractFunctionReturnType } from 'viem'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { getUsdc } from '@/onchain-facts'
import { CHAIN_ID, DEFAULT_LISTING_FEE, DEPLOY_BLOCK, ESCROW_ADDRESS } from '@/lib/p2p'

export type Ad = ContractFunctionReturnType<typeof p2pEscrowAbi, 'view', 'getAd'>
export type Order = ContractFunctionReturnType<typeof p2pEscrowAbi, 'view', 'getOrder'>
export type Account = ContractFunctionReturnType<typeof p2pEscrowAbi, 'view', 'getAccount'>
export type DebtItem = ContractFunctionReturnType<typeof p2pEscrowAbi, 'view', 'getDebts'>[number]
export type AdWithId = Ad & { id: bigint }
export type OrderWithId = Order & { id: bigint }

const PAGE = 200n
const POLL = 15_000

const base = { address: ESCROW_ADDRESS, abi: p2pEscrowAbi, chainId: CHAIN_ID } as const
const enabled = !!ESCROW_ADDRESS

export const USDC_ADDRESS = getUsdc(CHAIN_ID)?.address as Address | undefined

/** Ticks once per second so countdowns stay live. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function useAds() {
  const count = useReadContract({
    ...base,
    functionName: 'adCount',
    query: { enabled, refetchInterval: POLL, placeholderData: (prev) => prev },
  })
  const total = count.data ?? 0n
  const offset = total > PAGE ? total - PAGE : 0n
  // P2PEscrow.getAds(offset, limit) clips to adCount on-chain, so we can fetch immediately without waiting on adCount.
  const list = useReadContract({
    ...base,
    functionName: 'getAds',
    args: [offset, PAGE],
    query: { enabled, refetchInterval: POLL, placeholderData: (prev) => prev },
  })
  const ads = useMemo<AdWithId[]>(() => {
    const data = list.data
    if (!data) return []
    return data.map((ad, i) => ({ ...ad, id: offset + BigInt(i) + 1n })).reverse()
  }, [list.data, offset])
  return { ads, isLoading: enabled && list.data === undefined && list.isLoading, total: total || BigInt(ads.length) }
}

export function useOrders() {
  const count = useReadContract({
    ...base,
    functionName: 'orderCount',
    query: { enabled, refetchInterval: POLL, placeholderData: (prev) => prev },
  })
  const total = count.data ?? 0n
  const offset = total > PAGE ? total - PAGE : 0n
  const list = useReadContract({
    ...base,
    functionName: 'getOrders',
    args: [offset, PAGE],
    query: { enabled, refetchInterval: POLL, placeholderData: (prev) => prev },
  })
  const orders = useMemo<OrderWithId[]>(() => {
    const data = list.data
    if (!data) return []
    return data.map((o, i) => ({ ...o, id: offset + BigInt(i) + 1n })).reverse()
  }, [list.data, offset])
  return { orders, isLoading: enabled && list.data === undefined && list.isLoading }
}

export function useOrder(id: bigint | undefined) {
  const res = useReadContract({
    ...base,
    functionName: 'getOrder',
    args: [id ?? 0n],
    query: { enabled: enabled && id !== undefined, refetchInterval: 4_000 },
  })
  const order = res.data
  return {
    order: order && order.status !== 0 ? ({ ...order, id: id as bigint } as OrderWithId) : undefined,
    isLoading: res.isLoading,
  }
}

export function useAccounts(addresses: Address[]) {
  const unique = useMemo(
    () => Array.from(new Set(addresses.map((m) => m.toLowerCase()))) as Address[],
    [addresses],
  )
  const res = useReadContracts({
    contracts: unique.map((m) => ({ ...base, functionName: 'getAccount' as const, args: [m] as const })),
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

export function useMyAccount() {
  const { address } = useAccount()
  const res = useReadContract({
    ...base,
    functionName: 'getAccount',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: POLL, placeholderData: (prev) => prev },
  })
  return res.data
}

export function useDebts(address: Address | undefined) {
  const res = useReadContract({
    ...base,
    functionName: 'getDebts',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: POLL },
  })
  return res.data ?? []
}

export function useDisputeWaived(address: Address | undefined) {
  const res = useReadContract({
    ...base,
    functionName: 'disputeLimitWaived',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: POLL },
  })
  return res.data === true
}

export function usePaused() {
  const res = useReadContract({ ...base, functionName: 'paused', query: { enabled, refetchInterval: 15_000 } })
  return res.data === true
}

export function usePrivacySwitches() {
  const sealed = useReadContract({ ...base, functionName: 'sealedEnabled', query: { enabled, refetchInterval: 15_000 } })
  const payerProof = useReadContract({ ...base, functionName: 'payerProofRequired', query: { enabled, refetchInterval: 15_000 } })
  const kyc = useReadContract({ ...base, functionName: 'kycRequired', query: { enabled, refetchInterval: 15_000 } })
  return {
    sealedEnabled: sealed.data === true,
    payerProofRequired: payerProof.data === true,
    kycRequired: kyc.data === true,
    isLoading: sealed.isLoading || payerProof.isLoading || kyc.isLoading,
  }
}

export function useListingFee() {
  const res = useReadContract({ ...base, functionName: 'listingFee', query: { enabled, refetchInterval: 20_000 } })
  return res.data ?? DEFAULT_LISTING_FEE
}

export function useFeeConfig() {
  const fee = useReadContract({ ...base, functionName: 'listingFee', query: { enabled, refetchInterval: 15_000 } })
  const recipient = useReadContract({ ...base, functionName: 'feeRecipient', query: { enabled, refetchInterval: 15_000 } })
  const accrued = useReadContract({ ...base, functionName: 'feesAccrued', query: { enabled, refetchInterval: POLL } })
  return {
    listingFee: fee.data ?? DEFAULT_LISTING_FEE,
    feeRecipient: recipient.data,
    feesAccrued: accrued.data ?? 0n,
    isLoading: fee.isLoading || recipient.isLoading || accrued.isLoading,
  }
}

export function useVerifier() {
  const res = useReadContract({ ...base, functionName: 'verifier', query: { enabled, refetchInterval: 20_000 } })
  return res.data
}

export type KycInfo = { verified: boolean; level: number; expiry: bigint; isLoading?: boolean }

export function useVerification(address: Address | undefined): KycInfo {
  const ver = useReadContract({
    ...base,
    functionName: 'verification',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: 15_000, placeholderData: (prev) => prev },
  })
  const ok = useReadContract({
    ...base,
    functionName: 'isVerified',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: 15_000, placeholderData: (prev) => prev },
  })
  const level = ver.data ? Number(ver.data[0]) : 0
  const expiry = ver.data ? ver.data[1] : 0n
  return { verified: ok.data === true, level, expiry, isLoading: ok.isLoading || ver.isLoading }
}

export function useVerifications(addresses: Address[]) {
  const unique = useMemo(
    () => Array.from(new Set(addresses.map((m) => m.toLowerCase()))) as Address[],
    [addresses],
  )
  const now = useNow()
  const res = useReadContracts({
    contracts: unique.map((m) => ({ ...base, functionName: 'verification' as const, args: [m] as const })),
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

export function useOrderMessages(orderId: bigint) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  return useQuery({
    queryKey: ['order-messages', orderId.toString()],
    enabled: enabled && !!client,
    refetchInterval: 5_000,
    queryFn: async (): Promise<ChatMessage[]> => {
      if (!client || !ESCROW_ADDRESS) return []
      const head = await client.getBlockNumber()
      const fetchFrom = async (fromBlock: bigint) =>
        client.getLogs({ address: ESCROW_ADDRESS, event: messageEvent, args: { orderId }, fromBlock, toBlock: head })
      let logs
      try {
        logs = await fetchFrom(DEPLOY_BLOCK)
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

export function useUsdcBalance() {
  const { address } = useAccount()
  const res = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Address],
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!USDC_ADDRESS, refetchInterval: POLL },
  })
  return res.data
}

export function useUsdcAllowance() {
  const { address } = useAccount()
  const res = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [address as Address, ESCROW_ADDRESS as Address],
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!USDC_ADDRESS && enabled, refetchInterval: POLL },
  })
  return res.data
}

export function useArbiter() {
  const res = useReadContract({ ...base, functionName: 'arbiter', query: { enabled, refetchInterval: 30_000 } })
  return res.data
}

export function useBackupArbiter() {
  const res = useReadContract({ ...base, functionName: 'backupArbiter', query: { enabled, refetchInterval: 30_000 } })
  return res.data
}

export function useClaimable() {
  const { address } = useAccount()
  const res = useReadContract({
    ...base,
    functionName: 'claimable',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: POLL },
  })
  return res.data ?? 0n
}

export function useOpenOrderCount() {
  const { address } = useAccount()
  const res = useReadContract({
    ...base,
    functionName: 'openOrderCount',
    args: [address as Address],
    query: { enabled: enabled && !!address, refetchInterval: POLL },
  })
  return Number(res.data ?? 0n)
}
