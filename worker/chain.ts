import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { p2pEscrowAbi } from '../src/abi/p2pEscrow'
import { requireChain } from '../src/onchain-facts'
import { CHAIN_ID, type Env } from './env'

export const BACKUP_ARBITER_DELAY_SECONDS = 7 * 24 * 60 * 60 // 7 days (matches contract BACKUP_ARBITER_DELAY)
export const ARBITER_PAID_DELAY_SECONDS = 15 * 60 // 15 minutes after paidAt
export const ORDER_RETENTION_SECONDS = 90 * 24 * 60 * 60 // 90 days post-completion for chat & vault

export const ORDER_STATUS = {
  NONE: 0,
  PENDING: 1,
  PAID: 2,
  COMPLETED: 3,
  CANCELLED: 4,
  DISPUTED: 5,
  RESOLVED_BUYER: 6,
  RESOLVED_SELLER: 7,
  SETTLED: 8,
} as const

export interface ChainRoles {
  owner: `0x${string}`
  arbiter: `0x${string}`
  backupArbiter: `0x${string}`
  verifier: `0x${string}`
  kycRequired: boolean
  sealedEnabled: boolean
  payerProofRequired: boolean
}

export interface ChainOrder {
  id: bigint
  adId: bigint
  buyer: `0x${string}`
  seller: `0x${string}`
  taker: `0x${string}`
  status: number
  createdAt: bigint
  deadline: bigint
  paidAt: bigint
  disputedAt: bigint
  reviewStartedAt: bigint
  amount: bigint
  detailsReady: boolean
  detailsHash: `0x${string}`
  payerProof: `0x${string}`
  paidLate: boolean
}

export interface ChainAd {
  id: bigint
  maker: `0x${string}`
  side: number
  paused: boolean
  closed: boolean
  expiresAt: bigint
  detailsMode: number
  detailsHash: `0x${string}`
}

export interface ChainReader {
  getRoles(): Promise<ChainRoles>
  getOrder(orderId: bigint): Promise<ChainOrder | null>
  getAd(adId: bigint): Promise<ChainAd | null>
  isVerified(wallet: `0x${string}`): Promise<boolean>
  getOpenOrderCount(wallet: `0x${string}`): Promise<bigint>
  getUserAdIds(wallet: `0x${string}`): Promise<readonly bigint[]>
}

export type OrderPartyRole = 'buyer' | 'seller' | 'arbiter' | 'backup_arbiter'

export type OrderAccessResult =
  | {
      allowed: true
      role: OrderPartyRole
      order: ChainOrder
      roles: ChainRoles
    }
  | {
      allowed: false
      status: 403 | 404
      error: 'order_not_found' | 'forbidden'
    }

export type AdminAccessResult =
  | {
      allowed: true
      role: 'owner' | 'arbiter' | 'backup_arbiter'
      roles: ChainRoles
    }
  | {
      allowed: false
      status: 403
      error: 'forbidden'
    }

const lowerAddr = (a: string): `0x${string}` => a.toLowerCase() as `0x${string}`
const lowerHex = (h: string): `0x${string}` => h.toLowerCase() as `0x${string}`

function isContractRevert(err: unknown): boolean {
  if (err instanceof ContractFunctionRevertedError) return true
  if (err instanceof BaseError) {
    return err.walk((e) => e instanceof ContractFunctionRevertedError) !== null
  }
  return false
}

export function requireEscrowAddress(env: Env): Address {
  const raw = env.VITE_P2P_ESCROW_ADDRESS?.trim()
  if (!raw || !isAddress(raw)) {
    throw new Error('escrow_not_configured')
  }
  return raw
}

export function createArcPublicClient() {
  const rpcUrl = requireChain(CHAIN_ID).rpcUrls[0]
  return createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl, { timeout: 10_000 }),
  })
}

/**
 * Create a live Arc Testnet ChainReader for one HTTP request / scheduled run.
 * Roles are memoized only within this single reader instance (one request), never across requests.
 */
