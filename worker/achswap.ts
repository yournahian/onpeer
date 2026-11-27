import { isAddress } from 'viem'
import { checkRateLimit, type Queryable } from './db'
import { clientIp, isTestnetEnv, json, readJsonBody, type Env } from './env'

const ACHSWAP_API_BASE = 'https://trade.achswap.app/api/v1'
export const ACHSWAP_EXECUTOR_V2 = '0xF69036De0e32566CfF7C79c29229D441cdE3e48E'
const DEFAULT_FEE_RECIPIENT = '0x81eA9AdE2805e310E9f884a75B3a24Ab74557C69'
const UINT_STRING_RE = /^[1-9]\d{0,40}$/

function resolvePartnerFee(env: Env): { feeBps?: number; feeRecipient?: string } {
  const rawBps = env.ACHSWAP_FEE_BPS?.trim()
  if (!rawBps) return {}
  const bps = Number.parseInt(rawBps, 10)
  if (!Number.isFinite(bps) || bps <= 0 || bps > 100) return {}
  const recipient = env.ACHSWAP_FEE_RECIPIENT?.trim() || DEFAULT_FEE_RECIPIENT
  if (!isAddress(recipient)) return {}
  return { feeBps: bps, feeRecipient: recipient }
}

function parseSlippageBps(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 100
  const n = Math.round(raw)
  return Math.max(10, Math.min(2000, n))
}

async function forwardAchSwap(
  apiKey: string,
  endpoint: '/quote' | '/swap',
  payload: Record<string, unknown>,
): Promise<Response> {
  let upstream: Response
  try {
    upstream = await fetch(`${ACHSWAP_API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    const aborted = (err as { name?: string }).name === 'AbortError'
    return json(504, { error: 'swap_provider_timeout', detail: aborted ? 'AchSwap timed out' : 'Could not reach AchSwap' })
  }

  const rawText = await upstream.text().catch(() => '')
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null
  } catch {
    parsed = null
  }

  if (!upstream.ok) {
    const code = typeof parsed?.code === 'string' ? parsed.code : typeof parsed?.error === 'string' ? parsed.error : undefined
    const reason =
      typeof parsed?.reason === 'string'
        ? parsed.reason
        : typeof parsed?.message === 'string'
          ? parsed.message
          : typeof parsed?.error === 'string'
            ? parsed.error
            : `HTTP ${upstream.status}`
    console.error('[achswap] upstream error', endpoint, upstream.status, code, reason)
    const status = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502
    return json(status, {
      error: 'swap_provider_error',
      code,
      detail: reason.slice(0, 180),
    })
  }

  if (!parsed) {
    return json(502, { error: 'swap_provider_error', detail: 'Invalid response from AchSwap' })
  }

  // Defense-in-depth: ensure /swap only ever targets the verified AchRouteExecutorV2 contract.
  if (endpoint === '/swap') {
    const tx = parsed.tx as { to?: unknown } | undefined
    if (typeof tx?.to !== 'string' || tx.to.toLowerCase() !== ACHSWAP_EXECUTOR_V2.toLowerCase()) {
      console.error('[achswap] unexpected tx.to', tx?.to)
      return json(502, { error: 'swap_provider_error', detail: 'Unexpected swap executor address' })
    }
  }

  return json(200, parsed)
}

export async function handleAchSwapRoutes(
  req: Request,
  env: Env,
  db: Queryable | null,
  path: string,
): Promise<Response | null> {
  if (path !== '/swap/quote' && path !== '/swap/build') return null
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' })
  if (isTestnetEnv(env)) {
    return json(400, { error: 'swap_mainnet_only', detail: 'AchSwap API is only available on Arc Mainnet (5042).' })
  }

  const apiKey = env.ACHSWAP_API_KEY?.trim()
  if (!apiKey) {
    return json(503, { error: 'swap_not_configured', detail: 'ACHSWAP_API_KEY is not configured on the server.' })
  }

  const ip = clientIp(req)
  if (db) {
    const limit = path === '/swap/quote' ? 60 : 30
    const allowed = await checkRateLimit(db, `rl:achswap:${path}:${ip}`, limit, 60)
    if (!allowed) return json(429, { error: 'rate_limited' })
  }

  const body = await readJsonBody(req, 8_192)
  if (!body) return json(400, { error: 'bad_request' })

  const tokenIn = typeof body.tokenIn === 'string' ? body.tokenIn.trim() : ''
  const tokenOut = typeof body.tokenOut === 'string' ? body.tokenOut.trim() : ''
  const amountIn = typeof body.amountIn === 'string' ? body.amountIn.trim() : ''
  if (!isAddress(tokenIn) || !isAddress(tokenOut) || !UINT_STRING_RE.test(amountIn)) {
    return json(400, { error: 'bad_request', detail: 'Invalid tokenIn, tokenOut, or amountIn.' })
  }
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    return json(400, { error: 'bad_request', detail: 'Input and output tokens must differ.' })
  }

  const slippageBps = parseSlippageBps(body.slippageBps)
  const fee = resolvePartnerFee(env)
  const payload: Record<string, unknown> = {
    chainId: 5042,
    tokenIn,
    tokenOut,
    amountIn,
    slippageBps,
    ...fee,
  }

  if (path === '/swap/build') {
    const sender = typeof body.sender === 'string' ? body.sender.trim() : ''
    const recipient = typeof body.recipient === 'string' && body.recipient.trim() ? body.recipient.trim() : sender
    if (!isAddress(sender) || !isAddress(recipient)) {
      return json(400, { error: 'bad_request', detail: 'Valid sender address is required.' })
    }
    payload.sender = sender
    payload.recipient = recipient
    return forwardAchSwap(apiKey, '/swap', payload)
  }

  return forwardAchSwap(apiKey, '/quote', payload)
}
