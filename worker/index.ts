import { formatEther, isAddress, verifyMessage } from 'viem'
import { SYSTEM_PROMPT, TOOLS } from '../server/agent'
import type { ProviderId, SavedSettings } from '../server/settings'
import {
  AuthConfigError,
  getSession,
  handleAuthRoutes,
  SESSION_TTL_SECONDS,
  sha256Hex,
  signHmacToken,
  verifyHmacToken,
} from './auth'
import { handleAccountRoutes, maskEmail } from './accounts'
import { checkAdminAccess, createArcPublicClient, createChainReader, type ChainReader } from './chain'
import { CryptoTamperError, openText, sealText, VaultConfigError } from './crypto'
import { DbUnavailableError, withDb, writeAudit, type Queryable } from './db'
import { handleKycRoutes, processOnchainJobsBatch } from './kyc'
import { handleChatRoutes } from './chat'
import { handleVaultRoutes } from './vault'
import { handleDisputeRoutes } from './disputes'
import { handleSocialRoutes } from './social'
import { handleOnrampRoutes, SANDBOX_API_BASE_URL, SANDBOX_WIDGET_BASE_URL } from './onramp'
import { handleTelegramRoutes, setupTelegramBotWebhook } from './telegram'
import { handleSeoFileRequest, injectSeoIntoHtmlResponse } from './seo'
import { processNotificationsOutbox } from './notify'
import { recordCronHealth, runAllCronJobs, scanChainEvents } from './cron'
import { checkRateLimit } from './db'
import {
  CHAIN_ID,
  clientIp,
  json,
  normalizeWallet,
  readJsonBody,
  textField,
  type Env,
  type ScheduledControllerLike,
  type WorkerExecutionContext,
} from './env'

const PROVIDER_IDS: ProviderId[] = ['openrouter', 'groq', 'gemini', 'custom']

type ProviderConfig = {
  label: string
  baseUrl: string | undefined
  apiKey: string | undefined
  model: string | undefined
  source: 'admin' | 'env' | 'none'
}

const NONCE_TTL = 5 * 60_000
const SESSION_TTL = 30 * 60_000
const KV_KEY = 'ai-settings'

// Isolate-local fallback when AI_SETTINGS_KV is not bound yet.
let memorySettings: SavedSettings = { providers: {} }
const memoryAdTerms = new Map<string, string>()
const memoryPresence = new Map<string, number>()
const PRESENCE_ONLINE_MS = 90_000

async function recordPresence(db: Queryable, wallet: string): Promise<void> {
  const w = wallet.toLowerCase()
  memoryPresence.set(w, Date.now())
  try {
    await db.query(
      `INSERT INTO public.rate_limits (bucket, count, reset_at)
       VALUES ($1, 1, now() + interval '90 seconds')
       ON CONFLICT (bucket) DO UPDATE SET reset_at = now() + interval '90 seconds'`,
      [`presence:${w}`],
    )
  } catch {
    /* non-fatal: memory fallback */
  }
}

async function readPresenceMap(
  env: Env,
  wallets: string[],
): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {}
  if (wallets.length === 0) return result
  const now = Date.now()
  for (const w of wallets) {
    const mem = memoryPresence.get(w)
    result[w] = Boolean(mem && now - mem <= PRESENCE_ONLINE_MS)
  }
  try {
    const buckets = wallets.map((w) => `presence:${w}`)
    const rows = await withDb(env, async (db) => {
      const res = await db.query<{ bucket: string }>(
        `SELECT bucket FROM public.rate_limits WHERE bucket = ANY($1::text[]) AND reset_at > now()`,
        [buckets],
      )
      return res.rows
    })
    for (const r of rows) {
      const w = r.bucket.replace(/^presence:/, '')
      if (w in result) {
        result[w] = true
        memoryPresence.set(w, now)
      }
    }
  } catch {
    /* keep memory fallback */
  }
  return result
}

async function getStoredAdTerms(env: Env, adId: string): Promise<string | null> {
  if (env.AI_SETTINGS_KV) {
    try {
      const val = (await env.AI_SETTINGS_KV.get(`ad_terms:${adId}`, 'json')) as { terms?: string } | null
      if (typeof val?.terms === 'string') return val.terms
    } catch {
      /* fallback to memory */
    }
  }
  return memoryAdTerms.get(adId) ?? null
}

async function setStoredAdTerms(env: Env, adId: string, terms: string): Promise<void> {
  memoryAdTerms.set(adId, terms)
  if (env.AI_SETTINGS_KV) {
    try {
      await env.AI_SETTINGS_KV.put(`ad_terms:${adId}`, JSON.stringify({ terms }))
    } catch {
      /* non-fatal */
    }
  }
}

const AI_SETTINGS_SENTINEL_ORDER_ID = -1
const AI_SETTINGS_SENTINEL_AUTHOR = '0x0000000000000000000000000000000000000000'
const AI_SETTINGS_AAD = 'system:ai-settings:v1'

async function loadSettings(env: Env): Promise<SavedSettings> {
  // Primary: encrypted Postgres storage (immune to Cloudflare KV free-tier limits)
  if (env.HYPERDRIVE) {
    try {
      const row = await withDb(env, async (db) => {
        const res = await db.query<{ body_enc: string }>(
          `SELECT body_enc
             FROM public.chat_messages
            WHERE order_id = $1 AND author = $2
            ORDER BY id DESC
            LIMIT 1`,
          [AI_SETTINGS_SENTINEL_ORDER_ID, AI_SETTINGS_SENTINEL_AUTHOR],
        )
        return res.rows[0] ?? null
      })
      if (row?.body_enc) {
        const plain = await openText(env, row.body_enc, AI_SETTINGS_AAD)
        const parsed = JSON.parse(plain) as SavedSettings
        const normalized = { active: parsed.active, providers: parsed.providers ?? {} }
        memorySettings = normalized
        return normalized
      }
    } catch {
      /* fallback to KV or memory */
    }
  }
  if (env.AI_SETTINGS_KV) {
    try {
      const raw = (await env.AI_SETTINGS_KV.get(KV_KEY, 'json')) as SavedSettings | null
      if (raw) {
        const normalized = { active: raw.active, providers: raw.providers ?? {} }
        memorySettings = normalized
        return normalized
      }
    } catch {
      /* fallback to memory */
    }
  }
  return memorySettings
}

