import { createPublicClient, http, isAddress, verifyMessage, type Address } from 'viem'
import { p2pEscrowAbi } from '../src/abi/p2pEscrow'
import { requireChain } from '../src/onchain-facts'
import { SYSTEM_PROMPT, TOOLS } from '../server/agent'
import type { ProviderId, SavedSettings } from '../server/settings'

const PROVIDER_IDS: ProviderId[] = ['openrouter', 'groq', 'gemini', 'custom']

interface KVStore {
  get(key: string, type: 'json'): Promise<unknown>
  put(key: string, value: string): Promise<void>
}

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> }
  AI_SETTINGS_KV?: KVStore
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
  VITE_P2P_ESCROW_ADDRESS?: string
  ADMIN_SESSION_SECRET?: string
}

type ProviderConfig = {
  label: string
  baseUrl: string | undefined
  apiKey: string | undefined
  model: string | undefined
  source: 'admin' | 'env' | 'none'
}

const CHAIN_ID = 5042002
const NONCE_TTL = 5 * 60_000
const SESSION_TTL = 30 * 60_000
const KV_KEY = 'ai-settings'

// Isolate-local fallback when AI_SETTINGS_KV is not bound yet.
let memorySettings: SavedSettings = { providers: {} }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)

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

// ---- Stateless HMAC-signed nonces & sessions (works across all Cloudflare edge isolates) ----
async function hmacKey(env: Env): Promise<CryptoKey> {
  const secret = env.ADMIN_SESSION_SECRET || env.VITE_P2P_ESCROW_ADDRESS || 'onpeer-worker-session-key'
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

async function signToken(env: Env, payload: string): Promise<string> {
  const key = await hmacKey(env)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return `${btoa(payload)}.${toHex(sig)}`
}

async function verifySignedToken(env: Env, token: string): Promise<Record<string, unknown> | null> {
  try {
    const [b64, sigHex] = token.split('.')
    if (!b64 || !sigHex || sigHex.length % 2 !== 0) return null
    const payload = atob(b64)
    const sig = new Uint8Array(sigHex.length / 2)
    for (let i = 0; i < sig.length; i++) sig[i] = Number.parseInt(sigHex.slice(i * 2, i * 2 + 2), 16)
    const key = await hmacKey(env)
    const ok = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(payload))
    if (!ok) return null
    const parsed = JSON.parse(payload) as Record<string, unknown>
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

const signInMessage = (nonce: string) =>
  `OnPeer admin sign-in\nThis proves you control an admin wallet. It costs no gas.\nNonce: ${nonce}`

async function isAdminWallet(env: Env, address: Address): Promise<boolean> {
  const escrow = env.VITE_P2P_ESCROW_ADDRESS
  if (!escrow || !isAddress(escrow)) return false
  const client = createPublicClient({ transport: http(requireChain(CHAIN_ID).rpcUrls[0]) })
  const [owner, arbiter] = await Promise.all([
    client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'owner' }),
    client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'arbiter' }),
  ])
  const a = address.toLowerCase()
  return a === owner.toLowerCase() || a === arbiter.toLowerCase()
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
  const route = ['home', 'p2p', 'swap', 'bridge'].includes(String(c.route)) ? String(c.route) : 'home'
  return `\n\nSession: wallet ${address ?? 'not connected'}; current page: ${route}; today: ${new Date().toISOString().slice(0, 10)}.`
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const raw = await req.text()
    if (raw.length > 200_000) return null
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return null
}

async function handleApi(req: Request, env: Env, path: string): Promise<Response> {
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

  if (req.method === 'POST' && path === '/chat') {
    const body = await readJsonBody(req)
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
        return json(502, { error: s === 401 || s === 403 ? 'provider_auth' : s === 429 ? 'provider_rate_limit' : 'provider_error' })
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

  // ---- Admin routes ----
  if (req.method === 'GET' && path === '/admin/nonce') {
    const nonce = await signToken(env, JSON.stringify({ kind: 'nonce', r: crypto.randomUUID(), exp: Date.now() + NONCE_TTL }))
    return json(200, { nonce, message: signInMessage(nonce) })
  }

  if (req.method === 'POST' && path === '/admin/login') {
    const body = await readJsonBody(req)
    if (!body) return json(400, { error: 'bad_request' })
    const address = text(body.address, 64)
    const signature = text(body.signature, 400)
    const nonce = text(body.nonce, 256)
    if (!address || !isAddress(address) || !signature || !nonce) return json(400, { error: 'bad_request' })
    const verifiedNonce = await verifySignedToken(env, nonce)
    if (!verifiedNonce || verifiedNonce.kind !== 'nonce') return json(401, { error: 'nonce_expired' })
    const ok = await verifyMessage({ address, message: signInMessage(nonce), signature: signature as `0x${string}` }).catch(() => false)
    if (!ok) return json(401, { error: 'bad_signature' })
    if (!(await isAdminWallet(env, address))) return json(403, { error: 'not_admin' })
    const token = await signToken(env, JSON.stringify({ kind: 'session', sub: address.toLowerCase(), exp: Date.now() + SESSION_TTL }))
    return json(200, { token, expiresInSeconds: SESSION_TTL / 1000 })
  }

  if (path.startsWith('/admin/')) {
    const auth = req.headers.get('authorization') ?? ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const sess = bearer ? await verifySignedToken(env, bearer) : null
    if (!sess || sess.kind !== 'session') return json(401, { error: 'unauthorized' })

    if (req.method === 'GET' && path === '/admin/ai') return json(200, await statusPayload(env))

    if (req.method === 'POST' && path === '/admin/ai') {
      const body = await readJsonBody(req)
      if (!body) return json(400, { error: 'bad_request' })
      const id = body.provider as ProviderId
      if (!PROVIDER_IDS.includes(id)) return json(400, { error: 'bad_provider' })
      const settings = await loadSettings(env)
      const current = { ...(settings.providers[id] ?? {}) }
      const apiKey = text(body.apiKey, 600)
      const model = text(body.model, 160)
      if (apiKey) current.apiKey = apiKey
      if (model !== undefined) current.model = model || undefined
      if (id === 'custom') {
        const baseUrl = text(body.baseUrl, 300)
        if (baseUrl) {
          const ok = validBaseUrl(baseUrl)
          if (!ok) return json(400, { error: 'bad_base_url' })
          current.baseUrl = ok
        }
        const label = text(body.label, 40)
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
          body: JSON.stringify({ model: cfg.model, max_tokens: 8, temperature: 0, messages: [{ role: 'user', content: 'Reply with OK' }] }),
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
}

const APP_PATHS = ['/p2p', '/swap', '/bridge', '/admin', '/assistant']

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url.pathname.slice(4))
    }
    if (
      (url.hostname === 'onpeer.xyz' || url.hostname === 'www.onpeer.xyz') &&
      (APP_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`)) ||
        url.searchParams.has('order'))
    ) {
      return Response.redirect(`https://app.onpeer.xyz${url.pathname}${url.search}`, 302)
    }
    return env.ASSETS.fetch(request)
  },
}
