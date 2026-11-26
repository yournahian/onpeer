import { stringToHex, hexToString, type Address, type Hex } from 'viem'
import { arcTestnet } from 'viem/chains'
import { formatUnitsExact, formatUnitsFixed } from '@/onchain-money'

export const CHAIN_ID = arcTestnet.id

const DEFAULT_ESCROW_ADDRESS = '0x1929e33D2866d06E547eb02A1DDFcAc6bA2304fE' as Address
const DEFAULT_DEPLOY_BLOCK = 74214615n
const DEFAULT_EURC_ESCROW_ADDRESS = '0xDf8dC07030A0e578d475CA9582F2E87b29EeBa3d' as Address
const DEFAULT_EURC_DEPLOY_BLOCK = 74214619n
const DEFAULT_CIRBTC_ESCROW_ADDRESS = '0x6ba3b81833b6354f08483740211af3ddda396b39' as Address
const DEFAULT_CIRBTC_DEPLOY_BLOCK = 73734225n
const DEFAULT_WETH_ESCROW_ADDRESS = '0xbd79693411ee47e2acbba14e9353e7e0c43bf6f3' as Address
const DEFAULT_WETH_DEPLOY_BLOCK = 73734238n

const DEFAULT_USDC_TOKEN_ADDRESS = '0x3600000000000000000000000000000000000000' as Address
const DEFAULT_EURC_TOKEN_ADDRESS = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as Address
const DEFAULT_CIRBTC_TOKEN_ADDRESS = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' as Address
const DEFAULT_WETH_TOKEN_ADDRESS = '0x2c4047028a72803939b6fb674D01bC059B5C4961' as Address

const DEPRECATED_ESCROWS = new Set([
  '0xf719ebbc5080aee09e38909764b897e0bf01a9b0', // v2.1 USDC (superseded by v2.2)
  '0x0db2fbf8357617172a3b852bc2ac3054dba1d402', // v2.1 EURC (superseded by v2.2)
  '0x271b519275380f60fa100d0cff101800893a8fa0', // v1 (deprecated)
  '0x22f28c481f2842c5a68028944a4f3fa7ebdf58de', // v2.0 (deprecated)
  '0xb257939153215ae7eb5a02057877b1ae5f5b04e5', // earlier draft (deprecated)
])

const validAddr = (raw: string | undefined, fallback: Address): Address =>
  raw && /^0x[0-9a-fA-F]{40}$/.test(raw.trim()) ? (raw.trim() as Address) : fallback

const validBlock = (raw: string | undefined, fallback: bigint): bigint => {
  const s = raw?.trim()
  const parsed = s && /^\d+$/.test(s) ? BigInt(s) : 0n
  return parsed >= fallback ? parsed : fallback
}

const rawAddress = (import.meta.env.VITE_P2P_ESCROW_ADDRESS as string | undefined)?.trim()
export const ESCROW_ADDRESS: Address | undefined =
  rawAddress && /^0x[0-9a-fA-F]{40}$/.test(rawAddress) && !DEPRECATED_ESCROWS.has(rawAddress.toLowerCase())
    ? (rawAddress as Address)
    : DEFAULT_ESCROW_ADDRESS

export const DEPLOY_BLOCK = validBlock(import.meta.env.VITE_P2P_DEPLOY_BLOCK as string | undefined, DEFAULT_DEPLOY_BLOCK)

export const EURC_ESCROW_ADDRESS: Address = validAddr(
  import.meta.env.VITE_P2P_EURC_ESCROW_ADDRESS as string | undefined,
  DEFAULT_EURC_ESCROW_ADDRESS,
)
export const EURC_DEPLOY_BLOCK = validBlock(
  import.meta.env.VITE_P2P_EURC_DEPLOY_BLOCK as string | undefined,
  DEFAULT_EURC_DEPLOY_BLOCK,
)
export const EURC_TOKEN_ADDRESS: Address = validAddr(
  import.meta.env.VITE_ARC_TESTNET_EURC_ADDRESS as string | undefined,
  DEFAULT_EURC_TOKEN_ADDRESS,
)