async function saveSettings(env: Env, next: SavedSettings): Promise<void> {
  memorySettings = next
  let savedToDb = false
  if (env.HYPERDRIVE) {
    try {
      const enc = await sealText(env, JSON.stringify(next), AI_SETTINGS_AAD)
      await withDb(env, async (db) => {
        await db.query(
          `DELETE FROM public.chat_messages WHERE order_id = $1 AND author = $2`,
          [AI_SETTINGS_SENTINEL_ORDER_ID, AI_SETTINGS_SENTINEL_AUTHOR],
        )
        await db.query(
          `INSERT INTO public.chat_messages (order_id, author, body_enc, delete_after)
           VALUES ($1, $2, $3, NULL)`,
          [AI_SETTINGS_SENTINEL_ORDER_ID, AI_SETTINGS_SENTINEL_AUTHOR, enc],
        )
      })
      savedToDb = true
    } catch (err) {
      console.error('[settings] db save failed', err instanceof Error ? err.message : String(err))
    }
  }
  if (!savedToDb && env.AI_SETTINGS_KV) {
    try {
      await env.AI_SETTINGS_KV.put(KV_KEY, JSON.stringify(next))
      savedToDb = true
    } catch (err) {
      console.error('[settings] kv save failed', err instanceof Error ? err.message : String(err))
    }
  }
  if (!savedToDb && (env.HYPERDRIVE || env.AI_SETTINGS_KV)) {
    throw new Error('settings_storage_unavailable')
  }
}

