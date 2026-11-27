import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { p2pEscrowAbi } from '../src/abi/p2pEscrow'
import { requireChain } from '../src/onchain-facts'
import { activeChainId, isTestnetEnv, type Env } from './env'

const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
  testnet: false,
})

export const BACKUP_ARBITER_DELAY_SECONDS = 7 * 24 * 60 * 60 // 7 days (matches contract BACKUP_ARBITER_DELAY)
export const ARBITER_PAID_DELAY_SECONDS = 15 * 60 // 15 minutes after paidAt
export const ORDER_RETENTION_SECONDS = 90 * 24 * 60 * 60 // 90 days post-completion for chat & vault
export const EURC_ID_OFFSET = 1_000_000_000_000n
export const CIRBTC_ID_OFFSET = 2_000_000_000_000n
export const WETH_ID_OFFSET = 3_000_000_000_000n
const DEFAULT_MAINNET_USDC_ESCROW = '0xC073b1A5ac4004fD82cAc6BDA5548FFc5E5cB97e' as Address
const DEFAULT_TESTNET_USDC_ESCROW = '0x7f661625bC08d72E156A206ee8D24022D7463350' as Address
const DEFAULT_MAINNET_EURC_ESCROW = '0xd0dca77625992d3851748B365Ace63803c5d1759' as Address
const DEFAULT_TESTNET_EURC_ESCROW = '0x26Ef2B69AC928457E348BeEd72Bf116dB81438B9' as Address
const DEFAULT_CIRBTC_ESCROW = '0x6ba3b81833b6354f08483740211af3ddda396b39' as Address
const DEFAULT_WETH_ESCROW = '0xbd79693411ee47e2acbba14e9353e7e0c43bf6f3' as Address

// Known testnet/superseded escrow addresses that must never be queried against Arc Mainnet (5042)
const TESTNET_ONLY_ESCROWS = new Set([
  '0x7f661625bc08d72e156a206ee8d24022d7463350',
  '0x26ef2b69ac928457e348beed72bf116db81438b9',
  '0x1929e33d2866d06e547eb02a1ddfcac6ba2304fe',
  '0xdf8dc07030a0e578d475ca9582f2e87b29eeba3d',
  '0xf719ebbc5080aee09e38909764b897e0bf01a9b0',
  '0x0db2fbf8357617172a3b852bc2ac3054dba1d402',
])

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
  getArbiterRole?(wallet: `0x${string}`): Promise<number>
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
  if (raw && isAddress(raw)) {
    if (!isTestnetEnv(env) && TESTNET_ONLY_ESCROWS.has(raw.toLowerCase())) {
      return DEFAULT_MAINNET_USDC_ESCROW
    }
    return raw
  }
  return isTestnetEnv(env) ? DEFAULT_TESTNET_USDC_ESCROW : DEFAULT_MAINNET_USDC_ESCROW
}

export function resolveEurcEscrowAddress(env: Env): Address {
  const raw = env.VITE_P2P_EURC_ESCROW_ADDRESS?.trim()
  if (raw && isAddress(raw)) {
    if (!isTestnetEnv(env) && TESTNET_ONLY_ESCROWS.has(raw.toLowerCase())) {
      return DEFAULT_MAINNET_EURC_ESCROW
    }
    return raw
  }
  return isTestnetEnv(env) ? DEFAULT_TESTNET_EURC_ESCROW : DEFAULT_MAINNET_EURC_ESCROW
}

export function resolveCirbtcEscrowAddress(env: Env): Address {
  const raw = env.VITE_P2P_CIRBTC_ESCROW_ADDRESS?.trim()
  return raw && isAddress(raw) ? raw : DEFAULT_CIRBTC_ESCROW
}

export function resolveWethEscrowAddress(env: Env): Address {
  const raw = env.VITE_P2P_WETH_ESCROW_ADDRESS?.trim()
  return raw && isAddress(raw) ? raw : DEFAULT_WETH_ESCROW
}

