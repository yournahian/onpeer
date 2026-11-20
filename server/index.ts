/**
 * @deprecated LEGACY — The assistant backend is now handled by the Cloudflare Worker
 * (`worker/index.ts`) which also serves the AI chat endpoint at `POST /api/chat`.
 * This Bun server (`bun run server`) is no longer wired to the Vite proxy and is kept
 * only as a local fallback for standalone testing without wrangler dev.
 *
 * Chat backend for the in-app assistant.
 * Holds the AI provider key (never sent to the browser), owns the system prompt and the tool list,
 * and forwards one completion at a time. Tools run in the browser, where the wallet and chain reads are.
 * Start with: bun run server
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import dns from 'node:dns'
import type { LookupFunction } from 'node:net'
import { SYSTEM_PROMPT, TOOLS } from './agent'
import { PROVIDER_IDS, loadSettings, type ProviderId } from './settings'
import { createAdminHandler } from './admin'

const PORT = Number(process.env.AGENT_PORT ?? 3001)

export type ProviderConfig = {
  label: string
  baseUrl: string | undefined
  apiKey: string | undefined
  model: string | undefined
  /** Where the key comes from: saved in the admin panel, an environment variable, or nowhere. */
  source: 'admin' | 'env' | 'none'
}

const PROVIDER_ORDER: ProviderId[] = PROVIDER_IDS

function envProviders(): Record<ProviderId, Omit<ProviderConfig, 'source'>> {
  const env = process.env
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
      // Gemini's OpenAI-compatible endpoint
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    },
    custom: {
      label: env.CUSTOM_AI_LABEL ?? 'Custom',
      // Any OpenAI-compatible endpoint, e.g. https://my-host/v1
      baseUrl: env.CUSTOM_AI_BASE_URL?.replace(/\/+$/, ''),
      apiKey: env.CUSTOM_AI_API_KEY,
      model: env.CUSTOM_AI_MODEL,
    },
  }
}

/** Environment values, overridden by anything saved from the admin panel. */
export function providers(): Record<ProviderId, ProviderConfig> {
  const base = envProviders()
  const saved = loadSettings().providers
  const out = {} as Record<ProviderId, ProviderConfig>
  for (const id of PROVIDER_IDS) {
    const s = saved[id]
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

function configuredList() {
  const all = providers()
  return PROVIDER_ORDER.filter((id) => isConfigured(all[id]))
}

export function defaultProvider(): ProviderId | undefined {
  const preferred = (loadSettings().active ?? process.env.AI_PROVIDER) as ProviderId | undefined
  const list = configuredList()
  if (preferred && list.includes(preferred)) return preferred
  return list[0]
}

// ---- upstream HTTP with a DNS fallback ----
// Some sandboxes cannot resolve fresh tunnel hostnames (e.g. *.trycloudflare.com) through the
// system resolver. If the normal lookup fails, ask a public DNS-over-HTTPS resolver instead.
async function dohResolve(host: string): Promise<{ address: string; family: 4 } | null> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5_000),
    })
    const data = (await res.json()) as { Answer?: { type: number; data: string }[] }
    const a = data.Answer?.find((r) => r.type === 1)
    return a ? { address: a.data, family: 4 } : null
  } catch {
    return null
  }
}

const lookupWithFallback: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, options, (err, address, family) => {
    if (!err) return callback(null, address, family)
    void dohResolve(hostname).then((hit) => {
      if (!hit) return callback(err, '', 4)
      if (options.all) return callback(null, [{ address: hit.address, family: hit.family }] as never, undefined as never)
      callback(null, hit.address, hit.family)
    })
  })
}

export function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const doRequest = target.protocol === 'http:' ? httpRequest : httpsRequest
    const req = doRequest(
      target,
      { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) }, signal, lookup: lookupWithFallback },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

// ---- tiny in-memory rate limit (per IP) ----
const hits = new Map<string, number[]>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > 30
}

export function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > 200_000) throw new Error('too_large')
    chunks.push(buf)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

type ChatMessage = {
  role: 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: unknown[]
  tool_call_id?: string
  name?: string
}

function sanitize(messages: unknown): ChatMessage[] | null {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 60) return null
  const out: ChatMessage[] = []
  for (const raw of messages as Record<string, unknown>[]) {
    const role = raw.role
    if (role !== 'user' && role !== 'assistant' && role !== 'tool') return null // clients can never send "system"
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

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  let body: Record<string, unknown>
  try {
    body = (await readBody(req)) as Record<string, unknown>
  } catch {
    return send(res, 400, { error: 'bad_request' })
  }
  const messages = sanitize(body.messages)
  if (!messages) return send(res, 400, { error: 'bad_messages' })

  const all = providers()
  const requested = typeof body.provider === 'string' ? (body.provider as ProviderId) : undefined
  const id = requested && configuredList().includes(requested) ? requested : defaultProvider()
  if (!id) return send(res, 503, { error: 'not_configured' })
  const cfg = all[id]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const upstream = await postJson(
      `${cfg.baseUrl}/chat/completions`,
      { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      JSON.stringify({
        model: cfg.model,
        temperature: 0.1,
        messages: [{ role: 'system', content: SYSTEM_PROMPT + contextLine(body.context) }, ...messages],
        tools: TOOLS,
        tool_choice: 'auto',
      }),
      controller.signal,
    )
    if (upstream.status < 200 || upstream.status >= 300) {
      const status = upstream.status
      // Never forward upstream bodies: they can echo request details.
      console.warn(`[assistant] provider ${id} answered HTTP ${status}`)
      return send(res, 502, {
        error: status === 401 || status === 403 ? 'provider_auth' : status === 429 ? 'provider_rate_limit' : 'provider_error',
      })
    }
    let data: { choices?: { message?: Record<string, unknown> }[] }
    try {
      data = JSON.parse(upstream.text) as typeof data
    } catch {
      console.warn(`[assistant] provider ${id} returned non-JSON`)
      return send(res, 502, { error: 'provider_error' })
    }
    const message = data.choices?.[0]?.message
    if (!message) return send(res, 502, { error: 'provider_error' })
    return send(res, 200, {
      provider: id,
      message: {
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : null,
        tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
      },
    })
  } catch (err) {
    const aborted = (err as { name?: string }).name === 'AbortError'
    console.warn(`[assistant] provider ${id} request failed: ${(err as { code?: string }).code ?? (err as { name?: string }).name ?? 'error'}`)
    return send(res, 504, { error: aborted ? 'timeout' : 'provider_error' })
  } finally {
    clearTimeout(timer)
  }
}

const adminHandler = createAdminHandler()

const server = createServer((req, res) => {
  const url = req.url ?? '/'
  if (adminHandler(req, res, url)) return
  const ip = req.socket.remoteAddress ?? 'unknown'

  if (req.method === 'GET' && url === '/health') {
    const all = providers()
    return send(res, 200, {
      configured: configuredList().length > 0,
      active: defaultProvider() ?? null,
      providers: configuredList().map((id) => ({ id, label: all[id].label })),
    })
  }
  if (req.method === 'POST' && url === '/chat') {
    if (rateLimited(ip)) return send(res, 429, { error: 'rate_limited' })
    void handleChat(req, res)
    return
  }
  send(res, 404, { error: 'not_found' })
})

server.listen(PORT, () => {
  const active = defaultProvider()
  console.log(`Assistant backend on :${PORT} (${active ? `provider: ${active}` : 'no provider key set'})`)
})