export function createChainReader(env: Env): ChainReader {
  const escrow = requireEscrowAddress(env)
  const client = createArcPublicClient()
  let rolesPromise: Promise<ChainRoles> | null = null

  return {
    getRoles(): Promise<ChainRoles> {
      if (!rolesPromise) {
        rolesPromise = Promise.all([
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'owner' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'arbiter' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'backupArbiter' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'verifier' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'kycRequired' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'sealedEnabled' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'payerProofRequired' }),
        ]).then(([owner, arbiter, backupArbiter, verifier, kycRequired, sealedEnabled, payerProofRequired]) => ({
          owner: lowerAddr(owner),
          arbiter: lowerAddr(arbiter),
          backupArbiter: lowerAddr(backupArbiter),
          verifier: lowerAddr(verifier),
          kycRequired,
          sealedEnabled,
          payerProofRequired,
        }))
      }
      return rolesPromise
    },

    async getOrder(orderId: bigint): Promise<ChainOrder | null> {
      if (orderId <= 0n) return null
      try {
        const o = await client.readContract({
          address: escrow,
          abi: p2pEscrowAbi,
          functionName: 'getOrder',
          args: [orderId],
        })
        if (Number(o.status) === ORDER_STATUS.NONE) return null
        return {
          id: orderId,
          adId: o.adId,
          buyer: lowerAddr(o.buyer),
          seller: lowerAddr(o.seller),
          taker: lowerAddr(o.taker),
          status: Number(o.status),
          createdAt: o.createdAt,
          deadline: o.deadline,
          paidAt: o.paidAt,
          disputedAt: o.disputedAt,
          reviewStartedAt: o.reviewStartedAt,
          amount: o.amount,
          detailsReady: o.detailsReady,
          detailsHash: lowerHex(o.detailsHash),
          payerProof: lowerHex(o.payerProof),
          paidLate: o.paidLate,
        }
      } catch (err) {
        if (isContractRevert(err)) return null
        throw err
      }
    },

    async getAd(adId: bigint): Promise<ChainAd | null> {
      if (adId <= 0n) return null
      try {
        const ad = await client.readContract({
          address: escrow,
          abi: p2pEscrowAbi,
          functionName: 'getAd',
          args: [adId],
        })
        if (ad.maker === '0x0000000000000000000000000000000000000000') return null
        return {
          id: adId,
          maker: lowerAddr(ad.maker),
          side: Number(ad.side),
          paused: ad.paused,
          closed: ad.closed,
          expiresAt: ad.expiresAt,
          detailsMode: Number(ad.detailsMode),
          detailsHash: lowerHex(ad.detailsHash),
        }
      } catch (err) {
        if (isContractRevert(err)) return null
        throw err
      }
    },

    async isVerified(wallet: `0x${string}`): Promise<boolean> {
      return client.readContract({
        address: escrow,
        abi: p2pEscrowAbi,
        functionName: 'isVerified',
        args: [wallet],
      })
    },

    async getOpenOrderCount(wallet: `0x${string}`): Promise<bigint> {
      return client.readContract({
        address: escrow,
        abi: p2pEscrowAbi,
        functionName: 'partyOpenOrders',
        args: [wallet],
      })
    },

    async getUserAdIds(wallet: `0x${string}`): Promise<readonly bigint[]> {
      return client.readContract({
        address: escrow,
        abi: p2pEscrowAbi,
        functionName: 'getUserAdIds',
        args: [wallet],
      })
    },
  }
}

/**
 * Matches P2PEscrow._startReview / _requireMessageSender:
 * backupArbiter may step in once `now >= (disputedAt != 0 ? disputedAt : paidAt) + 7 days`.
 */
export function isBackupArbiterEligible(order: ChainOrder, nowSeconds: number): boolean {
  const anchor = order.disputedAt > 0n ? order.disputedAt : order.paidAt
  if (anchor === 0n) return false
  return nowSeconds >= Number(anchor) + BACKUP_ARBITER_DELAY_SECONDS
}

