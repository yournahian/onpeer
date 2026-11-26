export interface KVStore {
  get(key: string, type: 'json'): Promise<unknown>
  put(key: string, value: string): Promise<void>
}

export interface HyperdriveBinding {
  connectionString: string
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException?: () => void
}

export interface ScheduledControllerLike {
  scheduledTime: number
  cron: string
}

export interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> }
  HYPERDRIVE?: HyperdriveBinding
  AI_SETTINGS_KV?: KVStore

  // Public / non-secret runtime vars
  ARC_NETWORK?: 'mainnet' | 'testnet' | string
  VITE_ARC_NETWORK?: 'mainnet' | 'testnet' | string
  VITE_P2P_ESCROW_ADDRESS?: string
  VITE_P2P_DEPLOY_BLOCK?: string
  VITE_P2P_EURC_ESCROW_ADDRESS?: string
  VITE_P2P_EURC_DEPLOY_BLOCK?: string
  VITE_P2P_CIRBTC_ESCROW_ADDRESS?: string
  VITE_P2P_CIRBTC_DEPLOY_BLOCK?: string
  VITE_P2P_WETH_ESCROW_ADDRESS?: string
  VITE_P2P_WETH_DEPLOY_BLOCK?: string
  VITE_ARC_TESTNET_EURC_ADDRESS?: string
  DIDIT_MODE?: 'sandbox' | 'live' | string
  PUBLIC_APP_URL?: string
  TELEGRAM_BOT_USERNAME?: string
  VITE_WALLETCONNECT_PROJECT_ID?: string
  ONRAMP_API_BASE_URL?: string
  ONRAMP_WIDGET_BASE_URL?: string
  ONRAMP_REFERRER_DOMAIN?: string

  // Phase 2 & Phase 3 Worker secrets (.dev.vars locally, Cloudflare secrets in production — never logged)
  SESSION_SECRET?: string
  VAULT_MASTER_KEY?: string
  DIDIT_API_KEY?: string
  DIDIT_WORKFLOW_ID?: string
  DIDIT_WEBHOOK_SECRET?: string
  VERIFIER_PRIVATE_KEY?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  ADMIN_ALERT_EMAIL?: string
  CIRCLE_API_KEY?: string
  ONRAMP_DEV_PASS?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_WEBHOOK_SECRET?: string
  TELEGRAM_ADMIN_CHAT_ID?: string

  // Legacy / AI assistant secrets
  ADMIN_SESSION_SECRET?: string
  AI_PROVIDER?: string
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
  GROQ_API_KEY?: string
  GROQ_MODEL?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  CUSTOM_AI_BASE_URL?: string
  CUSTOM_AI_API_KEY?: string
  CUSTOM_AI_MODEL?: string
  CUSTOM_AI_LABEL?: string
}

export const ARC_MAINNET_CHAIN_ID = 5042
export const ARC_TESTNET_CHAIN_ID = 5042002
export const CHAIN_ID = ARC_MAINNET_CHAIN_ID

export function isTestnetEnv(env: Env): boolean {
  const raw = (env.ARC_NETWORK ?? env.VITE_ARC_NETWORK ?? '').trim().toLowerCase()
  return raw === 'testnet'
}

export function activeChainId(env: Env): number {
  return isTestnetEnv(env) ? ARC_TESTNET_CHAIN_ID : ARC_MAINNET_CHAIN_ID
}

export const json = (status: number, body: unknown, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  })

export const textField = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' ? v.trim().slice(0, max) : undefined

/**
 * Normalize client IPs for rate-limiting:
 * - IPv4 addresses are kept verbatim.
 * - IPv6 addresses are collapsed to their `/64` network prefix so rotating SLAAC/privacy suffixes cannot bypass buckets.
 */
export function normalizeIpForRateLimit(rawIp: string): string {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '')
  if (!ip || ip === 'local') return 'local'
  const v4Mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (v4Mapped?.[1]) return v4Mapped[1]
  if (!ip.includes(':')) return ip.slice(0, 64)

  const parts = ip.split('::')
  if (parts.length > 2) return ip.toLowerCase().slice(0, 64)
  const left = parts[0] ? parts[0].split(':') : []
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : []
  const validHex = (seg: string) => /^[0-9a-fA-F]{1,4}$/.test(seg)
  if (!left.every(validHex) || !right.every(validHex)) {
    return ip.toLowerCase().slice(0, 64)
  }
  const missing = 8 - left.length - right.length
  if ((parts.length === 2 && missing < 1) || (parts.length === 1 && missing !== 0)) {
    return ip.toLowerCase().slice(0, 64)
  }
  const full = [...left, ...Array<string>(missing).fill('0'), ...right]
  const prefix64 = full
    .slice(0, 4)
    .map((h) => h.toLowerCase().padStart(4, '0'))
    .join(':')
  return `${prefix64}::/64`
}

export function clientIp(req: Request): string {
  const raw =
    req.headers.get('cf-connecting-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'local'
  return normalizeIpForRateLimit(raw)
}

export async function readJsonBody(req: Request, maxBytes = 200_000): Promise<Record<string, unknown> | null> {
  const ct = (req.headers.get('content-type') ?? '').toLowerCase()
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    return null
  }
  if (!ct.includes('application/json')) {
    const fetchSite = (req.headers.get('sec-fetch-site') ?? '').toLowerCase()
    if (fetchSite === 'cross-site') return null
    const origin = req.headers.get('origin')?.trim()
    if (origin) {
      try {
        if (new URL(origin).host !== new URL(req.url).host) return null
      } catch {
        return null
      }
    }
  }
  try {
    const raw = await req.text()
    if (raw.length > maxBytes) return null
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* invalid JSON */
  }
  return null
}

export function normalizeWallet(value: unknown): `0x${string}` | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(trimmed) ? (trimmed as `0x${string}`) : null
}

export function publicAppOrigin(env: Env, reqUrl?: URL): string {
  const configured = env.PUBLIC_APP_URL?.trim().replace(/\/+$/, '')
  if (configured && /^https?:\/\//i.test(configured)) return configured
  if (reqUrl && (reqUrl.hostname === 'localhost' || reqUrl.hostname === '127.0.0.1')) {
    return `${reqUrl.protocol}//${reqUrl.host}`
  }
  return 'https://app.onpeer.xyz'
}

export function isDiditSandbox(env: Env): boolean {
  return (env.DIDIT_MODE ?? '').trim().toLowerCase() === 'sandbox'
}