function envProviders(env: Env): Record<ProviderId, Omit<ProviderConfig, 'source'>> {
  return {
    openrouter: {
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
    },
    groq: {
      label: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    },
    gemini: {
      label: 'Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    },
    custom: {
      label: env.CUSTOM_AI_LABEL ?? 'Custom',
      baseUrl: env.CUSTOM_AI_BASE_URL?.replace(/\/+$/, ''),
      apiKey: env.CUSTOM_AI_API_KEY,
      model: env.CUSTOM_AI_MODEL,
    },
  }
}

function resolveProviders(env: Env, saved: SavedSettings): Record<ProviderId, ProviderConfig> {
  const base = envProviders(env)
  const out = {} as Record<ProviderId, ProviderConfig>
  for (const id of PROVIDER_IDS) {
    const s = saved.providers[id]
    const b = base[id]
    const apiKey = s?.apiKey || b.apiKey
    out[id] = {
      label: (id === 'custom' ? s?.label : undefined) || b.label,
      baseUrl: (id === 'custom' ? s?.baseUrl?.replace(/\/+$/, '') : undefined) || b.baseUrl,
      apiKey,
      model: s?.model || b.model,
      source: s?.apiKey ? 'admin' : b.apiKey ? 'env' : 'none',
    }
  }
  return out
}

const isConfigured = (p: ProviderConfig) => !!p.apiKey && !!p.baseUrl && !!p.model

function configuredList(all: Record<ProviderId, ProviderConfig>): ProviderId[] {
  return PROVIDER_IDS.filter((id) => isConfigured(all[id]))
}

function defaultProvider(env: Env, saved: SavedSettings, all: Record<ProviderId, ProviderConfig>): ProviderId | undefined {
  const preferred = (saved.active ?? env.AI_PROVIDER) as ProviderId | undefined
  const list = configuredList(all)
  if (preferred && list.includes(preferred)) return preferred
  return list[0]
}

function adminHmacEnv(env: Env): Env {
  const secret = env.SESSION_SECRET?.trim() || env.ADMIN_SESSION_SECRET?.trim()
  return { ...env, SESSION_SECRET: secret }
}

const signInMessage = (nonceId: string, issuedAtIso: string, wallet?: `0x${string}` | null) =>
  [
    'OnPeer Admin Sign-In',
    'Domain: app.onpeer.xyz',
    ...(wallet ? [`Wallet: ${wallet}`] : []),
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonceId}`,
    `Issued At: ${issuedAtIso}`,
    'This signature proves you control an admin wallet. It costs no gas.',
  ].join('\n')

function randomHex32(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0')
  return out
}

async function checkIpRateLimit(
  env: Env,
  runWithDb: <T>(env: Env, fn: (db: Queryable) => Promise<T>) => Promise<T>,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  try {
    return await runWithDb(env, (db) => checkRateLimit(db, bucket, limit, windowSec))
  } catch (err) {
    // M-05: Fail closed when HYPERDRIVE is configured in production; only allow DB-less local dev
    if (!env.HYPERDRIVE && err instanceof DbUnavailableError) return true
    return false
  }
}

function validBaseUrl(value: string): string | null {
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    return value.replace(/\/+$/, '').slice(0, 300)
  } catch {
    return null
  }
}

async function statusPayload(env: Env) {
  const saved = await loadSettings(env)
  const all = resolveProviders(env, saved)
  return {
    active: defaultProvider(env, saved, all) ?? null,
    providers: PROVIDER_IDS.map((id) => ({
      id,
      label: all[id].label,
      model: all[id].model ?? null,
      baseUrl: id === 'custom' ? (all[id].baseUrl ?? null) : null,
      hasKey: !!all[id].apiKey,
      source: all[id].source,
      configured: isConfigured(all[id]),
      hasSavedSettings: !!saved.providers[id],
    })),
  }
}

type ChatMessage = {
  role: 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: unknown[]
  tool_call_id?: string
  name?: string
}

function sanitizeMessages(messages: unknown): ChatMessage[] | null {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 60) return null
  const out: ChatMessage[] = []
  for (const raw of messages as Record<string, unknown>[]) {
    const role = raw.role
    if (role !== 'user' && role !== 'assistant' && role !== 'tool') return null
    const content = typeof raw.content === 'string' ? raw.content.slice(0, 8_000) : null
    const msg: ChatMessage = { role, content }
    if (role === 'assistant' && Array.isArray(raw.tool_calls)) msg.tool_calls = raw.tool_calls.slice(0, 8)
    if (role === 'tool') {
      if (typeof raw.tool_call_id !== 'string') return null
      msg.tool_call_id = raw.tool_call_id.slice(0, 200)
      if (typeof raw.name === 'string') msg.name = raw.name.slice(0, 80)
    }
    out.push(msg)
  }
  return out
}

function contextLine(ctx: unknown): string {
  const c = (ctx ?? {}) as Record<string, unknown>
  const address = typeof c.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(c.address) ? c.address : null
  const route = ['home', 'p2p', 'swap', 'bridge', 'buy'].includes(String(c.route))
    ? String(c.route)
    : 'home'
  return `\n\nSession: wallet ${address ?? 'not connected'}; current page: ${route}; today: ${new Date().toISOString().slice(0, 10)}.`
}

export interface WorkerDependencies {
  runWithDb?: <T>(env: Env, fn: (db: Queryable) => Promise<T>) => Promise<T>
  makeChain?: (env: Env) => ChainReader
}

type ResolveAdminResult =
  | { ok: true; wallet: `0x${string}` }
  | { ok: false; status: 401 | 403 | 502 | 503; error: 'unauthorized' | 'not_admin' | 'rpc_error' | 'service_unavailable' }

async function resolveAdminWallet(
  req: Request,
  env: Env,
  chain: ChainReader,
  makeChainFn: (env: Env) => ChainReader,
  runWithDb: <T>(env: Env, fn: (db: Queryable) => Promise<T>) => Promise<T>,
): Promise<ResolveAdminResult> {
  const auth = req.headers.get('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!bearer || !/^[0-9a-f]{64}$/.test(bearer)) {
    return { ok: false, status: 401, error: 'unauthorized' }
  }

  // H-06: Enforce DB-backed revocable `public.sessions` tokens exclusively (no non-revocable stateless HMAC tokens)
  let sess: Awaited<ReturnType<typeof getSession>>
  try {
    sess = await runWithDb(env, (db) => getSession(req, db))
  } catch (err) {
    console.error('[admin/auth] db error', err instanceof Error ? err.message : String(err))
    return { ok: false, status: 503, error: 'service_unavailable' }
  }
  if (!sess) {
    console.error('[admin/auth] session missing or expired')
    return { ok: false, status: 401, error: 'unauthorized' }
  }

  let admin: Awaited<ReturnType<typeof checkAdminAccess>>
  try {
    admin = await checkAdminAccess(chain, sess.wallet)
  } catch (firstErr) {
    console.error('[admin/auth] rpc check failed, retrying once', firstErr instanceof Error ? firstErr.message : String(firstErr))
    try {
      admin = await checkAdminAccess(makeChainFn(env), sess.wallet)
    } catch (secondErr) {
      console.error('[admin/auth] rpc check retry failed', secondErr instanceof Error ? secondErr.message : String(secondErr))
      return { ok: false, status: 502, error: 'rpc_error' }
    }
  }
  if (!admin.allowed) {
    return { ok: false, status: 403, error: 'not_admin' }
  }
  return { ok: true, wallet: sess.wallet }
}

async function handleApi(
  req: Request,
  env: Env,
  _ctx: WorkerExecutionContext,
  path: string,
  deps?: WorkerDependencies,
): Promise<Response> {
  const runDb = deps?.runWithDb ?? withDb
  const makeChain = deps?.makeChain ?? createChainReader

  try {
    if (req.method === 'GET' && path === '/health') {
      const saved = await loadSettings(env)
      const all = resolveProviders(env, saved)
      const list = configuredList(all)
      return json(200, {
        configured: list.length > 0,
        active: defaultProvider(env, saved, all) ?? null,
        providers: list.map((id) => ({ id, label: all[id].label })),
      })
    }

    // ---- Phase 2 wallet-signature auth (/api/auth/*) ----
    if (path === '/auth' || path.startsWith('/auth/')) {
      const res = await runDb(env, (db) => handleAuthRoutes(req, env, db, path))
      return res ?? json(404, { error: 'not_found' })
    }

    // ---- Phase 2 P2P accounts & email double-opt-in (/api/account*, /api/email/*) ----
    if (path === '/account' || path.startsWith('/account/') || path.startsWith('/email/')) {
      const chain = req.method === 'DELETE' && path === '/account' ? makeChain(env) : undefined
      const res = await runDb(env, (db) => handleAccountRoutes(req, env, db, path, chain ? { chain } : undefined))
      return res ?? json(404, { error: 'not_found' })
    }

    // ---- Phase 2 Didit KYC & Webhook (/api/kyc/*) ----
    if (path.startsWith('/kyc/')) {
      const chain = makeChain(env)
      const res = await runDb(env, (db) => handleKycRoutes(req, env, _ctx, db, chain, path))
      return res ?? json(404, { error: 'not_found' })
    }

    // ---- Phase 2 Encrypted Vault & Evidence (/api/vault/*, /api/orders/:id/vault, /api/orders/:id/evidence*) ----
    if (
      path.startsWith('/vault/') ||
      /^\/orders\/\d+\/vault$/.test(path) ||
      /^\/orders\/\d+\/evidence(\/[0-9a-f-]{36})?$/i.test(path)
    ) {
      const chain = makeChain(env)
      const res = await runDb(env, (db) => handleVaultRoutes(req, env, db, chain, path))
      return res ?? json(404, { error: 'not_found' })
    }

    // ---- Phase 2 Encrypted Chat (/api/orders/:id/chat) ----
    if (/^\/orders\/\d+\/chat$/.test(path)) {
      const chain = makeChain(env)
      const res = await runDb(env, (db) => handleChatRoutes(req, env, db, chain, path))
      return res ?? json(404, { error: 'not_found' })
    }

    // ---- Phase 2 Dispute Filings (/api/orders/:id/disputes, /api/admin/disputes) ----
    if (/^\/orders\/\d+\/disputes$/.test(path) || path === '/admin/disputes') {
      const chain = makeChain(env)
      const res = await runDb(env, (db) => handleDisputeRoutes(req, env, db, chain, path))
      return res ?? json(404, { error: 'not_found' })
    }

    // ---- P2P Public Profiles, Follow/Block Relations & Post-Trade Feedback ----
    if (path.startsWith('/p2p/') || /^\/orders\/\d+\/feedback$/.test(path)) {
      const chain = makeChain(env)
      const res = await runDb(env, (db) => handleSocialRoutes(req, env, db, chain, path))
      return res ?? json(404, { error: 'not_found' })
    }

    // ---- Telegram Mini App & Live Order Notification Bot (/api/telegram/*) ----
    if (path.startsWith('/telegram/')) {
      const res = await runDb(env, (db) => handleTelegramRoutes(req, env, db, path))
      return res ?? json(404, { error: 'not_found' })
    }

    // ---- Phase 3 Circle Onramp Sandbox Session (/api/onramp/session) & Dev Preview Gate ----
    if (path === '/onramp/dev-unlock') {
      if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' })
      const ip = clientIp(req)
      const allowed = await checkIpRateLimit(env, runDb, `rl:onramp:dev:${ip}`, 10, 60)
      if (!allowed) return json(429, { error: 'rate_limited' })
      const expected = env.ONRAMP_DEV_PASS?.trim() ?? ''
      if (!expected) return json(503, { error: 'passcode_not_configured' })
      const body = await readJsonBody(req, 2_048)
      const candidate = typeof body?.passcode === 'string' ? body.passcode.trim() : ''
      if (!candidate) return json(401, { error: 'invalid_passcode' })
      const enc = new TextEncoder()
      const [aBuf, bBuf] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(candidate)),
        crypto.subtle.digest('SHA-256', enc.encode(expected)),
      ])
      const a = new Uint8Array(aBuf)
      const b = new Uint8Array(bBuf)
      let diff = 0
      for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
      if (diff !== 0) return json(401, { error: 'invalid_passcode' })
      return json(200, { ok: true })
    }

    // ---- Website-wide real browser presence heartbeat (/api/presence/ping & /api/presence) ----
    if (req.method === 'POST' && path === '/presence/ping') {
      const ok = await runDb(env, async (db) => {
        const session = await getSession(req, db)
        if (!session) return false
        await recordPresence(db, session.wallet)
        return true
      })
      if (!ok) return json(401, { error: 'unauthorized' })
      return json(200, { ok: true })
    }

    if (req.method === 'GET' && path === '/presence') {
      const raw = new URL(req.url).searchParams.get('wallets') ?? ''
      const wallets = raw
        .split(',')
        .map((w) => w.trim().toLowerCase())
        .filter((w) => /^0x[0-9a-f]{40}$/.test(w))
        .slice(0, 50)
      const online = await readPresenceMap(env, wallets)
      return json(200, { online })
    }

    // ---- Public extended Advertisers' Terms (up to 1,000 bytes, not encrypted) ----
    const adTermsMatch = path.match(/^\/ads\/(\d+)\/terms$/)
    if (adTermsMatch) {
      const adId = adTermsMatch[1]
      if (req.method === 'GET') {
        const terms = await getStoredAdTerms(env, adId)
        return json(200, { adId, terms })
      }
      if (req.method === 'POST') {
        const session = await runDb(env, (db) => getSession(req, db))
        if (!session) return json(401, { error: 'unauthorized' })
        const body = await readJsonBody(req, 4_096)
        const raw = typeof body?.terms === 'string' ? body.terms.trim() : ''
        const bytes = new TextEncoder().encode(raw).byteLength
        if (!raw || bytes > 1_000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(raw)) {
          return json(400, { error: 'invalid_terms' })
        }
        const chain = makeChain(env)
        const ad = await chain.getAd(BigInt(adId))
        if (!ad || ad.maker.toLowerCase() !== session.wallet.toLowerCase()) {
          return json(403, { error: 'forbidden' })
        }
        await setStoredAdTerms(env, adId, raw)
        return json(200, { ok: true, adId })
      }
      return json(405, { error: 'method_not_allowed' })
    }

    if (path === '/onramp/session' || path.startsWith('/onramp/')) {
      const res = await runDb(env, (db) => handleOnrampRoutes(req, env, db, path))
      return res ?? json(404, { error: 'not_found' })
    }

    // ---- Assistant chat (M-05: fail-closed IP rate limit + 32 KB request size cap) ----
    if (req.method === 'POST' && path === '/chat') {
      const ip = clientIp(req)
      const allowed = await checkIpRateLimit(env, runDb, `rl:ai:chat:${ip}`, 20, 60)
      if (!allowed) return json(429, { error: 'rate_limited' })

      const body = await readJsonBody(req, 32_768)
      if (!body) return json(400, { error: 'bad_request' })
      const messages = sanitizeMessages(body.messages)
      if (!messages) return json(400, { error: 'bad_messages' })

      const saved = await loadSettings(env)
      const all = resolveProviders(env, saved)
      const requested = typeof body.provider === 'string' ? (body.provider as ProviderId) : undefined
      const id = requested && configuredList(all).includes(requested) ? requested : defaultProvider(env, saved, all)
      if (!id) return json(503, { error: 'not_configured' })
      const cfg = all[id]

      try {
        const upstream = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            temperature: 0.1,
            messages: [{ role: 'system', content: SYSTEM_PROMPT + contextLine(body.context) }, ...messages],
            tools: TOOLS,
            tool_choice: 'auto',
          }),
          signal: AbortSignal.timeout(60_000),
        })
        if (!upstream.ok) {
          const s = upstream.status
          return json(502, {
            error: s === 401 || s === 403 ? 'provider_auth' : s === 429 ? 'provider_rate_limit' : 'provider_error',
          })
        }
        const data = (await upstream.json()) as { choices?: { message?: Record<string, unknown> }[] }
        const message = data.choices?.[0]?.message
        if (!message) return json(502, { error: 'provider_error' })
        return json(200, {
          provider: id,
          message: {
            role: 'assistant',
            content: typeof message.content === 'string' ? message.content : null,
            tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
          },
        })
      } catch (err) {
        const aborted = (err as { name?: string }).name === 'AbortError'
        return json(504, { error: aborted ? 'timeout' : 'provider_error' })
      }
    }

    // ---- Admin routes (H-06: domain/chain-bound challenge + revocable DB session) ----
    if (req.method === 'GET' && path === '/admin/nonce') {
      const ip = clientIp(req)
      const allowed = await checkIpRateLimit(env, runDb, `rl:admin:nonce:${ip}`, 20, 60)
      if (!allowed) return json(429, { error: 'rate_limited' })
      const reqUrl = new URL(req.url)
      const rawAddr = reqUrl.searchParams.get('address')
      const wallet = rawAddr !== null ? normalizeWallet(rawAddr) : null
      if (rawAddr !== null && !wallet) return json(400, { error: 'bad_request' })
      const nonceId = crypto.randomUUID()
      const issuedAtIso = new Date().toISOString()
      const nonce = await signHmacToken(adminHmacEnv(env), {
        kind: 'admin_nonce',
        r: nonceId,
        sub: wallet,
        iat: issuedAtIso,
        exp: Date.now() + NONCE_TTL,
      })
      return json(200, { nonce, message: signInMessage(nonceId, issuedAtIso, wallet) })
    }

    if (req.method === 'POST' && path === '/admin/login') {
      const ip = clientIp(req)
      const allowed = await checkIpRateLimit(env, runDb, `rl:admin:login:${ip}`, 15, 60)
      if (!allowed) return json(429, { error: 'rate_limited' })
      const body = await readJsonBody(req, 8_192)
      if (!body) return json(400, { error: 'bad_request' })
      const address = textField(body.address, 64)
      const signature = textField(body.signature, 600)
      const nonce = textField(body.nonce, 600)
      if (!address || !isAddress(address) || !signature || !nonce) return json(400, { error: 'bad_request' })
      const wallet = address.toLowerCase() as `0x${string}`
      const verifiedNonce = await verifyHmacToken(adminHmacEnv(env), nonce)
      if (
        !verifiedNonce ||
        verifiedNonce.kind !== 'admin_nonce' ||
        typeof verifiedNonce.r !== 'string' ||
        typeof verifiedNonce.iat !== 'string'
      ) {
        return json(401, { error: 'nonce_expired' })
      }
      if (verifiedNonce.sub !== null && verifiedNonce.sub !== undefined && verifiedNonce.sub !== wallet) {
        return json(401, { error: 'bad_signature' })
      }
      const boundWallet = typeof verifiedNonce.sub === 'string' ? (verifiedNonce.sub as `0x${string}`) : null
      const ok = await verifyMessage({
        address: wallet,
        message: signInMessage(verifiedNonce.r, verifiedNonce.iat, boundWallet),
        signature: signature as `0x${string}`,
      }).catch(() => false)
      if (!ok) return json(401, { error: 'bad_signature' })
      const chain = makeChain(env)
      let admin: Awaited<ReturnType<typeof checkAdminAccess>>
      try {
        admin = await checkAdminAccess(chain, wallet)
      } catch (firstErr) {
        console.error('[admin/login] rpc check failed, retrying once', firstErr instanceof Error ? firstErr.message : String(firstErr))
        try {
          admin = await checkAdminAccess(makeChain(env), wallet)
        } catch (secondErr) {
          console.error('[admin/login] rpc check retry failed', secondErr instanceof Error ? secondErr.message : String(secondErr))
          return json(502, { error: 'rpc_error' })
        }
      }
      if (!admin.allowed) return json(403, { error: 'not_admin' })

      const nonceTtlSec = Math.max(1, Math.ceil((Number(verifiedNonce.exp) - Date.now()) / 1000))
      const token = randomHex32()
      const tokenHash = await sha256Hex(token)
      const expiresSec = Math.min(SESSION_TTL_SECONDS, Math.floor(SESSION_TTL / 1000))
      const expiresAt = new Date(Date.now() + expiresSec * 1000).toISOString()

      const issued = await runDb(env, async (db) => {
        const res = await db.query(
          `INSERT INTO public.rate_limits (bucket, count, reset_at)
           VALUES ($1, 1, now() + make_interval(secs => $2))
           ON CONFLICT (bucket) DO NOTHING`,
          [`admin_nonce_used:${verifiedNonce.r}`, nonceTtlSec],
        )
        if ((res.rowCount ?? 0) === 0) return false
        await db.query(
          `INSERT INTO public.sessions (token_hash, wallet, expires_at)
           VALUES ($1, $2, $3::timestamptz)`,
          [tokenHash, wallet, expiresAt],
        )
        await writeAudit(db, wallet, 'admin.login', null)
        return true
      })
      if (!issued) return json(401, { error: 'nonce_expired' })

      return json(200, { token, wallet, expiresInSeconds: expiresSec, expiresAt })
    }

    if (path.startsWith('/admin/')) {
      const chain = makeChain(env)
      const adminAuth = await resolveAdminWallet(req, env, chain, makeChain, runDb)
      if (!adminAuth.ok) return json(adminAuth.status, { error: adminAuth.error })
      const adminWallet = adminAuth.wallet

      // M8: Scheduled job health & queue counters for Admin panel (with head - cursor lag + verifier gas balance)
      if (req.method === 'GET' && path === '/admin/health') {
        const rpc = createArcPublicClient(env)
        const [health, headBlock, verifierBalanceWei] = await Promise.all([
          runDb(env, async (db) => {
            const [cronRows, outboxRows, jobRows, cursorRows] = await Promise.all([
              db.query<{
                job_name: string
                last_run_at: string
                last_ok_at: string | null
                last_error: string | null
                last_error_at: string | null
              }>(`SELECT job_name, last_run_at, last_ok_at, last_error, last_error_at FROM public.cron_health ORDER BY job_name`),
              db.query<{ status: string; cnt: string | number }>(
                `SELECT status, count(*)::int AS cnt FROM public.notifications_outbox GROUP BY status`,
              ),
              db.query<{ status: string; cnt: string | number }>(
                `SELECT status, count(*)::int AS cnt FROM public.onchain_jobs GROUP BY status`,
              ),
              db.query<{ name: string; last_block: string; updated_at: string }>(
                `SELECT name, last_block::text AS last_block, updated_at FROM public.chain_cursor ORDER BY name`,
              ),
            ])
            return {
              jobs: cronRows.rows.map((r) => ({
                jobName: r.job_name,
                lastRunAt: r.last_run_at,
                lastOkAt: r.last_ok_at,
                lastError: r.last_error,
                lastErrorAt: r.last_error_at,
              })),
              outbox: Object.fromEntries(outboxRows.rows.map((r) => [r.status, Number(r.cnt)])),
              onchainJobs: Object.fromEntries(jobRows.rows.map((r) => [r.status, Number(r.cnt)])),
              cursors: cursorRows.rows,
            }
          }),
          rpc.getBlockNumber().catch(() => null),
          chain
            .getRoles()
            .then((r) => rpc.getBalance({ address: r.verifier }))
            .catch(() => null),
        ])
        const verifierBalanceUsdc =
          verifierBalanceWei !== null ? Number(formatEther(verifierBalanceWei)).toFixed(4) : null
        const verifierBalanceLow =
          verifierBalanceWei !== null && verifierBalanceWei < 1_000_000_000_000_000_000n // < 1.0 USDC
        return json(200, {
          ...health,
          headBlock: headBlock !== null ? headBlock.toString() : null,
          verifierBalanceUsdc,
          verifierBalanceLow,
          cursors: health.cursors.map((c) => {
            const lag = headBlock !== null ? headBlock - BigInt(c.last_block) : null
            return {
              ...c,
              lagBlocks: lag !== null ? Number(lag > 0n ? lag : 0n) : null,
            }
          }),
        })
      }

      if (req.method === 'GET' && path === '/admin/users') {
        const users = await runDb(env, async (db) => {
          const rows = await db.query<{
            wallet: string
            display_name: string | null
            country: string | null
            email_enc: string | null
            email_verified_at: string | Date | null
            email_opt_in: boolean
            telegram_linked_at: string | Date | null
            telegram_opt_in: boolean
            kyc_status: string
            kyc_level: number
            kyc_expires_at: string | Date | null
            kyc_name_enc: string | null
            created_at: string | Date
            deleted_at: string | Date | null
            disputes_filed: string | number
          }>(
            `SELECT a.wallet, a.display_name, a.country, a.email_enc, a.email_verified_at,
                    a.email_opt_in, a.telegram_linked_at, a.telegram_opt_in,
                    a.kyc_status, a.kyc_level, a.kyc_expires_at, a.kyc_name_enc,
                    a.created_at, a.deleted_at,
                    COALESCE(d.cnt, 0)::int AS disputes_filed
               FROM public.accounts a
               LEFT JOIN (
                 SELECT filed_by, count(*)::int AS cnt
                   FROM public.dispute_filings
                  GROUP BY filed_by
               ) d ON d.filed_by = a.wallet
              ORDER BY a.created_at DESC
              LIMIT 500`,
          )
          await writeAudit(db, adminWallet, 'admin.users.list', null)
          const toIso = (v: string | Date | null | undefined) =>
            !v ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString()

          return Promise.all(
            rows.rows.map(async (r) => {
              const wallet = r.wallet.toLowerCase() as `0x${string}`
              let kycLegalName: string | null = null
              if (r.kyc_name_enc) {
                try {
                  kycLegalName = await openText(env, r.kyc_name_enc, `account:kyc_name:${wallet}`)
                } catch {
                  kycLegalName = null
                }
              }
              let emailMasked: string | null = null
              if (r.email_enc) {
                try {
                  const plain = await openText(env, r.email_enc, `account:email:${wallet}`)
                  emailMasked = maskEmail(plain)
                } catch {
                  emailMasked = null
                }
              }
              return {
                wallet,
                displayName: r.display_name,
                kycLegalName,
                country: r.country,
                emailMasked,
                emailVerified: !!r.email_verified_at,
                emailOptIn: r.email_opt_in,
                telegramLinked: !!r.telegram_linked_at,
                telegramOptIn: r.telegram_opt_in,
                kycStatus: r.kyc_status,
                kycLevel: Number(r.kyc_level ?? 0),
                kycExpiresAt: toIso(r.kyc_expires_at),
                disputesFiled: Number(r.disputes_filed ?? 0),
                createdAt: toIso(r.created_at),
                deletedAt: toIso(r.deleted_at),
              }
            }),
          )
        })
        return json(200, { users })
      }

      if (req.method === 'GET' && path === '/admin/ai') return json(200, await statusPayload(env))

      if (req.method === 'POST' && path === '/admin/ai') {
        const body = await readJsonBody(req)
        if (!body) return json(400, { error: 'bad_request' })
        const id = body.provider as ProviderId
        if (!PROVIDER_IDS.includes(id)) return json(400, { error: 'bad_provider' })
        const settings = await loadSettings(env)
        const current = { ...(settings.providers[id] ?? {}) }
        const apiKey = textField(body.apiKey, 600)
        const model = textField(body.model, 160)
        if (apiKey) current.apiKey = apiKey
        if (model !== undefined) current.model = model || undefined
        if (id === 'custom') {
          const baseUrl = textField(body.baseUrl, 300)
          if (baseUrl) {
            const ok = validBaseUrl(baseUrl)
            if (!ok) return json(400, { error: 'bad_base_url' })
            current.baseUrl = ok
          }
          const label = textField(body.label, 40)
          if (label !== undefined) current.label = label || undefined
        }
        settings.providers[id] = current
        if (body.makeActive === true) settings.active = id
        await saveSettings(env, settings)
        return json(200, await statusPayload(env))
      }

      if (req.method === 'POST' && path === '/admin/ai/active') {
        const body = await readJsonBody(req)
        if (!body) return json(400, { error: 'bad_request' })
        const id = body.provider as ProviderId
        if (!PROVIDER_IDS.includes(id)) return json(400, { error: 'bad_provider' })
        const settings = await loadSettings(env)
        settings.active = id
        await saveSettings(env, settings)
        return json(200, await statusPayload(env))
      }

      if (req.method === 'POST' && path === '/admin/ai/clear') {
        const body = await readJsonBody(req)
        if (!body) return json(400, { error: 'bad_request' })
        const id = body.provider as ProviderId
        if (!PROVIDER_IDS.includes(id)) return json(400, { error: 'bad_provider' })
        const settings = await loadSettings(env)
        delete settings.providers[id]
        if (settings.active === id) delete settings.active
        await saveSettings(env, settings)
        return json(200, await statusPayload(env))
      }

      if (req.method === 'POST' && path === '/admin/ai/test') {
        const body = await readJsonBody(req)
        if (!body) return json(400, { error: 'bad_request' })
        const id = body.provider as ProviderId
        if (!PROVIDER_IDS.includes(id)) return json(400, { error: 'bad_provider' })
        const saved = await loadSettings(env)
        const cfg = resolveProviders(env, saved)[id]
        if (!isConfigured(cfg)) return json(200, { ok: false, reason: 'not_configured' })
        const started = Date.now()
        try {
          const upstream = await fetch(`${cfg.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({
              model: cfg.model,
              max_tokens: 8,
              temperature: 0,
              messages: [{ role: 'user', content: 'Reply with OK' }],
            }),
            signal: AbortSignal.timeout(20_000),
          })
          const ms = Date.now() - started
          if (upstream.ok) return json(200, { ok: true, ms })
          let detail = `HTTP ${upstream.status}`
          try {
            const rawErr = await upstream.text()
            if (rawErr) {
              const parsed = JSON.parse(rawErr) as { error?: { message?: string } | string; message?: string }
              const msg =
                typeof parsed?.error === 'string'
                  ? parsed.error
                  : typeof parsed?.error?.message === 'string'
                    ? parsed.error.message
                    : typeof parsed?.message === 'string'
                      ? parsed.message
                      : rawErr
              if (msg.trim()) detail = `HTTP ${upstream.status}: ${msg.trim().slice(0, 160)}`
            }
          } catch {
            /* keep status code */
          }
          const reason =
            upstream.status === 401 || upstream.status === 403
              ? 'auth'
              : upstream.status === 404
                ? 'model_or_url'
                : upstream.status === 429
                  ? 'rate_limit'
                  : 'provider_error'
          return json(200, { ok: false, reason, status: upstream.status, detail, ms })
        } catch (err) {
          const aborted = (err as { name?: string }).name === 'AbortError'
          return json(200, { ok: false, reason: aborted ? 'timeout' : 'unreachable' })
        }
      }
    }

    // ---- Admin 1-click Telegram Bot Webhook + Menu Button Setup (/api/admin/telegram/setup) ----
    if (req.method === 'POST' && path === '/admin/telegram/setup') {
      const chain = makeChain(env)
      const adminAuth = await resolveAdminWallet(req, env, chain, makeChain, runDb)
      if (!adminAuth.ok) return json(adminAuth.status, { error: adminAuth.error })
      const result = await setupTelegramBotWebhook(env, new URL(req.url))
      if (!result.ok) {
        return json(result.error === 'telegram_not_configured' ? 503 : 502, { error: result.error })
      }
      return json(200, result)
    }

    return json(404, { error: 'not_found' })
  } catch (err) {
    if (err instanceof AuthConfigError || err instanceof DbUnavailableError || err instanceof VaultConfigError) {
      return json(503, { error: 'service_unavailable' })
    }
    if (err instanceof CryptoTamperError) {
      return json(400, { error: 'invalid_ciphertext' })
    }
    console.error('[api] unhandled error', path, err instanceof Error ? err.message : String(err))
    return json(500, { error: 'server_error' })
  }
}