/**
 * Restrict arbiter/backup_arbiter reads of order vault, chat, and evidence to orders that are:
 * - DISPUTED, OR
 * - have an offchain dispute filing, OR
 * - PAID for 15+ minutes.
 * For backup_arbiter, the 7-day rule is already enforced by `checkOrderAccess` / `isBackupArbiterEligible`.
 */
export function isArbiterOrderReadAllowed(
  order: ChainOrder,
  role: OrderPartyRole,
  hasFiling: boolean,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (role === 'buyer' || role === 'seller') return true
  if (role === 'backup_arbiter' && !isBackupArbiterEligible(order, nowSeconds)) return false
  if (order.status === ORDER_STATUS.DISPUTED) return true
  if (hasFiling) return true
  if (
    order.status === ORDER_STATUS.PAID &&
    order.paidAt > 0n &&
    nowSeconds >= Number(order.paidAt) + ARBITER_PAID_DELAY_SECONDS
  ) {
    return true
  }
  return false
}

/**
 * Verify order access from live chain state.
 * Allowed: buyer, seller, primary arbiter, and backupArbiter once the 7-day window applies.
 * Everyone else (including non-arbiter owner or premature backupArbiter) receives 403.
 */
export async function checkOrderAccess(
  chain: ChainReader,
  orderId: bigint,
  wallet: `0x${string}`,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<OrderAccessResult> {
  const [order, roles] = await Promise.all([chain.getOrder(orderId), chain.getRoles()])
  if (!order) {
    return { allowed: false, status: 404, error: 'order_not_found' }
  }
  const caller = wallet.toLowerCase() as `0x${string}`
  if (caller === order.buyer) {
    return { allowed: true, role: 'buyer', order, roles }
  }
  if (caller === order.seller) {
    return { allowed: true, role: 'seller', order, roles }
  }
  if (caller === roles.arbiter) {
    return { allowed: true, role: 'arbiter', order, roles }
  }
  if (caller === roles.backupArbiter && isBackupArbiterEligible(order, nowSeconds)) {
    return { allowed: true, role: 'backup_arbiter', order, roles }
  }
  return { allowed: false, status: 403, error: 'forbidden' }
}

/**
 * Verify admin wallet from live chain state.
 * Standard admin routes allow `owner` or `arbiter`; `allowBackupArbiter` enables filings queue read access.
 */
export async function checkAdminAccess(
  chain: ChainReader,
  wallet: `0x${string}`,
  opts?: { allowBackupArbiter?: boolean },
): Promise<AdminAccessResult> {
  const roles = await chain.getRoles()
  const caller = wallet.toLowerCase() as `0x${string}`
  if (caller === roles.owner) return { allowed: true, role: 'owner', roles }
  if (caller === roles.arbiter) return { allowed: true, role: 'arbiter', roles }
  if (opts?.allowBackupArbiter && caller === roles.backupArbiter) {
    return { allowed: true, role: 'backup_arbiter', roles }
  }
  return { allowed: false, status: 403, error: 'forbidden' }
}

/**
 * Build a wallet client for the isolated testnet `VERIFIER_PRIVATE_KEY` relayer.
 * Enforces the rule that the verifier key must NEVER be owner, arbiter, or backupArbiter.
 */
export async function createVerifierClients(env: Env, roles: ChainRoles) {
  const raw = env.VERIFIER_PRIVATE_KEY?.trim()
  if (!raw) throw new Error('verifier_key_not_configured')
  const pk = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error('verifier_key_malformed')
  }
  const account = privateKeyToAccount(pk)
  const addr = account.address.toLowerCase() as `0x${string}`
  if (addr === roles.owner || addr === roles.arbiter || addr === roles.backupArbiter) {
    throw new Error('verifier_key_must_be_separate_from_governance')
  }
  if (roles.verifier !== addr) {
    throw new Error('verifier_not_appointed_onchain')
  }
  const rpcUrl = requireChain(CHAIN_ID).rpcUrls[0]
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl, { timeout: 15_000 }) })
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(rpcUrl, { timeout: 15_000 }),
  })
  return { account, publicClient, walletClient, escrow: requireEscrowAddress(env) }
}
