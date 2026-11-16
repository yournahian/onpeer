/**
 * Admin API for the assistant's AI provider settings.
 *
 * Sign-in is a wallet signature, not a password: the browser signs a one-time message, and the server accepts
 * the session only if the signer is the escrow contract's owner or arbiter (read from the chain). Keys are
 * write-only: nothing here ever sends a saved key back to the browser.
 */
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createPublicClient, http, isAddress, verifyMessage, type Address } from 'viem'
import { p2pEscrowAbi } from '../src/abi/p2pEscrow'
import { requireChain } from '../src/onchain-facts'
import { PROVIDER_IDS, loadSettings, saveSettings, type ProviderId, type SavedSettings } from './settings'
import { defaultProvider, postJson, providers, readBody, send } from './index'

const CHAIN_ID = 5042002
const NONCE_TTL = 5 * 60_000
const SESSION_TTL = 30 * 60_000

const nonces = new Map<string, number>()
const sessions = new Map<string, { address: string; expires: number }>()
const attempts = new Map<string, number[]>()

const signInMessage = (nonce: string) => `OnPeer admin sign-in\nThis proves you control an admin wallet. It costs no gas.\nNonce: ${nonce}`

function throttled(ip: string): boolean {
  const now = Date.now()
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000)
  recent.push(now)
  attempts.set(ip, recent)
  return recent.length > 20
}

function sweep() {
  const now = Date.now()
  for (const [k, v] of nonces) if (v < now) nonces.delete(k)
  for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k)
}

async function isAdminWallet(address: Address): Promise<boolean> {
  const escrow = process.env.VITE_P2P_ESCROW_ADDRESS
  if (!escrow || !isAddress(escrow)) return false
  const client = createPublicClient({ transport: http(requireChain(CHAIN_ID).rpcUrls[0]) })
  const [owner, arbiter] = await Promise.all([
    client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'owner' }),
    client.readContract({ address: escrow, abi: p2pEscrowAbi, functionName: 'arbiter' }),
  ])
  const a = address.toLowerCase()
  return a === owner.toLowerCase() || a === arbiter.toLowerCase()
}

function sessionFor(req: IncomingMessage): { address: string } | null {
  sweep()
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const s = token ? sessions.get(token) : undefined
  return s && s.expires > Date.now() ? s : null
}

function validBaseUrl(value: string): string | null {
  try {
    const u = new URL(value)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
    if (u.username || u.password) return null
    return value.replace(/\/+$/, '').slice(0, 300)
  } catch {
    return null
  }
}

function statusPayload() {
  const all = providers()
  const saved = loadSettings()
  return {
    active: defaultProvider() ?? null,
    providers: PROVIDER_IDS.map((id) => ({
      id,
      label: all[id].label,
      model: all[id].model ?? null,
      baseUrl: id === 'custom' ? (all[id].baseUrl ?? null) : null,
      hasKey: !!all[id].apiKey,
      source: all[id].source,
      configured: !!all[id].apiKey && !!all[id].baseUrl && !!all[id].model,
      hasSavedSettings: !!saved.providers[id],
    })),
  }
}

