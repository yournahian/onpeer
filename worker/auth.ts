import { verifyMessage } from 'viem'
import { checkAdminAccess, type AdminAccessResult, type ChainReader } from './chain'
import { checkRateLimit, writeAudit, type Queryable } from './db'
import {
  CHAIN_ID,
  clientIp,
  json,
  normalizeWallet,
  readJsonBody,
  textField,
  type Env,
} from './env'

export const NONCE_TTL_MS = 5 * 60_000 // 5 minutes
export const SESSION_TTL_SECONDS = 12 * 60 * 60 // 12 hours

export interface SessionInfo {
  wallet: `0x${string}`
  tokenHash: string
}

export class AuthConfigError extends Error {
  constructor() {
    super('session_secret_not_configured')
  }
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(b64u: string): string | null {
  try {
    const padded = b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4)
    const bin = atob(padded)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** Constant-time byte comparison (no early exit on content mismatch). */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return toHex(new Uint8Array(digest))
}

function requireSessionSecret(env: Env): string {
  const secret = env.SESSION_SECRET?.trim()
  if (!secret || secret.length < 32) {
    throw new AuthConfigError()
  }
  return secret
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/** Sign an authenticated stateless payload (nonces, email-verify & unsubscribe links) with SESSION_SECRET. */
export async function signHmacToken(env: Env, payload: Record<string, unknown>): Promise<string> {
  const secret = requireSessionSecret(env)
  const key = await importHmacKey(secret)
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload))
  return `${encodedPayload}.${toHex(new Uint8Array(sig))}`
}

/** Verify an HMAC token in constant time and check `exp` (ms epoch). */
export async function verifyHmacToken(
  env: Env,
  token: string,
  nowMs = Date.now(),
): Promise<Record<string, unknown> | null> {
  const secret = requireSessionSecret(env)
  const dot = token.indexOf('.')
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null
  const encodedPayload = token.slice(0, dot)
  const sigBytes = fromHex(token.slice(dot + 1))
  if (!sigBytes || sigBytes.length !== 32) return null

  const key = await importHmacKey(secret)
  const expectedBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload))
  if (!timingSafeEqualBytes(sigBytes, new Uint8Array(expectedBuf))) return null

  const jsonStr = fromBase64Url(encodedPayload)
  if (!jsonStr) return null
  try {
    const parsed = JSON.parse(jsonStr) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const rec = parsed as Record<string, unknown>
    if (typeof rec.exp !== 'number' || rec.exp < nowMs) return null
    return rec
  } catch {
    return null
  }
}

export function buildLoginMessage(params: {
  wallet?: `0x${string}` | null
  nonceId: string
  issuedAtIso: string
}): string {
  const lines = [
    'OnPeer P2P Sign-In',
    'Domain: app.onpeer.xyz',
    ...(params.wallet ? [`Wallet: ${params.wallet}`] : []),
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${params.nonceId}`,
    `Issued At: ${params.issuedAtIso}`,
    'This signature proves you control this wallet. It costs no gas.',
  ]
  return lines.join('\n')
}

function generateOpaqueToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  const raw = header.slice(7).trim()
  return raw.length > 0 && raw.length <= 512 ? raw : null
}

/** Read and validate a 12-hour opaque session token from `public.sessions`. */
export async function getSession(req: Request, db: Queryable): Promise<SessionInfo | null> {
  const raw = extractBearerToken(req)
  if (!raw || !/^[0-9a-f]{64}$/.test(raw)) return null
  const tokenHash = await sha256Hex(raw)
  const res = await db.query<{ wallet: string }>(
    `SELECT wallet
       FROM public.sessions
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [tokenHash],
  )
  const row = res.rows[0]
  const wallet = row ? normalizeWallet(row.wallet) : null
  return wallet ? { wallet, tokenHash } : null
}

export async function requireSession(
  req: Request,
  db: Queryable,
): Promise<{ ok: true; session: SessionInfo } | { ok: false; response: Response }> {
  const session = await getSession(req, db)
  if (!session) {
    return { ok: false, response: json(401, { error: 'unauthorized' }) }
  }
  return { ok: true, session }
}

/**
 * Require a valid session AND verify admin role live onchain (`owner` or `arbiter`,
 * plus `backupArbiter` when `allowBackupArbiter` is explicitly requested).
 */
export async function requireAdmin(
  req: Request,
  db: Queryable,
  chain: ChainReader,
  opts?: { allowBackupArbiter?: boolean },
): Promise<
  | { ok: true; session: SessionInfo; admin: Extract<AdminAccessResult, { allowed: true }> }
  | { ok: false; response: Response }
> {
  const auth = await requireSession(req, db)
  if (!auth.ok) return auth
  const admin = await checkAdminAccess(chain, auth.session.wallet, opts)
  if (!admin.allowed) {
    return { ok: false, response: json(403, { error: 'forbidden' }) }
  }
  return { ok: true, session: auth.session, admin }
}