export const CIRBTC_ESCROW_ADDRESS: Address = validAddr(
  import.meta.env.VITE_P2P_CIRBTC_ESCROW_ADDRESS as string | undefined,
  DEFAULT_CIRBTC_ESCROW_ADDRESS,
)
export const CIRBTC_DEPLOY_BLOCK = validBlock(
  import.meta.env.VITE_P2P_CIRBTC_DEPLOY_BLOCK as string | undefined,
  DEFAULT_CIRBTC_DEPLOY_BLOCK,
)
export const CIRBTC_TOKEN_ADDRESS: Address = DEFAULT_CIRBTC_TOKEN_ADDRESS

export const WETH_ESCROW_ADDRESS: Address = validAddr(
  import.meta.env.VITE_P2P_WETH_ESCROW_ADDRESS as string | undefined,
  DEFAULT_WETH_ESCROW_ADDRESS,
)
export const WETH_DEPLOY_BLOCK = validBlock(
  import.meta.env.VITE_P2P_WETH_DEPLOY_BLOCK as string | undefined,
  DEFAULT_WETH_DEPLOY_BLOCK,
)
export const WETH_TOKEN_ADDRESS: Address = DEFAULT_WETH_TOKEN_ADDRESS

export const P2P_ASSETS = ['USDC', 'EURC', 'cirBTC', 'WETH'] as const
export type P2pAsset = (typeof P2P_ASSETS)[number]
/** Assets currently visible across P2P, Admin, and Docs UI selectors. */
export const VISIBLE_P2P_ASSETS = ['USDC', 'EURC'] as const satisfies readonly P2pAsset[]

export const EURC_ID_OFFSET = 1_000_000_000_000n
export const CIRBTC_ID_OFFSET = 2_000_000_000_000n
export const WETH_ID_OFFSET = 3_000_000_000_000n

export function getEscrowConfig(asset: P2pAsset = 'USDC'): {
  asset: P2pAsset
  escrowAddress: Address
  deployBlock: bigint
  tokenAddress: Address
  decimals: number
  dollarUnit: bigint
} {
  if (asset === 'EURC') {
    return {
      asset: 'EURC',
      escrowAddress: EURC_ESCROW_ADDRESS,
      deployBlock: EURC_DEPLOY_BLOCK,
      tokenAddress: EURC_TOKEN_ADDRESS,
      decimals: 6,
      dollarUnit: 1_000_000n,
    }
  }
  if (asset === 'cirBTC') {
    return {
      asset: 'cirBTC',
      escrowAddress: CIRBTC_ESCROW_ADDRESS,
      deployBlock: CIRBTC_DEPLOY_BLOCK,
      tokenAddress: CIRBTC_TOKEN_ADDRESS,
      decimals: 8,
      dollarUnit: 1_000n,
    }
  }
  if (asset === 'WETH') {
    return {
      asset: 'WETH',
      escrowAddress: WETH_ESCROW_ADDRESS,
      deployBlock: WETH_DEPLOY_BLOCK,
      tokenAddress: WETH_TOKEN_ADDRESS,
      decimals: 18,
      dollarUnit: 400_000_000_000_000n,
    }
  }
  return {
    asset: 'USDC',
    escrowAddress: ESCROW_ADDRESS ?? DEFAULT_ESCROW_ADDRESS,
    deployBlock: DEPLOY_BLOCK,
    tokenAddress: DEFAULT_USDC_TOKEN_ADDRESS,
    decimals: 6,
    dollarUnit: 1_000_000n,
  }
}

export function encodeScopedId(asset: P2pAsset, rawId: bigint): bigint {
  if (asset === 'WETH') return WETH_ID_OFFSET + rawId
  if (asset === 'cirBTC') return CIRBTC_ID_OFFSET + rawId
  if (asset === 'EURC') return EURC_ID_OFFSET + rawId
  return rawId
}

export function decodeScopedId(scopedId: bigint): { asset: P2pAsset; rawId: bigint } {
  if (scopedId >= WETH_ID_OFFSET) return { asset: 'WETH', rawId: scopedId - WETH_ID_OFFSET }
  if (scopedId >= CIRBTC_ID_OFFSET) return { asset: 'cirBTC', rawId: scopedId - CIRBTC_ID_OFFSET }
  if (scopedId >= EURC_ID_OFFSET) return { asset: 'EURC', rawId: scopedId - EURC_ID_OFFSET }
  return { asset: 'USDC', rawId: scopedId }
}

export function formatRawId(scopedId: bigint): string {
  return decodeScopedId(scopedId).rawId.toString()
}

