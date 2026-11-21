import { stringToHex, hexToString, type Address, type Hex } from 'viem'
import { arcTestnet } from 'viem/chains'
import { formatUnitsFixed } from '@/onchain-money'

export const CHAIN_ID = arcTestnet.id

const DEFAULT_ESCROW_ADDRESS = '0xf719ebbc5080aee09e38909764b897e0bf01a9b0' as Address
const DEFAULT_DEPLOY_BLOCK = 72902228n

const rawAddress = (import.meta.env.VITE_P2P_ESCROW_ADDRESS as string | undefined)?.trim()
export const ESCROW_ADDRESS: Address | undefined =
  rawAddress && /^0x[0-9a-fA-F]{40}$/.test(rawAddress) ? (rawAddress as Address) : DEFAULT_ESCROW_ADDRESS

const rawBlock = (import.meta.env.VITE_P2P_DEPLOY_BLOCK as string | undefined)?.trim()
export const DEPLOY_BLOCK = rawBlock && /^\d+$/.test(rawBlock) ? BigInt(rawBlock) : DEFAULT_DEPLOY_BLOCK

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

export function computeBond(amountRaw: bigint): bigint {
  const pct = (amountRaw * BOND_BPS) / 10_000n
  const lo = pct > BOND_MIN ? pct : BOND_MIN
  return lo > BOND_MAX ? BOND_MAX : lo
}

export const isUncapped = (cap: bigint) => cap > 1_000_000_000_000_000_000n
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

/** The bit index of each method is stored onchain in the ad's payment mask. Never reorder. */
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
]

export const methodsForCountry = (code: string) =>
  PAYMENT_METHODS.filter((m) => m.countries === 'all' || m.countries.includes(code))

export const maskToMethods = (mask: number) =>
  PAYMENT_METHODS.filter((m) => (mask & (1 << m.bit)) !== 0)

export const bitsToMask = (bits: number[]) => bits.reduce((acc, b) => acc | (1 << b), 0)

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
  5: { label: 'In dispute', tone: 'danger' },
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

/** Format a raw 6-decimal USDC amount with US grouping. */
export function formatUsdcAmount(raw: bigint, digits = 2): string {
  const fixed = formatUnitsFixed(raw, 6, digits)
  const [i, f] = fixed.split('.')
  const g = BigInt(i).toLocaleString('en-US')
  return f ? `${g}.${f}` : g
}

export function formatOrderCap(cap: bigint): string {
  return isUncapped(cap) ? 'Uncapped' : `${formatUsdcAmount(cap, 0)} USDC`
}

/** Price (fiat per USDC) shown with up to 4 decimals, trimmed. */
export function formatPrice(e6: bigint): string {
  const fixed = formatUnitsFixed(e6, 6, 4)
  const [i, f] = fixed.split('.')
  const trimmed = (f ?? '').replace(/0+$/, '')
  const padded = trimmed.length < 2 ? trimmed.padEnd(2, '0') : trimmed
  return `${group(i)}.${padded}`
}

export const fiatFor = (usdcRaw: bigint, priceE6: bigint) => (usdcRaw * priceE6) / 1_000_000n
export const usdcFor = (fiatE6: bigint, priceE6: bigint) =>
  priceE6 === 0n ? 0n : (fiatE6 * 1_000_000n) / priceE6

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
  InvalidFee: 'Listing fee cannot exceed 0.50 USDC.',
  InvalidDetailsMode: 'Invalid payment details mode.',
  InvalidTtl: 'Ad expiry must be between 1 and 168 hours.',
  Restricted: 'This account is restricted from opening new trades.',
  DebtOutstanding: 'Repay your unpaid dispute bond on the Trust & margin tab before opening new ads or orders.',
  CooldownActive: 'A cooldown is active after repeated cancellations. Try again later.',
  RequirementNotMet: 'The advertiser requires more completed trades than you have.',
  AboveCap: 'That amount is above your current per-order account tier limit.',
  BuyAdNotAllowed: 'Posting a buy ad requires a Merchant badge (100+ USDC margin) or at least 3 completed trades.',
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
  SafeERC20FailedOperation: 'USDC transfer failed. Check your balance and approval.',
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
    return 'Insufficient USDC balance.'
  if (lower.includes('network') || lower.includes('timeout')) return 'Network issue. Please try again.'
  if (lower.includes('reverted')) return 'The transaction was rejected by the contract.'
  return 'Something went wrong. Please try again.'
}