/**
 * Handle `/api/auth/*`:
 * - `POST /api/auth/nonce`
 * - `POST /api/auth/login`
 * - `POST /api/auth/logout`
 * - `GET  /api/auth/me`
 */
export async function handleAuthRoutes(
  req: Request,
  env: Env,
  db: Queryable,
  subpath: string,
  nowMs = Date.now(),
): Promise<Response | null> {
  const ip = clientIp(req)

  if (req.method === 'POST' && subpath === '/auth/nonce') {
    if (!(await checkRateLimit(db, `rl:auth:nonce:${ip}`, 20, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const body = (await readJsonBody(req, 4_096)) ?? {}
    const wallet = body.address !== undefined ? normalizeWallet(body.address) : null
    if (body.address !== undefined && !wallet) {
      return json(400, { error: 'bad_request' })
    }
    const nonceId = crypto.randomUUID()
    const issuedAtIso = new Date(nowMs).toISOString()
    const exp = nowMs + NONCE_TTL_MS
    const nonce = await signHmacToken(env, {
      kind: 'auth_nonce',
      id: nonceId,
      sub: wallet,
      iat: issuedAtIso,
      exp,
    })
    const message = buildLoginMessage({ wallet, nonceId, issuedAtIso })
    return json(200, { nonce, message, expiresInSeconds: NONCE_TTL_MS / 1000 })
  }

  if (req.method === 'POST' && subpath === '/auth/login') {
    if (!(await checkRateLimit(db, `rl:auth:login:ip:${ip}`, 15, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const body = await readJsonBody(req, 8_192)
    if (!body) return json(400, { error: 'bad_request' })

    const wallet = normalizeWallet(body.address)
    const signature = textField(body.signature, 600)
    const nonceToken = textField(body.nonce, 600)
    if (!wallet || !signature || !/^0x[0-9a-fA-F]{128,520}$/.test(signature) || !nonceToken) {
      return json(400, { error: 'bad_request' })
    }
    if (!(await checkRateLimit(db, `rl:auth:login:w:${wallet}`, 10, 60))) {
      return json(429, { error: 'rate_limited' })
    }

    const verified = await verifyHmacToken(env, nonceToken, nowMs)
    if (
      !verified ||
      verified.kind !== 'auth_nonce' ||
      typeof verified.id !== 'string' ||
      typeof verified.iat !== 'string'
    ) {
      return json(401, { error: 'nonce_expired' })
    }
    if (verified.sub !== null && verified.sub !== undefined && verified.sub !== wallet) {
      return json(401, { error: 'bad_signature' })
    }

    const message = buildLoginMessage({
      wallet: typeof verified.sub === 'string' ? (verified.sub as `0x${string}`) : null,
      nonceId: verified.id,
      issuedAtIso: verified.iat,
    })
    const sigOk = await verifyMessage({
      address: wallet,
      message,
      signature: signature as `0x${string}`,
    }).catch(() => false)
    if (!sigOk) {
      return json(401, { error: 'bad_signature' })
    }

    // Atomic single-use nonce consumption across all Worker isolates
    const nonceTtlSec = Math.max(1, Math.ceil((Number(verified.exp) - nowMs) / 1000))
    const consume = await db.query(
      `INSERT INTO public.rate_limits (bucket, count, reset_at)
       VALUES ($1, 1, now() + make_interval(secs => $2))
       ON CONFLICT (bucket) DO NOTHING`,
      [`nonce_used:${verified.id}`, nonceTtlSec],
    )
    if ((consume.rowCount ?? 0) === 0) {
      return json(401, { error: 'nonce_expired' })
    }

    const token = generateOpaqueToken()
    const tokenHash = await sha256Hex(token)
    const expiresAt = new Date(nowMs + SESSION_TTL_SECONDS * 1000).toISOString()

    await db.query(
      `INSERT INTO public.sessions (token_hash, wallet, expires_at)
       VALUES ($1, $2, $3::timestamptz)`,
      [tokenHash, wallet, expiresAt],
    )
    await writeAudit(db, wallet, 'auth.login', null)

    return json(200, {
      token,
      wallet,
      expiresInSeconds: SESSION_TTL_SECONDS,
      expiresAt,
    })
  }

  if (req.method === 'POST' && subpath === '/auth/logout') {
    const auth = await requireSession(req, db)
    if (!auth.ok) return auth.response
    await db.query(
      `UPDATE public.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [auth.session.tokenHash],
    )
    await writeAudit(db, auth.session.wallet, 'auth.logout', null)
    return json(200, { ok: true })
  }

  if (req.method === 'GET' && subpath === '/auth/me') {
    if (!(await checkRateLimit(db, `rl:auth:me:${ip}`, 60, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const auth = await requireSession(req, db)
    if (!auth.ok) return auth.response
    return json(200, { wallet: auth.session.wallet })
  }

  return null
}