/** Human-readable order/ad label: `#108` for USDC, `#5 (EURC)` for secondary markets. */
export function formatScopedOrderLabel(scopedId: bigint): string {
  const { asset, rawId } = decodeScopedId(scopedId)
  return asset === 'USDC' ? `#${rawId.toString()}` : `#${rawId.toString()} (${asset})`
}

/** Truncate a string to at most `maxBytes` UTF-8 bytes without splitting multi-byte codepoints. */
export function truncateUtf8(str: string, maxBytes: number): string {
  if (maxBytes <= 0 || !str) return ''
  const enc = new TextEncoder()
  if (enc.encode(str).byteLength <= maxBytes) return str
  let used = 0
  let out = ''
  for (const ch of Array.from(str)) {
    const len = enc.encode(ch).byteLength
    if (used + len > maxBytes) break
    out += ch
    used += len
  }
  return out
}

export function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export const NATIVE_USDC_GAS_BUFFER = 100_000n // 0.10 USDC reserved for Arc native gas on Max clicks
export const MIN_GAS_WARNING_USDC = 20_000n // Warn below 0.02 USDC native gas balance
export const MAX_FIAT_PRICE_E6 = 1_000_000_000_000_000n // Matches contract MAX_FIAT_PRICE_E6 (1e15)

export const MAX_OPEN_ORDERS = 5
export const GRACE_SECONDS = 5 * 60
export const COOLING_OFF_SECONDS = 30 * 60
export const BACKUP_ARBITER_DELAY_SECONDS = 7 * 24 * 3600
export const DEFAULT_LISTING_FEE = 50_000n
export const MAX_LISTING_FEE = 500_000n
export const DETAILS_MODE = { PLAIN: 0, HANDSHAKE: 1, AUTO: 2 } as const
export const BUY_AD_MIN_COMPLETED = 3
export const BOND_MIN = 2_000_000n
export const BOND_MAX = 5_000_000n
export const BOND_BPS = 500n
export const TIER0_CAP = 200_000_000n
export const TIER1_CAP = 500_000_000n
export const TIER2_CAP = 2_000_000_000n
export const NEW_TAKER_MAX = TIER0_CAP
export const MERCHANT_MARGIN = 100_000_000n
export const MESSAGE_MAX_BYTES = 280
export const MARGIN_DELAY_DAYS = 7
export const MIN_TAKER_OPTIONS = [0, 1, 5, 10, 25]
export const TTL_OPTIONS = [12, 24, 72, 168] as const
export const DEFAULT_TTL_HOURS = 72
export const DETAILS_MAX_BYTES = 200
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

export const TIER_TABLE = [
  { tier: 0, label: 'Starter', requirement: '0 completed trades', cap: TIER0_CAP },
  { tier: 1, label: 'Active', requirement: '1–4 trades, Merchant, or KYC L2', cap: TIER1_CAP },
  { tier: 2, label: 'Established', requirement: '5–19 trades & 7d+ age (or 1+ & KYC L2)', cap: TIER2_CAP },
  { tier: 3, label: 'Trusted', requirement: '20+ trades & 14d+ age (or Established + KYC L2)', cap: null },
] as const

export function tier0CapFor(asset: P2pAsset = 'USDC'): bigint {
  return getEscrowConfig(asset).dollarUnit * 200n
}

export function merchantMarginFor(asset: P2pAsset = 'USDC'): bigint {
  return getEscrowConfig(asset).dollarUnit * 100n
}

export function defaultListingFeeFor(asset: P2pAsset = 'USDC'): bigint {
  return getEscrowConfig(asset).dollarUnit / 20n
}

export function maxListingFeeFor(asset: P2pAsset = 'USDC'): bigint {
  return getEscrowConfig(asset).dollarUnit / 2n
}

export function computeBond(amountRaw: bigint, asset: P2pAsset = 'USDC'): bigint {
  const du = getEscrowConfig(asset).dollarUnit
  const bMin = du * 2n
  const bMax = du * 5n
  const pct = (amountRaw * BOND_BPS) / 10_000n
  const lo = pct > bMin ? pct : bMin
  return lo > bMax ? bMax : lo
}

export const isUncapped = (cap: bigint) => cap > 10n ** 36n
export const isAdExpired = (expiresAt: bigint, nowSec: number) => Number(expiresAt) <= nowSec

export type Country = {
  code: string
  name: string
  currency: string
  symbol: string
}

