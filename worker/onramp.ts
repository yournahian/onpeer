import {
  KitError,
  createAppServerKit,
  type MintedOnrampSession,
  type OnrampSessionRequest,
} from '@circle-fin/app-kit/server'
import { requireSession } from './auth'
import { checkRateLimit, writeAudit, type Queryable } from './db'
import { clientIp, json, type Env } from './env'

export const SANDBOX_API_BASE_URL = 'https://api-test.circle.com'
export const PRODUCTION_API_BASE_URL = 'https://api.circle.com'
export const SANDBOX_WIDGET_BASE_URL = 'https://onramp-sandbox.arc.io'
export const PRODUCTION_WIDGET_BASE_URL = 'https://onramp.arc.io'

export const ONRAMP_WALLET_LIMIT_PER_MIN = 5
export const ONRAMP_IP_LIMIT_PER_HOUR = 20

/** Server-authoritative asset scoping — client-supplied `assets` are always ignored. */
export const SERVER_ONRAMP_ASSETS: NonNullable<OnrampSessionRequest['assets']> = {
  tokens: ['USDC'],
}

const BARE_HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i

export interface ValidatedOnrampConfig {
  apiKey: string
  apiBaseUrl: string
  widgetBaseUrl: string
  referrerDomain?: string
}

export type OnrampEnvCheckResult =
  | { ok: true; config: ValidatedOnrampConfig }
  | {
      ok: false
      code:
        | 'onramp_not_configured'
        | 'onramp_env_mismatch'
        | 'onramp_sandbox_only'
        | 'onramp_invalid_referrer_domain'
    }

function classifyApiKey(raw: string): 'sandbox' | 'production' | 'missing' | 'invalid' {
  if (!raw) return 'missing'
  if (raw.startsWith('TEST_API_KEY:')) {
    const parts = raw.split(':')
    return parts.length === 3 && parts[1].length > 0 && parts[2].length > 0 ? 'sandbox' : 'invalid'
  }
  if (raw.startsWith('LIVE_API_KEY:')) {
    const parts = raw.split(':')
    return parts.length === 3 && parts[1].length > 0 && parts[2].length > 0 ? 'production' : 'invalid'
  }
  return 'invalid'
}

function classifyApiBaseUrl(raw: string): 'sandbox' | 'production' | 'missing' | 'invalid' {
  if (!raw) return 'missing'
  if (raw === SANDBOX_API_BASE_URL) return 'sandbox'
  if (raw === PRODUCTION_API_BASE_URL) return 'production'
  return 'invalid'
}

function classifyWidgetBaseUrl(raw: string): 'sandbox' | 'production' | 'missing' | 'invalid' {
  if (!raw) return 'missing'
  if (raw === SANDBOX_WIDGET_BASE_URL) return 'sandbox'
  if (raw === PRODUCTION_WIDGET_BASE_URL) return 'production'
  return 'invalid'
}

/**
 * Startup / per-mint consistency check:
 * - Refuses to mint if `CIRCLE_API_KEY` prefix, `ONRAMP_API_BASE_URL`, or `ONRAMP_WIDGET_BASE_URL`
 *   are missing, malformed, or belong to different environments (`sandbox` vs `production`).
 * - Enforces sandbox-only operation for Phase 3 (rejects `LIVE_API_KEY:` / production URLs).
 * - Validates `ONRAMP_REFERRER_DOMAIN` as a bare hostname from server env (never `Origin` header).
 */