export interface ConfiguredEscrowTarget {
  asset: 'USDC' | 'EURC' | 'cirBTC' | 'WETH'
  address: Address
  offset: bigint
  cursorName: string
  deployBlock: bigint
}

/**
 * Return all explicitly configured escrow deployments for event scanning.
 * `USDC` is always required; secondary markets (`EURC`, `cirBTC`, `WETH`) are included when their
 * `VITE_P2P_*_ESCROW_ADDRESS` runtime var is present (set in `wrangler.jsonc` in production).
 */
export function getConfiguredEscrows(env: Env): ConfiguredEscrowTarget[] {
  const out: ConfiguredEscrowTarget[] = [
    {
      asset: 'USDC',
      address: requireEscrowAddress(env),
      offset: 0n,
      cursorName: 'escrow_events',
      deployBlock: env.VITE_P2P_DEPLOY_BLOCK ? BigInt(env.VITE_P2P_DEPLOY_BLOCK) : 0n,
    },
  ]
  const eurcRaw = env.VITE_P2P_EURC_ESCROW_ADDRESS?.trim()
  if (eurcRaw && isAddress(eurcRaw)) {
    out.push({
      asset: 'EURC',
      address: eurcRaw,
      offset: EURC_ID_OFFSET,
      cursorName: 'escrow_events:EURC',
      deployBlock: env.VITE_P2P_EURC_DEPLOY_BLOCK ? BigInt(env.VITE_P2P_EURC_DEPLOY_BLOCK) : 0n,
    })
  }
  const cirbtcRaw = env.VITE_P2P_CIRBTC_ESCROW_ADDRESS?.trim()
  if (cirbtcRaw && isAddress(cirbtcRaw)) {
    out.push({
      asset: 'cirBTC',
      address: cirbtcRaw,
      offset: CIRBTC_ID_OFFSET,
      cursorName: 'escrow_events:cirBTC',
      deployBlock: env.VITE_P2P_CIRBTC_DEPLOY_BLOCK ? BigInt(env.VITE_P2P_CIRBTC_DEPLOY_BLOCK) : 0n,
    })
  }
  const wethRaw = env.VITE_P2P_WETH_ESCROW_ADDRESS?.trim()
  if (wethRaw && isAddress(wethRaw)) {
    out.push({
      asset: 'WETH',
      address: wethRaw,
      offset: WETH_ID_OFFSET,
      cursorName: 'escrow_events:WETH',
      deployBlock: env.VITE_P2P_WETH_DEPLOY_BLOCK ? BigInt(env.VITE_P2P_WETH_DEPLOY_BLOCK) : 0n,
    })
  }
  return out
}

/** Human-readable order label preserving `#108` for USDC and `#5 (EURC)` for secondary markets. */
export function formatScopedOrderLabel(orderId: bigint): string {
  if (orderId >= WETH_ID_OFFSET) {
    return `#${(orderId - WETH_ID_OFFSET).toString()} (WETH)`
  }
  if (orderId >= CIRBTC_ID_OFFSET) {
    return `#${(orderId - CIRBTC_ID_OFFSET).toString()} (cirBTC)`
  }
  if (orderId >= EURC_ID_OFFSET) {
    return `#${(orderId - EURC_ID_OFFSET).toString()} (EURC)`
  }
  return `#${orderId.toString()}`
}

const ROLES_CACHE_TTL_MS = 60_000
const isolateRolesCache = new Map<string, { roles: ChainRoles; expiresAt: number }>()

export function createArcPublicClient(env?: Env) {
  const chainId = env ? activeChainId(env) : 5042
  const chain = chainId === 5042002 ? arcTestnet : arcMainnet
  const rpcUrl = requireChain(chainId).rpcUrls[0]
  return createPublicClient({
    chain,
    transport: http(rpcUrl, { timeout: 10_000, batch: true, retryCount: 2, retryDelay: 500 }),
  })
}

/**
 * Create a live Arc (Mainnet or Testnet) ChainReader for one HTTP request / scheduled run.
 * Roles are memoized only within this single reader instance (one request), never across requests.
 */
