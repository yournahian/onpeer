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
  VITE_P2P_ESCROW_ADDRESS?: string
  VITE_P2P_DEPLOY_BLOCK?: string
  VITE_P2P_EURC_ESCROW_ADDRESS?: string
  VITE_P2P_EURC_DEPLOY_BLOCK?: string
  VITE_ARC_TESTNET_EURC_ADDRESS?: string
  DIDIT_MODE?: 'sandbox' | 'live' | string
  PUBLIC_APP_URL?: string
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

export const CHAIN_ID = 5042002

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

export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'local'
  ).slice(0, 64)
}

export async function readJsonBody(req: Request, maxBytes = 200_000): Promise<Record<string, unknown> | null> {
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
