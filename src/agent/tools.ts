import { erc20Abi, type Address, type PublicClient } from 'viem'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { getUsdc } from '@/onchain-facts'
import { formatUnitsFixed } from '@/onchain-money'
import { arcTestnet } from 'viem/chains'
import type { SwapToken } from '@/hooks/useSwapFlow'
import type { BridgeChainName } from '@/hooks/useBridgeFlow'
import {
  CHAIN_ID,
  COUNTRIES,
  ESCROW_ADDRESS,
  SIDE_BUY,
  SIDE_SELL,
  STATUS_META,
  countryByCurrency,
  fiatFor,
  formatFiat,
  formatPrice,
  hexToCurrency,
  maskToMethods,
  sameAddr,
  shortAddr,
} from '@/lib/p2p'

export type InlineAction =
  | { kind: 'swap'; tokenIn: SwapToken; amount: string }
  | { kind: 'bridge'; from: BridgeChainName; to: BridgeChainName; amount: string }

export type Proposal = {
  /** When set, the user can finish the action right inside the chat instead of opening the page. */
  inline?: InlineAction
  kind: 'swap' | 'bridge' | 'trade' | 'order'
  title: string
  lines: string[]
  url: string
  cta: string
}

export type ToolContext = { client: PublicClient; address?: Address }
export type ToolOutcome = { result: unknown; proposal?: Proposal }

const AMOUNT = /^\d+(\.\d{1,6})?$/
const BRIDGE_CHAINS = [
  'Arc_Testnet',
  'Ethereum_Sepolia',
  'Base_Sepolia',
  'Arbitrum_Sepolia',
  'Optimism_Sepolia',
  'Avalanche_Fuji',
  'Polygon_Amoy_Testnet',
]
const CHAIN_LABEL = (c: string) => c.replace(/_/g, ' ')

const eurc = (import.meta.env.VITE_ARC_TESTNET_EURC_ADDRESS as string | undefined)?.trim()

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const toRaw = (v: string): bigint => {
  const [i, f = ''] = v.split('.')
  return BigInt(i + f.padEnd(6, '0').slice(0, 6))
}
const usdcText = (raw: bigint) => formatUnitsFixed(raw, 6, 2)

export const TOOL_LABELS: Record<string, string> = {
  search_p2p_ads: 'Searching P2P ads',
  get_wallet_summary: 'Checking your balances',
  get_my_orders: 'Loading your orders',
  propose_swap: 'Preparing swap',
  propose_bridge: 'Preparing bridge',
  propose_p2p_trade: 'Preparing P2P order',
  open_order: 'Finding your order',
}

const walletLine = (ctx: ToolContext) => (ctx.address ? [] : ['Connect your wallet on the next page to continue'])

function requireEscrow(): Address {
  if (!ESCROW_ADDRESS) throw new Error('The P2P contract is not configured.')
  return ESCROW_ADDRESS
}

async function searchAds(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const escrow = requireEscrow()
  const action = str(args.action)
  const currency = str(args.currency).toUpperCase()
  if (action !== 'buy' && action !== 'sell') return { result: { error: 'action must be buy or sell' } }
  if (!countryByCurrency(currency)) return { result: { error: `unsupported currency ${currency}` } }
  const method = str(args.payment_method).toLowerCase()
  const amountText = str(args.usdc_amount)
  const wanted = amountText && AMOUNT.test(amountText) ? toRaw(amountText) : null

  const total = await ctx.client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'adCount' })
  if (total === 0n) return { result: { ads: [], note: 'No ads exist yet.' } }
  const page = 200n
  const offset = total > page ? total - page : 0n
  const list = await ctx.client.readContract({
    address: escrow,
    abi: p2pEscrowAbi,
    functionName: 'getAds',
    args: [offset, page],
  })

  const wantedSide = action === 'buy' ? SIDE_SELL : SIDE_BUY
  const matches = list
    .map((ad, i) => ({ ad, id: offset + BigInt(i) + 1n }))
    .filter(({ ad }) => !ad.paused && !ad.closed && ad.available > 0n)
    .filter(({ ad }) => ad.side === wantedSide && hexToCurrency(ad.currency) === currency)
    .filter(({ ad }) => !method || maskToMethods(ad.paymentMask).some((m) => m.name.toLowerCase().includes(method)))
    .filter(({ ad }) => {
      if (wanted === null) return true
      if (wanted > ad.available || wanted > ad.maxAmount) return false
      return wanted >= ad.minAmount || wanted === ad.available
    })
    .sort((a, b) => (action === 'buy' ? Number(a.ad.priceE6 - b.ad.priceE6) : Number(b.ad.priceE6 - a.ad.priceE6)))
    .slice(0, 5)

  const makers = await Promise.all(
    matches.map(({ ad }) =>
      ctx.client
        .readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'getAccount', args: [ad.maker] })
        .catch(() => null),
    ),
  )

  // Deliberately omits ad notes and payment details: they are user-written text.
  return {
    result: {
      ads: matches.map(({ ad, id }, i) => ({
        ad_id: id.toString(),
        price: `${formatPrice(ad.priceE6)} ${currency} per USDC`,
        available_usdc: usdcText(ad.available),
        min_usdc: usdcText(ad.minAmount),
        max_usdc: usdcText(ad.maxAmount > ad.available ? ad.available : ad.maxAmount),
        payment_methods: maskToMethods(ad.paymentMask).map((m) => m.name),
        pay_within_minutes: ad.windowMinutes,
        advertiser: shortAddr(ad.maker),
        merchant: ad.merchantAd,
        advertiser_completed_trades: makers[i]?.ordersCompleted ?? null,
        requires_taker_trades: ad.minTakerCompleted,
      })),
    },
  }
}

