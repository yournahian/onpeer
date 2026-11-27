import { zeroAddress, type Address, type Hex } from 'viem'
import { formatUnitsExact } from '@/onchain-money'

export interface AchSwapFeeInfo {
  token: Address
  protocolBps: number
  protocolAmount: string
  partnerBps: number
  partnerAmount: string
  partnerRecipient: Address | null
}

export interface AchSwapHop {
  dex: string
  pool: string | null
  tokenIn: Address
  tokenOut: Address
}

export interface AchSwapRouteSplit {
  shareBps: number
  hops: AchSwapHop[]
}

export interface AchSwapQuoteResponse {
  chainId: number
  tokenIn: Address
  tokenOut: Address
  amountIn: string
  amountOut: string
  minAmountOut: string
  slippageBps: number
  grossAmountOut: string
  fees: AchSwapFeeInfo
  priceImpactBps: number | null
  gasEstimate: string | null
  route: AchSwapRouteSplit[]
  requestId?: string
}

export interface AchSwapBuildResponse extends AchSwapQuoteResponse {
  sender: Address
  recipient: Address
  deadline: number
  tx: {
    to: Address
    data: Hex
    value: string
    gas: string | null
  }
  approval: {
    token: Address
    spender: Address
    amount: string
  } | null
  simulated: boolean
}

export class AchSwapError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}

/**
 * On Arc Mainnet, AchSwap accepts native USDC (`0x0000...0000`, 18 decimals) as `tokenIn`
 * so swaps from USDC require zero ERC-20 approval transactions.
 */
export function toAchSwapInput(
  symbol: 'USDC' | 'EURC' | 'cirBTC' | 'WETH',
  erc20Address: Address | undefined,
  amountRaw: bigint,
): { tokenIn: Address; amountIn: string } {
  if (symbol === 'USDC') {
    return {
      tokenIn: zeroAddress,
      amountIn: (amountRaw * 1_000_000_000_000n).toString(),
    }
  }
  if (!erc20Address) throw new AchSwapError(`Token ${symbol} is not configured on Arc Mainnet.`)
  return {
    tokenIn: erc20Address,
    amountIn: amountRaw.toString(),
  }
}

export function toAchSwapOutput(symbol: 'USDC' | 'EURC' | 'cirBTC' | 'WETH', erc20Address: Address | undefined): Address {
  if (symbol === 'USDC') return '0x3600000000000000000000000000000000000000'
  if (!erc20Address) throw new AchSwapError(`Token ${symbol} is not configured on Arc Mainnet.`)
  return erc20Address
}

async function postAchSwap<T>(path: '/api/swap/quote' | '/api/swap/build', body: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AchSwapError('Could not reach the swap service. Please try again.')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; detail?: string }
  if (!res.ok) {
    const friendly =
      data.code === 'NO_ROUTE'
        ? 'No liquidity route is available for this token pair right now.'
        : data.detail || data.error || 'Swap quote failed. Please try again.'
    throw new AchSwapError(friendly, data.code ?? data.error)
  }
  return data as T
}

export function fetchAchSwapQuote(params: {
  tokenIn: Address
  tokenOut: Address
  amountIn: string
  slippageBps: number
}): Promise<AchSwapQuoteResponse> {
  return postAchSwap<AchSwapQuoteResponse>('/api/swap/quote', params)
}

export function fetchAchSwapBuild(params: {
  tokenIn: Address
  tokenOut: Address
  amountIn: string
  slippageBps: number
  sender: Address
  recipient?: Address
}): Promise<AchSwapBuildResponse> {
  return postAchSwap<AchSwapBuildResponse>('/api/swap/build', params)
}

export function formatAchSwapRouteSummary(route: AchSwapRouteSplit[]): string | null {
  const dexes = Array.from(new Set(route.flatMap((s) => s.hops.map((h) => h.dex)).filter(Boolean)))
  return dexes.length > 0 ? dexes.join(' · ') : null
}

export function formatAchSwapFees(
  fees: AchSwapFeeInfo,
  tokenOutSymbol: string,
  decimalsOut: number,
): Array<{ type: string; amount: string; token: string }> {
  const rows: Array<{ type: string; amount: string; token: string }> = []
  if (fees.protocolBps > 0) {
    rows.push({
      type: `AchSwap (${(fees.protocolBps / 100).toFixed(2)}%)`,
      amount: formatUnitsExact(BigInt(fees.protocolAmount || '0'), decimalsOut),
      token: tokenOutSymbol,
    })
  }
  if (fees.partnerBps > 0) {
    rows.push({
      type: `Platform (${(fees.partnerBps / 100).toFixed(2)}%)`,
      amount: formatUnitsExact(BigInt(fees.partnerAmount || '0'), decimalsOut),
      token: tokenOutSymbol,
    })
  }
  return rows
}