export function createChainReader(env: Env): ChainReader {
  const escrow = requireEscrowAddress(env)
  const eurcEscrow = resolveEurcEscrowAddress(env)
  const cirbtcEscrow = resolveCirbtcEscrowAddress(env)
  const wethEscrow = resolveWethEscrowAddress(env)
  const client = createArcPublicClient(env)
  let rolesPromise: Promise<ChainRoles> | null = null

  const decodeScoped = (scopedId: bigint): { target: Address; offset: bigint; rawId: bigint } => {
    if (scopedId >= WETH_ID_OFFSET) {
      return { target: wethEscrow, offset: WETH_ID_OFFSET, rawId: scopedId - WETH_ID_OFFSET }
    }
    if (scopedId >= CIRBTC_ID_OFFSET) {
      return { target: cirbtcEscrow, offset: CIRBTC_ID_OFFSET, rawId: scopedId - CIRBTC_ID_OFFSET }
    }
    if (scopedId >= EURC_ID_OFFSET) {
      return { target: eurcEscrow, offset: EURC_ID_OFFSET, rawId: scopedId - EURC_ID_OFFSET }
    }
    return { target: escrow, offset: 0n, rawId: scopedId }
  }

  return {
    getRoles(): Promise<ChainRoles> {
      const cacheKey = `${activeChainId(env)}:${escrow.toLowerCase()}`
      const cached = isolateRolesCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return Promise.resolve(cached.roles)
      }
      if (!rolesPromise) {
        rolesPromise = Promise.all([
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'owner' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'arbiter' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'backupArbiter' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'verifier' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'kycRequired' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'sealedEnabled' }),
          client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'payerProofRequired' }),
        ]).then(([owner, arbiter, backupArbiter, verifier, kycRequired, sealedEnabled, payerProofRequired]) => {
          const roles: ChainRoles = {
            owner: lowerAddr(owner),
            arbiter: lowerAddr(arbiter),
            backupArbiter: lowerAddr(backupArbiter),
            verifier: lowerAddr(verifier),
            kycRequired,
            sealedEnabled,
            payerProofRequired,
          }
          isolateRolesCache.set(cacheKey, { roles, expiresAt: Date.now() + ROLES_CACHE_TTL_MS })
          return roles
        })
      }
      return rolesPromise
    },

    async getOrder(orderId: bigint): Promise<ChainOrder | null> {
      if (orderId <= 0n) return null
      const { target, offset, rawId } = decodeScoped(orderId)
      if (rawId <= 0n) return null
      try {
        const o = await client.readContract({
          address: target,
          abi: p2pEscrowAbi,
          functionName: 'getOrder',
          args: [rawId],
        })
        if (Number(o.status) === ORDER_STATUS.NONE) return null
        return {
          id: orderId,
          adId: o.adId + offset,
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
      const { target, rawId } = decodeScoped(adId)
      if (rawId <= 0n) return null
      try {
        const ad = await client.readContract({
          address: target,
          abi: p2pEscrowAbi,
          functionName: 'getAd',
          args: [rawId],
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
      const [usdcOpen, eurcOpen, cirbtcOpen, wethOpen] = await Promise.all([
        client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'partyOpenOrders', args: [wallet] }),
        client
          .readContract({ address: eurcEscrow, abi: p2pEscrowAbi, functionName: 'partyOpenOrders', args: [wallet] })
          .catch(() => 0n),
        client
          .readContract({ address: cirbtcEscrow, abi: p2pEscrowAbi, functionName: 'partyOpenOrders', args: [wallet] })
          .catch(() => 0n),
        client
          .readContract({ address: wethEscrow, abi: p2pEscrowAbi, functionName: 'partyOpenOrders', args: [wallet] })
          .catch(() => 0n),
      ])
      return usdcOpen + eurcOpen + cirbtcOpen + wethOpen
    },

    async getUserAdIds(wallet: `0x${string}`): Promise<readonly bigint[]> {
      const [usdcIds, eurcIds, cirbtcIds, wethIds] = await Promise.all([
        client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'getUserAdIds', args: [wallet] }),
        client
          .readContract({ address: eurcEscrow, abi: p2pEscrowAbi, functionName: 'getUserAdIds', args: [wallet] })
          .catch(() => [] as readonly bigint[]),
        client
          .readContract({ address: cirbtcEscrow, abi: p2pEscrowAbi, functionName: 'getUserAdIds', args: [wallet] })
          .catch(() => [] as readonly bigint[]),
        client
          .readContract({ address: wethEscrow, abi: p2pEscrowAbi, functionName: 'getUserAdIds', args: [wallet] })
          .catch(() => [] as readonly bigint[]),
      ])
      return [
        ...usdcIds,
        ...eurcIds.map((id) => id + EURC_ID_OFFSET),
        ...cirbtcIds.map((id) => id + CIRBTC_ID_OFFSET),
        ...wethIds.map((id) => id + WETH_ID_OFFSET),
      ]
    },

    async getArbiterRole(wallet: `0x${string}`): Promise<number> {
      try {
        const mask = await client.readContract({
          address: escrow,
          abi: p2pEscrowAbi,
          functionName: 'arbiterRole',
          args: [wallet],
        })
        return Number(mask)
      } catch {
        return 0
      }
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
 * Restrict arbiter/backup_arbiter reads of order vault, chat, and evidence to orders that:
 * - were NOT privately completed/cancelled/settled before `takeCase` (`reviewStartedAt === 0n`), AND
 * - have `reviewStartedAt > 0n`, OR are `RESOLVED_*`, OR are `DISPUTED`, OR are `PAID` for 15+ minutes.
 * Notably, a premature offchain filing (`< 15m` after `paidAt`) cannot grant arbiter vault/chat access early.
 * For backup_arbiter, the 7-day rule is also enforced.
 */
export function isArbiterOrderReadAllowed(
  order: ChainOrder,
  role: OrderPartyRole,
  _hasFiling: boolean,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (role === 'buyer' || role === 'seller') return true
  if (role === 'backup_arbiter' && !isBackupArbiterEligible(order, nowSeconds)) return false
  if (
    (order.status === ORDER_STATUS.COMPLETED ||
      order.status === ORDER_STATUS.CANCELLED ||
      order.status === ORDER_STATUS.SETTLED) &&
    order.reviewStartedAt === 0n
  ) {
    return false
  }
  if (
    order.reviewStartedAt > 0n ||
    order.status === ORDER_STATUS.RESOLVED_BUYER ||
    order.status === ORDER_STATUS.RESOLVED_SELLER ||
    order.status === ORDER_STATUS.DISPUTED
  ) {
    return true
  }
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
  const roleMask = chain.getArbiterRole ? await chain.getArbiterRole(caller) : 0
  if (caller === roles.arbiter || (roleMask & 1) !== 0) {
    return { allowed: true, role: 'arbiter', order, roles }
  }
  if ((caller === roles.backupArbiter || (roleMask & 2) !== 0) && isBackupArbiterEligible(order, nowSeconds)) {
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
  const roleMask = chain.getArbiterRole ? await chain.getArbiterRole(caller) : 0
  if (caller === roles.arbiter || (roleMask & 1) !== 0) return { allowed: true, role: 'arbiter', roles }
  if (opts?.allowBackupArbiter && (caller === roles.backupArbiter || (roleMask & 2) !== 0)) {
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
  const chainId = activeChainId(env)
  const chain = chainId === 5042002 ? arcTestnet : arcMainnet
  const rpcUrl = requireChain(chainId).rpcUrls[0]
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 15_000 }) })
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl, { timeout: 15_000 }),
  })
  const escrow = requireEscrowAddress(env)
  const secondaryEscrows = Array.from(
    new Set([resolveEurcEscrowAddress(env), resolveCirbtcEscrowAddress(env), resolveWethEscrowAddress(env)]),
  ).filter((a) => a.toLowerCase() !== escrow.toLowerCase())
  return { account, publicClient, walletClient, escrow, secondaryEscrows }
}