const APP_PATHS = ['/p2p', '/swap', '/bridge', '/buy', '/cashout', '/admin', '/assistant']

const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

function resolveHttpsOrigin(raw: string | undefined, fallback: string): string {
  try {
    if (!raw) return fallback
    const u = new URL(raw.trim())
    return u.protocol === 'https:' ? u.origin : fallback
  } catch {
    return fallback
  }
}

export function buildAppCsp(env: Env): string {
  const widgetOrigin = resolveHttpsOrigin(env.ONRAMP_WIDGET_BASE_URL, SANDBOX_WIDGET_BASE_URL)
  const apiOrigin = resolveHttpsOrigin(env.ONRAMP_API_BASE_URL, SANDBOX_API_BASE_URL)
  return `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; worker-src 'self' blob:; connect-src 'self' ${widgetOrigin} ${apiOrigin} https: wss:; frame-src https://verify.walletconnect.org https://verify.walletconnect.com ${widgetOrigin}; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; object-src 'none'; base-uri 'self'; form-action 'self'`
}

function withSecurityHeaders(res: Response, isApi: boolean, env: Env): Response {
  const headers = new Headers(res.headers)
  headers.set('Content-Security-Policy', isApi ? API_CSP : buildAppCsp(env))
  headers.set('X-Content-Type-Options', 'nosniff')
  if (isApi) {
    headers.set('X-Frame-Options', 'DENY')
  }
  headers.set('Referrer-Policy', 'no-referrer')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

function resolveRequestEnv(url: URL, env: Env): Env {
  if (url.hostname.toLowerCase().startsWith('testnet.')) {
    return {
      ...env,
      ARC_NETWORK: 'testnet',
      VITE_ARC_NETWORK: 'testnet',
      VITE_P2P_ESCROW_ADDRESS: '0x7f661625bC08d72E156A206ee8D24022D7463350',
      VITE_P2P_DEPLOY_BLOCK: '74250625',
      VITE_P2P_EURC_ESCROW_ADDRESS: '0x26Ef2B69AC928457E348BeEd72Bf116dB81438B9',
      VITE_P2P_EURC_DEPLOY_BLOCK: '74250630',
      PUBLIC_APP_URL: `https://${url.hostname}`,
    }
  }
  return env
}

export function createWorkerApp(deps?: WorkerDependencies) {
  return {
    async fetch(
      request: Request,
      rawEnv: Env,
      ctx: WorkerExecutionContext = { waitUntil: () => undefined },
    ): Promise<Response> {
      const url = new URL(request.url)
      const env = resolveRequestEnv(url, rawEnv)

      // Never redirect /api on app.onpeer.xyz, onpeer.xyz, or any host
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        const res = await handleApi(request, env, ctx, url.pathname.slice(4) || '/', deps)
        return withSecurityHeaders(res, true, env)
      }

      // Redirect www.onpeer.xyz canonical traffic to apex onpeer.xyz (except /api/* handled above)
      if (url.hostname === 'www.onpeer.xyz') {
        const dest =
          url.pathname === '/docs' || url.pathname.startsWith('/docs/')
            ? `https://docs.onpeer.xyz${url.pathname.slice('/docs'.length) || '/'}${url.search}`
            : APP_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`)) ||
                url.searchParams.has('order')
              ? `https://app.onpeer.xyz${url.pathname}${url.search}`
              : `https://onpeer.xyz${url.pathname}${url.search}`
        return withSecurityHeaders(Response.redirect(dest, 301), false, env)
      }

      // Redirect /docs from landing or app domain to dedicated docs.onpeer.xyz subdomain
      if (
        (url.hostname === 'onpeer.xyz' || url.hostname === 'app.onpeer.xyz') &&
        (url.pathname === '/docs' || url.pathname.startsWith('/docs/'))
      ) {
        const subPath = url.pathname.slice('/docs'.length) || '/'
        return withSecurityHeaders(
          Response.redirect(`https://docs.onpeer.xyz${subPath}${url.search}`, 302),
          false,
          env,
        )
      }

      // Redirect app routes from landing domain to app.onpeer.xyz (keep /privacy public on both)
      if (
        url.hostname === 'onpeer.xyz' &&
        (APP_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`)) ||
          url.searchParams.has('order'))
      ) {
        return withSecurityHeaders(
          Response.redirect(`https://app.onpeer.xyz${url.pathname}${url.search}`, 302),
          false,
          env,
        )
      }

      // Serve SEO & GEO discovery files (/robots.txt, /sitemap.xml, /llms.txt, /llms-full.txt)
      if (request.method === 'GET' || request.method === 'HEAD') {
        const seoFileRes = handleSeoFileRequest(url)
        if (seoFileRes) {
          return withSecurityHeaders(seoFileRes, false, env)
        }
      }

      const assetRes = await env.ASSETS.fetch(request)
      const enrichedRes = await injectSeoIntoHtmlResponse(assetRes, url)
      return withSecurityHeaders(enrichedRes, false, env)
    },

    async scheduled(
      _controller: ScheduledControllerLike,
      env: Env,
      ctx: WorkerExecutionContext,
    ): Promise<void> {
      const runDb = deps?.runWithDb ?? withDb
      const makeChain = deps?.makeChain ?? createChainReader
      ctx.waitUntil(
        runDb(env, async (db) => {
          const chain = makeChain(env)
          try {
            await processOnchainJobsBatch(env, db, chain)
            await recordCronHealth(db, 'onchain_jobs', null)
          } catch {
            await recordCronHealth(db, 'onchain_jobs', 'onchain_jobs_err')
          }
          try {
            await scanChainEvents(env, db, chain)
            await recordCronHealth(db, 'chain_scanner', null)
          } catch {
            await recordCronHealth(db, 'chain_scanner', 'chain_scanner_err')
          }
          try {
            await processNotificationsOutbox(env, db, chain)
            await recordCronHealth(db, 'notifications_outbox', null)
          } catch {
            await recordCronHealth(db, 'notifications_outbox', 'outbox_err')
          }
          await runAllCronJobs(db)
        }).catch(() => {
          console.error('cron_job_err', 'db_connect_failed')
        }),
      )
    },
  }
}

export default createWorkerApp()