async function walletSummary(ctx: ToolContext): Promise<ToolOutcome> {
  if (!ctx.address) return { result: { connected: false } }
  const usdc = getUsdc(CHAIN_ID)?.address as Address | undefined
  const read = async (token: Address | undefined) => {
    if (!token) return null
    const raw = await ctx.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ctx.address as Address],
    })
    return formatUnitsFixed(raw, 6, 2)
  }
  const [u, e] = await Promise.all([
    read(usdc),
    read(eurc && /^0x[0-9a-fA-F]{40}$/.test(eurc) ? (eurc as Address) : undefined),
  ])
  return {
    result: { connected: true, address: ctx.address, network: arcTestnet.name, usdc_balance: u, eurc_balance: e },
  }
}

async function myOrders(ctx: ToolContext): Promise<ToolOutcome> {
  const escrow = requireEscrow()
  if (!ctx.address) return { result: { connected: false } }
  const ids = await ctx.client.readContract({
    address: escrow,
    abi: p2pEscrowAbi,
    functionName: 'getUserOrderIds',
    args: [ctx.address],
  })
  const recent = ids.slice(-8).reverse()
  const orders = await Promise.all(
    recent.map((id) =>
      ctx.client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'getOrder', args: [id] }),
    ),
  )
  return {
    result: {
      orders: orders.map((o, i) => {
        const currency = hexToCurrency(o.currency)
        return {
          order_id: recent[i].toString(),
          role: sameAddr(o.buyer, ctx.address) ? 'buyer' : 'seller',
          status: STATUS_META[o.status]?.label ?? 'Unknown',
          usdc: usdcText(o.amount),
          fiat: `${formatFiat(o.fiatAmountE6)} ${currency}`,
          pay_by: o.status === 1 ? new Date(Number(o.deadline) * 1000).toISOString() : undefined,
        }
      }),
    },
  }
}

function proposeSwap(args: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  const token = str(args.token_in).toUpperCase()
  const amount = str(args.amount)
  if (token !== 'USDC' && token !== 'EURC') return { result: { error: 'token_in must be USDC or EURC' } }
  if (!AMOUNT.test(amount) || toRaw(amount) === 0n) return { result: { error: 'amount must be a positive decimal number' } }
  const out = token === 'USDC' ? 'EURC' : 'USDC'
  return {
    result: { status: 'card_shown', note: 'The user must review the quote and sign on the Swap page.' },
    proposal: {
      kind: 'swap',
      title: `Swap ${amount} ${token} to ${out}`,
      lines: ['Network: Arc Testnet', 'You will see the live quote and fees before signing', ...walletLine(ctx)],
      url: `/swap?tokenIn=${token}&amount=${amount}`,
      cta: 'Review swap',
      inline: { kind: 'swap', tokenIn: token, amount },
    },
  }
}

