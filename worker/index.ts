import { formatEther, isAddress, verifyMessage } from 'viem'
import { SYSTEM_PROMPT, TOOLS } from '../server/agent'
import type { ProviderId, SavedSettings } from '../server/settings'
import {
  AuthConfigError,
  getSession,
  handleAuthRoutes,
  signHmacToken,
  verifyHmacToken,
} from './auth'
import { handleAccountRoutes } from './accounts'
import { checkAdminAccess, createArcPublicClient, createChainReader, type ChainReader } from './chain'
import { CryptoTamperError, VaultConfigError } from './crypto'
import { DbUnavailableError, withDb, type Queryable } from './db'
import { handleKycRoutes, processOnchainJobsBatch } from './kyc'
import { handleChatRoutes } from './chat'
import { handleVaultRoutes } from './vault'
import { handleDisputeRoutes } from './disputes'
import { handleSocialRoutes } from './social'
import { handleOnrampRoutes, SANDBOX_API_BASE_URL, SANDBOX_WIDGET_BASE_URL } from './onramp'
import { handleSeoFileRequest, injectSeoIntoHtmlResponse } from './seo'
import { processNotificationsOutbox } from './notify'
import { recordCronHealth, runAllCronJobs, scanChainEvents } from './cron'
import { checkRateLimit } from './db'
import {
  clientIp,
  json,
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

async function loadSettings(env: Env): Promise<SavedSettings> {
  if (!env.AI_SETTINGS_KV) return memorySettings
  try {
    const raw = (await env.AI_SETTINGS_KV.get(KV_KEY, 'json')) as SavedSettings | null
    return raw ? { active: raw.active, providers: raw.providers ?? {} } : { providers: {} }
  } catch {
    return { providers: {} }
  }
}

async function saveSettings(env: Env, next: SavedSettings): Promise<void> {
  memorySettings = next
  if (env.AI_SETTINGS_KV) {
    await env.AI_SETTINGS_KV.put(KV_KEY, JSON.stringify(next))
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

const signInMessage = (nonce: string) =>
  `OnPeer admin sign-in\nThis proves you control an admin wallet. It costs no gas.\nNonce: ${nonce}`

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

async function resolveAdminWallet(
  req: Request,
  env: Env,
  chain: ChainReader,
  runWithDb: <T>(env: Env, fn: (db: Queryable) => Promise<T>) => Promise<T>,
): Promise<`0x${string}` | null> {
  const auth = req.headers.get('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!bearer) return null

  // 1. Prefer 12h Postgres-backed opaque session token when 64-hex
  if (/^[0-9a-f]{64}$/.test(bearer)) {
    try {
      const sess = await runWithDb(env, (db) => getSession(req, db))
      if (sess) {
        const admin = await checkAdminAccess(chain, sess.wallet)
        return admin.allowed ? sess.wallet : null
      }
    } catch {
      /* fall through to HMAC admin token if DB is not needed for AI KV */
    }
  }

  // 2. Legacy /admin/login HMAC token signed strictly with SESSION_SECRET or ADMIN_SESSION_SECRET
  const verified = await verifyHmacToken(adminHmacEnv(env), bearer)
  if (!verified || verified.kind !== 'admin_session' || typeof verified.sub !== 'string' || !isAddress(verified.sub)) {
    return null
  }
  const wallet = verified.sub.toLowerCase() as `0x${string}`
  const admin = await checkAdminAccess(chain, wallet)
  return admin.allowed ? wallet : null
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

    // ---- Phase 3 Circle Onramp Sandbox Session (/api/onramp/session) ----
    if (path === '/onramp/session' || path.startsWith('/onramp/')) {
      const res = await runDb(env, (db) => handleOnrampRoutes(req, env, db, path))
      return res ?? json(404, { error: 'not_found' })
    }

    // ---- Assistant chat (M5: IP rate limit + 32 KB request size cap) ----
    if (req.method === 'POST' && path === '/chat') {
      const ip = clientIp(req)
      const allowed = await runDb(env, (db) => checkRateLimit(db, `rl:ai:chat:${ip}`, 20, 60)).catch(() => true)
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

    // ---- Admin routes (L5: single-use nonce consumed in DB) ----
    if (req.method === 'GET' && path === '/admin/nonce') {
      const ip = clientIp(req)
      const allowed = await runDb(env, (db) => checkRateLimit(db, `rl:admin:nonce:${ip}`, 20, 60)).catch(() => true)
      if (!allowed) return json(429, { error: 'rate_limited' })
      const nonce = await signHmacToken(adminHmacEnv(env), {
        kind: 'admin_nonce',
        r: crypto.randomUUID(),
        exp: Date.now() + NONCE_TTL,
      })
      return json(200, { nonce, message: signInMessage(nonce) })
    }

    if (req.method === 'POST' && path === '/admin/login') {
      const ip = clientIp(req)
      const allowed = await runDb(env, (db) => checkRateLimit(db, `rl:admin:login:${ip}`, 15, 60)).catch(() => true)
      if (!allowed) return json(429, { error: 'rate_limited' })
      const body = await readJsonBody(req, 8_192)
      if (!body) return json(400, { error: 'bad_request' })
      const address = textField(body.address, 64)
      const signature = textField(body.signature, 400)
      const nonce = textField(body.nonce, 512)
      if (!address || !isAddress(address) || !signature || !nonce) return json(400, { error: 'bad_request' })
      const verifiedNonce = await verifyHmacToken(adminHmacEnv(env), nonce)
      if (!verifiedNonce || verifiedNonce.kind !== 'admin_nonce' || typeof verifiedNonce.r !== 'string') {
        return json(401, { error: 'nonce_expired' })
      }
      const ok = await verifyMessage({
        address,
        message: signInMessage(nonce),
        signature: signature as `0x${string}`,
      }).catch(() => false)
      if (!ok) return json(401, { error: 'bad_signature' })
      const chain = makeChain(env)
      const admin = await checkAdminAccess(chain, address.toLowerCase() as `0x${string}`)
      if (!admin.allowed) return json(403, { error: 'not_admin' })

      // L5: Consume admin nonce atomically in DB so it cannot be replayed
      const nonceTtlSec = Math.max(1, Math.ceil((Number(verifiedNonce.exp) - Date.now()) / 1000))
      const consumed = await runDb(env, async (db) => {
        const res = await db.query(
          `INSERT INTO public.rate_limits (bucket, count, reset_at)
           VALUES ($1, 1, now() + make_interval(secs => $2))
           ON CONFLICT (bucket) DO NOTHING`,
          [`admin_nonce_used:${verifiedNonce.r}`, nonceTtlSec],
        )
        return (res.rowCount ?? 0) > 0
      })
      if (!consumed) return json(401, { error: 'nonce_expired' })

      const token = await signHmacToken(adminHmacEnv(env), {
        kind: 'admin_session',
        sub: address.toLowerCase(),
        exp: Date.now() + SESSION_TTL,
      })
      return json(200, { token, expiresInSeconds: SESSION_TTL / 1000 })
    }

    if (path.startsWith('/admin/')) {
      const chain = makeChain(env)
      const adminWallet = await resolveAdminWallet(req, env, chain, runDb)
      if (!adminWallet) return json(401, { error: 'unauthorized' })

      // M8: Scheduled job health & queue counters for Admin panel (with head - cursor lag + verifier gas balance)
      if (req.method === 'GET' && path === '/admin/health') {
        const rpc = createArcPublicClient()
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
          const reason =
            upstream.status === 401 || upstream.status === 403
              ? 'auth'
              : upstream.status === 404
                ? 'model_or_url'
                : upstream.status === 429
                  ? 'rate_limit'
                  : 'provider_error'
          return json(200, { ok: false, reason, status: upstream.status, ms })
        } catch (err) {
          const aborted = (err as { name?: string }).name === 'AbortError'
          return json(200, { ok: false, reason: aborted ? 'timeout' : 'unreachable' })
        }
      }
    }

    return json(404, { error: 'not_found' })
  } catch (err) {
    if (err instanceof AuthConfigError || err instanceof DbUnavailableError || err instanceof VaultConfigError) {
      return json(503, { error: 'service_unavailable' })
    }
    if (err instanceof CryptoTamperError) {
      return json(400, { error: 'invalid_ciphertext' })
    }
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
  return `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' ${widgetOrigin} ${apiOrigin} https: wss:; frame-src https://verify.walletconnect.org https://verify.walletconnect.com ${widgetOrigin}; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`
}

function withSecurityHeaders(res: Response, isApi: boolean, env: Env): Response {
  const headers = new Headers(res.headers)
  headers.set('Content-Security-Policy', isApi ? API_CSP : buildAppCsp(env))
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'no-referrer')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

export function createWorkerApp(deps?: WorkerDependencies) {
  return {
    async fetch(
      request: Request,
      env: Env,
      ctx: WorkerExecutionContext = { waitUntil: () => undefined },
    ): Promise<Response> {
      const url = new URL(request.url)

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