export const COUNTRIES: Country[] = [
  { code: 'IN', name: 'India', currency: 'INR', symbol: '₹' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', symbol: 'Rs' },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', symbol: '৳' },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR', symbol: 'Rs' },
  { code: 'NP', name: 'Nepal', currency: 'NPR', symbol: 'Rs' },
  { code: 'BT', name: 'Bhutan', currency: 'BTN', symbol: 'Nu.' },
  { code: 'MV', name: 'Maldives', currency: 'MVR', symbol: 'Rf' },
  { code: 'AF', name: 'Afghanistan', currency: 'AFN', symbol: '؋' },
]

export const countryByCurrency = (currency: string) =>
  COUNTRIES.find((c) => c.currency === currency)

export type PaymentMethod = { bit: number; name: string; countries: string[] | 'all' }

/** The bit index of each method is stored onchain in the ad's uint32 paymentMask (0..31). Never reorder existing bits. */
export const PAYMENT_METHODS: PaymentMethod[] = [
  { bit: 0, name: 'UPI', countries: ['IN'] },
  { bit: 1, name: 'IMPS', countries: ['IN'] },
  { bit: 2, name: 'Paytm', countries: ['IN'] },
  { bit: 3, name: 'Bank transfer', countries: 'all' },
  { bit: 4, name: 'Raast', countries: ['PK'] },
  { bit: 5, name: 'JazzCash', countries: ['PK'] },
  { bit: 6, name: 'Easypaisa', countries: ['PK'] },
  { bit: 7, name: 'bKash', countries: ['BD'] },
  { bit: 8, name: 'Nagad', countries: ['BD'] },
  { bit: 9, name: 'Rocket', countries: ['BD'] },
  { bit: 10, name: 'LankaQR', countries: ['LK'] },
  { bit: 11, name: 'eZ Cash', countries: ['LK'] },
  { bit: 12, name: 'eSewa', countries: ['NP'] },
  { bit: 13, name: 'Khalti', countries: ['NP'] },
  { bit: 14, name: 'ConnectIPS', countries: ['NP'] },
  { bit: 15, name: 'mBoB', countries: ['BT'] },
  { bit: 16, name: 'BML MobilePay', countries: ['MV'] },
  { bit: 17, name: 'M-Paisa', countries: ['AF'] },
  { bit: 18, name: 'PhonePe', countries: ['IN'] },
  { bit: 19, name: 'BHIM', countries: ['IN'] },
  { bit: 20, name: 'SadaPay', countries: ['PK'] },
  { bit: 21, name: 'NayaPay', countries: ['PK'] },
  { bit: 22, name: 'upay', countries: ['BD'] },
  { bit: 23, name: 'FriMi', countries: ['LK'] },
  { bit: 24, name: 'Genie', countries: ['LK'] },
  { bit: 25, name: 'IME Pay', countries: ['NP'] },
  { bit: 26, name: 'Digital Kidu', countries: ['BT'] },
  { bit: 27, name: 'eTeeru', countries: ['BT'] },
  { bit: 28, name: 'DhiraaguPay', countries: ['MV'] },
  { bit: 29, name: 'Favara', countries: ['MV'] },
  { bit: 30, name: 'HesabPay', countries: ['AF'] },
  { bit: 31, name: 'M-Hawala', countries: ['AF'] },
]

/** Featured 4 flagship local payment apps per South Asian country (all 32 bundled 512px marks). */
export const COUNTRY_PROVIDERS: Record<string, readonly string[]> = {
  IN: ['UPI', 'PhonePe', 'Paytm', 'BHIM'],
  PK: ['Easypaisa', 'JazzCash', 'SadaPay', 'NayaPay'],
  BD: ['bKash', 'Nagad', 'Rocket', 'upay'],
  LK: ['eZ Cash', 'FriMi', 'Genie', 'mCash'],
  NP: ['eSewa', 'Khalti', 'IME Pay', 'Namaste Pay'],
  BT: ['goBOB', 'Digital Kidu', 'eTeeru', 'MyPay'],
  MV: ['BML MobilePay', 'DhiraaguPay', 'Favara', 'm-Faisaa'],
  AF: ['M-Paisa', 'HesabPay', 'M-Hawala', 'My-Money'],
}

export const hasMethodBit = (mask: number, bit: number) => ((mask >>> bit) & 1) !== 0

export const methodsForCountry = (code: string) =>
  PAYMENT_METHODS.filter((m) => m.countries === 'all' || m.countries.includes(code))