function proposeBridge(args: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  const from = str(args.from_chain)
  const to = str(args.to_chain)
  const amount = str(args.amount)
  if (!BRIDGE_CHAINS.includes(from) || !BRIDGE_CHAINS.includes(to)) return { result: { error: 'unsupported chain' } }
  if (from === to) return { result: { error: 'from_chain and to_chain must differ' } }
  if (!AMOUNT.test(amount) || toRaw(amount) === 0n) return { result: { error: 'amount must be a positive decimal number' } }
  return {
    result: { status: 'card_shown', note: 'The user must review the fees and sign on the Bridge page.' },
    proposal: {
      kind: 'bridge',
      title: `Bridge ${amount} USDC`,
      lines: [`From ${CHAIN_LABEL(from)}`, `To ${CHAIN_LABEL(to)} (your own wallet)`, 'Fees are shown before you sign', ...walletLine(ctx)],
      url: `/bridge?from=${from}&to=${to}&amount=${amount}`,
      cta: 'Review bridge',
      inline: { kind: 'bridge', from: from as BridgeChainName, to: to as BridgeChainName, amount },
    },
  }
}

async function proposeTrade(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const escrow = requireEscrow()
  const idText = str(args.ad_id)
  const amountText = str(args.usdc_amount)
  if (!/^\d+$/.test(idText)) return { result: { error: 'ad_id must come from search_p2p_ads' } }
  if (!AMOUNT.test(amountText) || toRaw(amountText) === 0n) return { result: { error: 'usdc_amount must be a positive number' } }
  const amount = toRaw(amountText)
  const id = BigInt(idText)
  const ad = await ctx.client
    .readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'getAd', args: [id] })
    .catch(() => null)
  if (!ad || ad.maker === '0x0000000000000000000000000000000000000000') return { result: { error: 'ad not found' } }
  if (ad.paused || ad.closed || ad.available === 0n) return { result: { error: 'ad is not available' } }
  if (sameAddr(ad.maker, ctx.address)) return { result: { error: 'cannot trade against your own ad' } }
  if (amount > ad.available || amount > ad.maxAmount || (amount < ad.minAmount && amount !== ad.available))
    return {
      result: {
        error: 'amount outside ad limits',
        min_usdc: usdcText(ad.minAmount),
        max_usdc: usdcText(ad.maxAmount > ad.available ? ad.available : ad.maxAmount),
      },
    }
  const currency = hexToCurrency(ad.currency)
  const country = COUNTRIES.find((c) => c.currency === currency)
  const buying = ad.side === SIDE_SELL
  return {
    result: { status: 'card_shown', note: 'The user must review and sign in the trade sheet.' },
    proposal: {
      kind: 'trade',
      title: `${buying ? 'Buy' : 'Sell'} ${amountText} USDC`,
      lines: [
        `${buying ? 'You pay' : 'You receive'} ${country?.symbol ?? ''} ${formatFiat(fiatFor(amount, ad.priceE6))} ${currency}`,
        `Price ${formatPrice(ad.priceE6)} ${currency} per USDC`,
        `Methods: ${maskToMethods(ad.paymentMask).map((m) => m.name).join(', ')}`,
        buying ? 'Pay in fiat outside the app, then mark the order as paid.' : 'Your USDC is locked in escrow when the order opens.',
        ...walletLine(ctx),
      ],
      url: `/p2p?trade=${idText}&amount=${amountText}`,
      cta: 'Review order',
    },
  }
}

async function openOrder(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const escrow = requireEscrow()
  const idText = str(args.order_id)
  if (!/^\d+$/.test(idText)) return { result: { error: 'order_id must be a number' } }
  const order = await ctx.client
    .readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'getOrder', args: [BigInt(idText)] })
    .catch(() => null)
  if (!order || order.status === 0) return { result: { error: 'order not found' } }
  return {
    result: { status: 'card_shown', order_status: STATUS_META[order.status]?.label },
    proposal: {
      kind: 'order',
      title: `Order #${idText}`,
      lines: [`Status: ${STATUS_META[order.status]?.label ?? 'Unknown'}`, 'Pay, release, message or dispute from the order page.'],
      url: `/p2p?order=${idText}`,
      cta: 'Open order',
    },
  }
}

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    switch (name) {
      case 'search_p2p_ads':
        return await searchAds(args, ctx)
      case 'get_wallet_summary':
        return await walletSummary(ctx)
      case 'get_my_orders':
        return await myOrders(ctx)
      case 'propose_swap':
        return proposeSwap(args, ctx)
      case 'propose_bridge':
        return proposeBridge(args, ctx)
      case 'propose_p2p_trade':
        return await proposeTrade(args, ctx)
      case 'open_order':
        return await openOrder(args, ctx)
      default:
        return { result: { error: `unknown tool ${name}` } }
    }
  } catch {
    return { result: { error: 'The lookup failed. Try again in a moment.' } }
  }
}