async function readJson(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
  try {
    const body = await readBody(req)
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch {
    /* fall through */
  }
  send(res, 400, { error: 'bad_request' })
  return null
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)

/** Returns a handler that answers /admin/* requests and reports whether it did. */
export function createAdminHandler() {
  return (req: IncomingMessage, res: ServerResponse, url: string): boolean => {
    if (!url.startsWith('/admin/')) return false
    const ip = req.socket.remoteAddress ?? 'unknown'
    if (throttled(ip)) {
      send(res, 429, { error: 'rate_limited' })
      return true
    }
    void route(req, res, url.split('?')[0])
    return true
  }
}

async function route(req: IncomingMessage, res: ServerResponse, path: string) {
  try {
    if (req.method === 'GET' && path === '/admin/nonce') {
      sweep()
      const nonce = randomBytes(16).toString('hex')
      nonces.set(nonce, Date.now() + NONCE_TTL)
      return send(res, 200, { nonce, message: signInMessage(nonce) })
    }

    if (req.method === 'POST' && path === '/admin/login') {
      const body = await readJson(req, res)
      if (!body) return
      const address = text(body.address, 64)
      const signature = text(body.signature, 400)
      const nonce = text(body.nonce, 64)
      if (!address || !isAddress(address) || !signature || !nonce) return send(res, 400, { error: 'bad_request' })
      const expires = nonces.get(nonce)
      if (!expires || expires < Date.now()) return send(res, 401, { error: 'nonce_expired' })
      nonces.delete(nonce) // single use
      const ok = await verifyMessage({ address, message: signInMessage(nonce), signature: signature as `0x${string}` }).catch(() => false)
      if (!ok) return send(res, 401, { error: 'bad_signature' })
      if (!(await isAdminWallet(address))) return send(res, 403, { error: 'not_admin' })
      const token = randomBytes(32).toString('hex')
      sessions.set(token, { address: address.toLowerCase(), expires: Date.now() + SESSION_TTL })
      return send(res, 200, { token, expiresInSeconds: SESSION_TTL / 1000 })
    }

    // everything below needs a signed-in admin
    if (!sessionFor(req)) return send(res, 401, { error: 'unauthorized' })

    if (req.method === 'GET' && path === '/admin/ai') return send(res, 200, statusPayload())

    if (req.method === 'POST' && path === '/admin/ai') {
      const body = await readJson(req, res)
      if (!body) return
      const id = body.provider as ProviderId
      if (!PROVIDER_IDS.includes(id)) return send(res, 400, { error: 'bad_provider' })
      const settings: SavedSettings = loadSettings()
      const current = { ...(settings.providers[id] ?? {}) }
      const apiKey = text(body.apiKey, 600)
      const model = text(body.model, 160)
      if (apiKey) current.apiKey = apiKey
      if (model !== undefined) current.model = model || undefined
      if (id === 'custom') {
        const baseUrl = text(body.baseUrl, 300)
        if (baseUrl) {
          const ok = validBaseUrl(baseUrl)
          if (!ok) return send(res, 400, { error: 'bad_base_url' })
          current.baseUrl = ok
        }
        const label = text(body.label, 40)
        if (label !== undefined) current.label = label || undefined
      }
      settings.providers[id] = current
      if (body.makeActive === true) settings.active = id
      saveSettings(settings)
      return send(res, 200, statusPayload())
    }

    if (req.method === 'POST' && path === '/admin/ai/active') {
      const body = await readJson(req, res)
      if (!body) return
      const id = body.provider as ProviderId
      if (!PROVIDER_IDS.includes(id)) return send(res, 400, { error: 'bad_provider' })
      const settings = loadSettings()
      settings.active = id
      saveSettings(settings)
      return send(res, 200, statusPayload())
    }

    if (req.method === 'POST' && path === '/admin/ai/clear') {
      const body = await readJson(req, res)
      if (!body) return
      const id = body.provider as ProviderId
      if (!PROVIDER_IDS.includes(id)) return send(res, 400, { error: 'bad_provider' })
      const settings = loadSettings()
      delete settings.providers[id]
      if (settings.active === id) delete settings.active
      saveSettings(settings)
      return send(res, 200, statusPayload())
    }

    if (req.method === 'POST' && path === '/admin/ai/test') {
      const body = await readJson(req, res)
      if (!body) return
      const id = body.provider as ProviderId
      if (!PROVIDER_IDS.includes(id)) return send(res, 400, { error: 'bad_provider' })
      const cfg = providers()[id]
      if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) return send(res, 200, { ok: false, reason: 'not_configured' })
      const started = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20_000)
      try {
        const upstream = await postJson(
          `${cfg.baseUrl}/chat/completions`,
          { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          JSON.stringify({ model: cfg.model, max_tokens: 8, temperature: 0, messages: [{ role: 'user', content: 'Reply with OK' }] }),
          controller.signal,
        )
        const ms = Date.now() - started
        if (upstream.status >= 200 && upstream.status < 300) return send(res, 200, { ok: true, ms })
        const reason = upstream.status === 401 || upstream.status === 403 ? 'auth' : upstream.status === 404 ? 'model_or_url' : upstream.status === 429 ? 'rate_limit' : 'provider_error'
        return send(res, 200, { ok: false, reason, status: upstream.status, ms })
      } catch (err) {
        const aborted = (err as { name?: string }).name === 'AbortError'
        return send(res, 200, { ok: false, reason: aborted ? 'timeout' : 'unreachable' })
      } finally {
        clearTimeout(timer)
      }
    }

    return send(res, 404, { error: 'not_found' })
  } catch (err) {
    console.warn(`[admin] request failed: ${(err as { name?: string }).name ?? 'error'}`)
    return send(res, 500, { error: 'server_error' })
  }
}