export const maskToMethods = (mask: number) =>
  PAYMENT_METHODS.filter((m) => hasMethodBit(mask, m.bit))

export const bitsToMask = (bits: number[]) =>
  bits.reduce((acc, b) => (acc | ((1 << b) >>> 0)) >>> 0, 0)

export const SIDE_SELL = 0
export const SIDE_BUY = 1

export const STATUS = {
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

export type StatusTone = 'info' | 'warn' | 'success' | 'danger' | 'neutral'

export const STATUS_META: Record<number, { label: string; tone: StatusTone }> = {
  0: { label: 'Unknown', tone: 'neutral' },
  1: { label: 'Awaiting payment', tone: 'warn' },
  2: { label: 'Paid, awaiting release', tone: 'info' },
  3: { label: 'Completed', tone: 'success' },
  4: { label: 'Cancelled', tone: 'neutral' },
  5: { label: 'In appeal', tone: 'danger' },
  6: { label: 'Resolved: released to buyer', tone: 'success' },
  7: { label: 'Resolved: returned to seller', tone: 'neutral' },
  8: { label: 'Settled by parties', tone: 'neutral' },
}

export const isActiveStatus = (s: number) => s === 1 || s === 2 || s === 5

export const currencyToHex = (code: string): Hex => stringToHex(code, { size: 3 })
export const hexToCurrency = (hex: string): string => {
  try {
    return hexToString(hex as Hex).replace(/\0/g, '')
  } catch {
    return '???'
  }
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`

export const sameAddr = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** Group digits with South Asian (lakh/crore) separators. */
const group = (intPart: string) => BigInt(intPart).toLocaleString('en-IN')

/** Format a 1e6-scaled fiat value. */
export function formatFiat(e6: bigint, digits = 2): string {
  const fixed = formatUnitsFixed(e6, 6, digits)
  const [i, f] = fixed.split('.')
  return f ? `${group(i)}.${f}` : group(i)
}

/** Format a raw token amount (USDC/EURC 6d, cirBTC 8d, WETH 18d) with US grouping. */
export function formatUsdcAmount(raw: bigint, digits?: number, asset: P2pAsset = 'USDC'): string {
  const dec = getEscrowConfig(asset).decimals
  if (dec === 6) {
    const d = digits ?? 2
    const fixed = formatUnitsFixed(raw, 6, d)
    const [i, f] = fixed.split('.')
    const g = BigInt(i).toLocaleString('en-US')
    return f ? `${g}.${f}` : g
  }
  const exact = formatUnitsExact(raw, dec)
  const [i, rawFrac = ''] = exact.split('.')
  const g = BigInt(i).toLocaleString('en-US')
  const maxShow = digits !== undefined ? Math.max(digits, 4) : dec === 8 ? 6 : 6
  const minShow = digits === 0 ? 0 : 4
  const clipped = rawFrac.slice(0, maxShow).replace(/0+$/, '')
  const padded = clipped.length < minShow && rawFrac.length === 0 ? ''.padEnd(minShow > 2 ? 2 : minShow, '0') : clipped
  if (raw === 0n) return '0.00'
  if (!padded && rawFrac.length > 0) {
    // Very small amount such as 0.00000050 cirBTC listing fee — show exact non-zero tail!
    return `${g}.${rawFrac}`
  }
  return padded ? `${g}.${padded}` : g
}

export function formatOrderCap(cap: bigint, asset: P2pAsset = 'USDC'): string {
  return isUncapped(cap) ? 'Uncapped' : `${formatUsdcAmount(cap, 0, asset)} ${asset}`
}

/** Price (fiat per token) shown with up to 4 decimals, trimmed. */
export function formatPrice(e6: bigint): string {
  const fixed = formatUnitsFixed(e6, 6, 4)
  const [i, f] = fixed.split('.')
  const trimmed = (f ?? '').replace(/0+$/, '')
  const padded = trimmed.length < 2 ? trimmed.padEnd(2, '0') : trimmed
  return `${group(i)}.${padded}`
}

export const fiatFor = (tokenRaw: bigint, priceE6: bigint, asset: P2pAsset = 'USDC') =>
  (tokenRaw * priceE6) / 10n ** BigInt(getEscrowConfig(asset).decimals)

export const usdcFor = (fiatE6: bigint, priceE6: bigint, asset: P2pAsset = 'USDC') =>
  priceE6 === 0n ? 0n : (fiatE6 * 10n ** BigInt(getEscrowConfig(asset).decimals)) / priceE6

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const ERROR_COPY: Record<string, string> = {
  AdNotFound: 'This ad no longer exists.',
  AdUnavailable: 'This ad is paused, closed, or out of inventory.',
  AdExpired: 'This ad has expired. Pick another ad or ask the advertiser to refresh it.',
  ArbiterIsParty: 'The arbiter cannot resolve an order they are part of.',
  DeadlinePassed: 'The payment deadline has ended.',
  InvalidAmount: 'That amount is outside the ad limits.',
  InvalidFee: 'Listing fee exceeds the maximum allowed cap.',
  InvalidDetailsMode: 'Invalid payment details mode.',
  InvalidTtl: 'Ad expiry must be between 1 and 168 hours.',
  Restricted: 'This account is restricted from opening new trades.',
  DebtOutstanding: 'Repay your unpaid dispute bond on the Restrictions Removal tab before opening new ads or orders.',
  CooldownActive: 'A cooldown is active after repeated cancellations. Try again later.',
  RequirementNotMet: 'The advertiser requires more completed trades than you have.',
  AboveCap: 'That amount is above your current per-order account tier limit.',
  BuyAdNotAllowed: 'Posting a buy ad requires a Merchant badge or at least 3 completed trades.',
  SealedDisabled: 'Sealed payment details are currently disabled.',
  PayerProofRequired: 'Enter your transfer ID and payer details to mark this order as paid.',
  LateMarkLimit: 'Late payment marking is disabled for 30 days after more than 2 late marks.',
  NotVerified: 'Active KYC verification is required to post ads or open orders.',
  InvalidVerification: 'Verification requires level >= 1 and a future expiry timestamp.',
  DetailsNotReady: 'Waiting for the seller to share payment details.',
  DetailsAlreadyReady: 'Payment details have already been shared for this order.',
  InvalidEncryptionKey: 'Encryption key must be between 33 and 65 bytes.',
  MerchantMarginTooLow: 'This merchant ad is paused until the advertiser restores their margin.',
  WithdrawalPending: 'You already have a margin withdrawal in progress.',
  OpenOrdersRemain: 'Finish your open orders before withdrawing margin.',
  InvalidMessage: 'Messages must be 1 to 280 bytes.',
  EnforcedPause: 'New ads and orders are paused by the marketplace operator.',
  InvalidDetails: 'Payment details are missing or too long (200 bytes max).',
  InvalidPaymentMask: 'Pick at least one payment method.',
  InvalidPrice: 'That price is not valid.',
  InvalidStatus: 'This order is no longer in a state that allows that action.',
  InvalidWindow: 'Payment window must be between 10 and 1440 minutes.',
  NothingToWithdraw: 'You have nothing to withdraw.',
  OpenOrderLimit: `You can have at most ${MAX_OPEN_ORDERS} open orders as a taker at once.`,
  OrderNotFound: 'This order does not exist.',
  PriceMoved: 'The advertiser changed the price. Refresh and try again.',
  SelfTrade: 'You cannot trade against your own ad.',
  TooEarly: 'Too early for that action. Wait for the timer.',
  Unauthorized: 'Your wallet is not allowed to do that on this order.',
  UnsupportedCurrency: 'That currency is not supported.',
  SafeERC20FailedOperation: 'Token transfer failed. Check your balance and approval.',
}

export function parseTxError(error: unknown): string | null {
  const e = error as { name?: string; shortMessage?: string; message?: string; code?: number } | null
  const msg = `${e?.shortMessage ?? ''} ${e?.message ?? ''}`
  const lower = msg.toLowerCase()
  if (e?.code === 4001 || lower.includes('user rejected') || lower.includes('user denied')) return null
  for (const [name, copy] of Object.entries(ERROR_COPY)) {
    if (msg.includes(name)) return copy
  }
  if (lower.includes('insufficient funds')) return 'Not enough USDC for gas. Use "Get test USDC" in the sidebar.'
  if (lower.includes('exceeds balance') || lower.includes('transfer amount exceeds'))
    return 'Insufficient token balance.'
  if (lower.includes('network') || lower.includes('timeout')) return 'Network issue. Please try again.'
  if (lower.includes('reverted')) return 'The transaction was rejected by the contract.'
  return 'Something went wrong. Please try again.'
}