export function validateOnrampEnv(env: Env): OnrampEnvCheckResult {
  const apiKey = env.CIRCLE_API_KEY?.trim() ?? ''
  const apiBaseUrl = (env.ONRAMP_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const widgetBaseUrl = (env.ONRAMP_WIDGET_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const rawReferrer = (env.ONRAMP_REFERRER_DOMAIN ?? '').trim()

  const keyEnv = classifyApiKey(apiKey)
  const apiEnv = classifyApiBaseUrl(apiBaseUrl)
  const widgetEnv = classifyWidgetBaseUrl(widgetBaseUrl)

  if (keyEnv === 'missing' || apiEnv === 'missing' || widgetEnv === 'missing') {
    return { ok: false, code: 'onramp_not_configured' }
  }

  if (keyEnv === 'invalid' || apiEnv === 'invalid' || widgetEnv === 'invalid') {
    return { ok: false, code: 'onramp_env_mismatch' }
  }

  if (keyEnv !== apiEnv || apiEnv !== widgetEnv) {
    return { ok: false, code: 'onramp_env_mismatch' }
  }

  if (keyEnv !== 'sandbox') {
    return { ok: false, code: 'onramp_sandbox_only' }
  }

  if (rawReferrer && !BARE_HOSTNAME_RE.test(rawReferrer)) {
    return { ok: false, code: 'onramp_invalid_referrer_domain' }
  }

  return {
    ok: true,
    config: {
      apiKey,
      apiBaseUrl,
      widgetBaseUrl,
      referrerDomain: rawReferrer || undefined,
    },
  }
}

async function readOptionalJsonObject(req: Request, maxBytes = 8_192): Promise<Record<string, unknown> | null> {
  try {
    const raw = await req.text()
    if (raw.length > maxBytes) return null
    if (raw.trim().length === 0) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

export interface SafeOnrampSessionResponse {
  sessionId: string
  sessionToken: string
  widgetUrl: string
  destinationWallet: string
  expiresAt: string
  traceId: string
}

function toSafeSessionResponse(
  minted: MintedOnrampSession,
  forcedDestinationWallet: string,
): SafeOnrampSessionResponse {
  return {
    sessionId: minted.sessionId,
    sessionToken: minted.sessionToken,
    widgetUrl: minted.widgetUrl,
    destinationWallet: minted.destinationWallet ?? forcedDestinationWallet,
    expiresAt: minted.expiresAt,
    traceId: minted.traceId,
  }
}

export interface OnrampRouteOptions {
  fetchImpl?: typeof globalThis.fetch
}

/**
 * Handle `/api/onramp/*`:
 * - `POST /api/onramp/session`
 */
export async function handleOnrampRoutes(
  req: Request,
  env: Env,
  db: Queryable,
  subpath: string,
  opts?: OnrampRouteOptions,
): Promise<Response | null> {
  if (subpath !== '/onramp/session') return null
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' })
  }

  // 1. Require authenticated wallet session (401 without valid session)
  const auth = await requireSession(req, db)
  if (!auth.ok) return auth.response

  // 2. Enforce environment consistency & sandbox-only guard before consuming rate limits or calling Circle
  const envCheck = validateOnrampEnv(env)
  if (!envCheck.ok) {
    return json(503, { error: envCheck.code })
  }

  // 3. Enforce per-IP (20/hour) and per-wallet (5/min) rate limits
  const ip = clientIp(req)
  const ipAllowed = await checkRateLimit(db, `rl:onramp:ip:${ip}`, ONRAMP_IP_LIMIT_PER_HOUR, 3_600)
  if (!ipAllowed) {
    return json(429, { error: 'rate_limited' })
  }

  const wallet = auth.session.wallet.toLowerCase() as `0x${string}`
  const walletAllowed = await checkRateLimit(db, `rl:onramp:w:${wallet}`, ONRAMP_WALLET_LIMIT_PER_MIN, 60)
  if (!walletAllowed) {
    return json(429, { error: 'rate_limited' })
  }

  // 4. Validate JSON body envelope if sent, ignoring all client-supplied fields (destinationAddress, appUserId, assets)
  const body = await readOptionalJsonObject(req)
  if (!body) {
    return json(400, { error: 'bad_request' })
  }

  // Server-authoritative destination, user correlation, and asset filter
  const destinationAddress = wallet
  const appUserId = `wallet:${wallet}`

  try {
    const server = createAppServerKit({
      onramp: {
        apiKey: envCheck.config.apiKey,
        baseUrl: envCheck.config.apiBaseUrl,
        widgetBaseUrl: envCheck.config.widgetBaseUrl,
        ...(envCheck.config.referrerDomain ? { referrerDomain: envCheck.config.referrerDomain } : {}),
        ...(opts?.fetchImpl ? { fetch: opts.fetchImpl } : {}),
      },
    })

    const minted = await server.onramp.createSession({
      appUserId,
      destinationAddress,
      assets: SERVER_ONRAMP_ASSETS,
    })

    await writeAudit(db, wallet, 'onramp.session', minted.sessionId ?? minted.traceId)

    return json(200, toSafeSessionResponse(minted, destinationAddress))
  } catch (err) {
    if (err instanceof KitError) {
      const status =
        err.type === 'INPUT'
          ? 400
          : err.type === 'RATE_LIMIT'
            ? 429
            : err.type === 'NETWORK'
              ? 504
              : err.type === 'SERVICE' || err.type === 'RPC'
                ? 502
                : 500
      return json(status, {
        error: status === 429 ? 'rate_limited' : 'onramp_provider_error',
        code: err.name,
      })
    }
    return json(502, { error: 'onramp_provider_error' })
  }
}
