import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import { sha256Hex } from '../auth'
import type { Queryable } from '../db'
import type { Env } from '../env'
import { buildAppCsp } from '../index'
import {
  ONRAMP_IP_LIMIT_PER_HOUR,
  ONRAMP_WALLET_LIMIT_PER_MIN,
  SANDBOX_API_BASE_URL,
  SANDBOX_WIDGET_BASE_URL,
  handleOnrampRoutes,
  validateOnrampEnv,
} from '../onramp'

const SESSION_WALLET = '0x1111111111111111111111111111111111111111' as const
const ATTACKER_WALLET = '0x9999999999999999999999999999999999999999' as const
const SESSION_TOKEN = 'b'.repeat(64)

// Synthetic format-valid test credential strictly for unit tests (not a real key)
const FAKE_TEST_KEY = ['TEST', 'API', 'KEY:unit_id_0000:unit_secret_0000'].join('_')
const FAKE_LIVE_KEY = ['LIVE', 'API', 'KEY:unit_id_0000:unit_secret_0000'].join('_')

function makeSandboxEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') },
    CIRCLE_API_KEY: FAKE_TEST_KEY,
    ONRAMP_API_BASE_URL: SANDBOX_API_BASE_URL,
    ONRAMP_WIDGET_BASE_URL: SANDBOX_WIDGET_BASE_URL,
    ONRAMP_REFERRER_DOMAIN: 'app.onpeer.xyz',
    ...overrides,
  }
}

class OnrampMemoryDb implements Queryable {
  nowMs = 1_795_000_000_000
  sessions = new Map<string, { wallet: string; expiresAtMs: number; revokedAtMs: number | null }>()
  rateLimits = new Map<string, { count: number; resetAtMs: number }>()
  audits: Array<{ actor: string; action: string; subject: string | null }> = []

  async seedSession(rawToken: string, wallet: string) {
    this.sessions.set(await sha256Hex(rawToken), {
      wallet,
      expiresAtMs: this.nowMs + 3_600_000,
      revokedAtMs: null,
    })
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: R[]; rowCount: number | null }> {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n.startsWith('SELECT wallet FROM public.sessions')) {
      const row = this.sessions.get(String(values[0]))
      if (!row || row.revokedAtMs !== null || row.expiresAtMs <= this.nowMs) {
        return { rows: [], rowCount: 0 }
      }
      return { rows: [{ wallet: row.wallet } as unknown as R], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.rate_limits')) {
      const bucket = String(values[0])
      const windowSec = Number(values[1])
      const cur = this.rateLimits.get(bucket)
      const count = cur && cur.resetAtMs > this.nowMs ? cur.count + 1 : 1
      const resetAtMs = cur && cur.resetAtMs > this.nowMs ? cur.resetAtMs : this.nowMs + windowSec * 1000
      this.rateLimits.set(bucket, { count, resetAtMs })
      return { rows: [{ count } as unknown as R], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.audit_log')) {
      this.audits.push({
        actor: String(values[0]),
        action: String(values[1]),
        subject: values[2] == null ? null : String(values[2]),
      })
      return { rows: [], rowCount: 1 }
    }

    throw new Error(`Unhandled SQL in OnrampMemoryDb: ${n}`)
  }
}

describe('POST /api/onramp/session', () => {
  it('returns 401 without a valid session token', async () => {
    const db = new OnrampMemoryDb()
    const env = makeSandboxEnv()
    let upstreamCalled = false

    const res = await handleOnrampRoutes(
      new Request('https://app.onpeer.xyz/api/onramp/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destinationAddress: ATTACKER_WALLET }),
      }),
      env,
      db,
      '/onramp/session',
      {
        fetchImpl: async () => {
          upstreamCalled = true
          return new Response('{}', { status: 200 })
        },
      },
    )

    expect(res?.status).toBe(401)
    expect(await res?.json()).toEqual({ error: 'unauthorized' })
    expect(upstreamCalled).toBe(false)
  })

  it('ignores client destinationAddress and appUserId and forces session wallet', async () => {
    const db = new OnrampMemoryDb()
    await db.seedSession(SESSION_TOKEN, SESSION_WALLET)
    const env = makeSandboxEnv()

    let capturedUrl = ''
    let capturedAuth = ''
    const capturedBodies: Array<Record<string, unknown>> = []

    const mockFetch: typeof globalThis.fetch = async (input, init) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const headers = new Headers(init?.headers)
      capturedAuth = headers.get('authorization') ?? ''
      capturedBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)

      return new Response(
        JSON.stringify({
          data: {
            sessionId: 'sess_sandbox_123',
            sessionToken: 'tok_sandbox_secret_xyz',
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            internalSecretField: 'must_not_leak',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const res = await handleOnrampRoutes(
      new Request('https://app.onpeer.xyz/api/onramp/session', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${SESSION_TOKEN}`,
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.10',
        },
        body: JSON.stringify({
          destinationAddress: ATTACKER_WALLET,
          appUserId: 'wallet:0x9999999999999999999999999999999999999999',
          assets: { tokens: ['BTC'] },
        }),
      }),
      env,
      db,
      '/onramp/session',
      { fetchImpl: mockFetch },
    )

    expect(res?.status).toBe(200)
    expect(res?.headers.get('cache-control')).toBe('no-store')
    expect(capturedUrl.startsWith(SANDBOX_API_BASE_URL)).toBe(true)
    expect(capturedAuth).toBe(`Bearer ${FAKE_TEST_KEY}`)
    expect(capturedBodies).toHaveLength(1)
    // Circle's server SDK maps `destinationAddress` -> `walletAddress` on the wire to /v1/stablecoinKits/sessions
    expect(capturedBodies[0]?.walletAddress).toBe(SESSION_WALLET)
    expect(capturedBodies[0]?.appUserId).toBe(`wallet:${SESSION_WALLET}`)
    expect(capturedBodies[0]?.referrerDomain).toBe('app.onpeer.xyz')

    const payload = (await res?.json()) as Record<string, unknown>
    expect(payload.sessionId).toBe('sess_sandbox_123')
    expect(payload.sessionToken).toBe('tok_sandbox_secret_xyz')
    expect(payload.destinationWallet).toBe(SESSION_WALLET)
    expect(String(payload.widgetUrl)).toContain(SANDBOX_WIDGET_BASE_URL)
    expect(String(payload.widgetUrl)).toContain('USDC')
    expect(String(payload.widgetUrl)).not.toContain('BTC')
    expect(payload.internalSecretField).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain(FAKE_TEST_KEY)
    expect(db.audits).toEqual([
      { actor: SESSION_WALLET, action: 'onramp.session', subject: 'sess_sandbox_123' },
    ])
  })

  it('enforces 5 per minute per wallet (returns 429 on 6th call)', async () => {
    const db = new OnrampMemoryDb()
    await db.seedSession(SESSION_TOKEN, SESSION_WALLET)
    const env = makeSandboxEnv()

    const mockFetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: {
            sessionId: 'sess_rl',
            sessionToken: 'tok_rl',
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )

    for (let i = 1; i <= ONRAMP_WALLET_LIMIT_PER_MIN; i++) {
      const res = await handleOnrampRoutes(
        new Request('https://app.onpeer.xyz/api/onramp/session', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${SESSION_TOKEN}`,
            'cf-connecting-ip': `203.0.113.${i}`,
          },
        }),
        env,
        db,
        '/onramp/session',
        { fetchImpl: mockFetch },
      )
      expect(res?.status).toBe(200)
    }

    const sixth = await handleOnrampRoutes(
      new Request('https://app.onpeer.xyz/api/onramp/session', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${SESSION_TOKEN}`,
          'cf-connecting-ip': '203.0.113.99',
        },
      }),
      env,
      db,
      '/onramp/session',
      { fetchImpl: mockFetch },
    )
    expect(sixth?.status).toBe(429)
    expect(await sixth?.json()).toEqual({ error: 'rate_limited' })
  })

  it('enforces 20 per hour per IP across wallets (returns 429 on 21st call)', async () => {
    const db = new OnrampMemoryDb()
    const env = makeSandboxEnv()

    const mockFetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: {
            sessionId: 'sess_ip_rl',
            sessionToken: 'tok_ip_rl',
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )

    for (let i = 1; i <= ONRAMP_IP_LIMIT_PER_HOUR; i++) {
      const tok = i.toString(16).padStart(64, '0')
      const wallet = `0x${i.toString(16).padStart(40, '0')}`
      await db.seedSession(tok, wallet)
      const res = await handleOnrampRoutes(
        new Request('https://app.onpeer.xyz/api/onramp/session', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${tok}`,
            'cf-connecting-ip': '198.51.100.42',
          },
        }),
        env,
        db,
        '/onramp/session',
        { fetchImpl: mockFetch },
      )
      expect(res?.status).toBe(200)
    }

    const tok21 = (21).toString(16).padStart(64, '0')
    await db.seedSession(tok21, `0x${(21).toString(16).padStart(40, '0')}`)
    const res21 = await handleOnrampRoutes(
      new Request('https://app.onpeer.xyz/api/onramp/session', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tok21}`,
          'cf-connecting-ip': '198.51.100.42',
        },
      }),
      env,
      db,
      '/onramp/session',
      { fetchImpl: mockFetch },
    )
    expect(res21?.status).toBe(429)
    expect(await res21?.json()).toEqual({ error: 'rate_limited' })
  })

  it('refuses to mint when API key prefix, API base URL, or widget base URL mismatch or target production', async () => {
    const db = new OnrampMemoryDb()
    await db.seedSession(SESSION_TOKEN, SESSION_WALLET)
    let upstreamCalled = false
    const neverFetch: typeof globalThis.fetch = async () => {
      upstreamCalled = true
      return new Response('{}', { status: 200 })
    }

    // Case 1: Test key + production API URL
    const mismatchApi = makeSandboxEnv({ ONRAMP_API_BASE_URL: 'https://api.circle.com' })
    expect(validateOnrampEnv(mismatchApi)).toEqual({ ok: false, code: 'onramp_env_mismatch' })

    const res1 = await handleOnrampRoutes(
      new Request('https://app.onpeer.xyz/api/onramp/session', {
        method: 'POST',
        headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      }),
      mismatchApi,
      db,
      '/onramp/session',
      { fetchImpl: neverFetch },
    )
    expect(res1?.status).toBe(503)
    expect(await res1?.json()).toEqual({ error: 'onramp_env_mismatch' })

    // Case 2: Test key + production widget URL
    const mismatchWidget = makeSandboxEnv({ ONRAMP_WIDGET_BASE_URL: 'https://onramp.arc.io' })
    expect(validateOnrampEnv(mismatchWidget)).toEqual({ ok: false, code: 'onramp_env_mismatch' })

    // Case 3: Live key + sandbox URLs -> mismatch
    const mismatchKey = makeSandboxEnv({ CIRCLE_API_KEY: FAKE_LIVE_KEY })
    expect(validateOnrampEnv(mismatchKey)).toEqual({ ok: false, code: 'onramp_env_mismatch' })

    // Case 4: All three set to production -> blocked by sandbox-only guard
    const allProd = makeSandboxEnv({
      CIRCLE_API_KEY: FAKE_LIVE_KEY,
      ONRAMP_API_BASE_URL: 'https://api.circle.com',
      ONRAMP_WIDGET_BASE_URL: 'https://onramp.arc.io',
    })
    expect(validateOnrampEnv(allProd)).toEqual({ ok: false, code: 'onramp_sandbox_only' })

    // Case 5: Missing CIRCLE_API_KEY
    const missingKey = makeSandboxEnv({ CIRCLE_API_KEY: '' })
    expect(validateOnrampEnv(missingKey)).toEqual({ ok: false, code: 'onramp_not_configured' })

    // Case 6: Malformed ONRAMP_REFERRER_DOMAIN (URL instead of bare hostname)
    const badReferrer = makeSandboxEnv({ ONRAMP_REFERRER_DOMAIN: 'https://app.onpeer.xyz/buy' })
    expect(validateOnrampEnv(badReferrer)).toEqual({
      ok: false,
      code: 'onramp_invalid_referrer_domain',
    })

    expect(upstreamCalled).toBe(false)
  })

  it('includes widget origin in CSP frame-src and widget + API origins in connect-src', () => {
    const csp = buildAppCsp(makeSandboxEnv())
    expect(csp).toContain(`frame-src https://verify.walletconnect.org https://verify.walletconnect.com ${SANDBOX_WIDGET_BASE_URL}`)
    expect(csp).toContain(`connect-src 'self' ${SANDBOX_WIDGET_BASE_URL} ${SANDBOX_API_BASE_URL}`)
    expect(csp).toContain("media-src 'self' blob: https:")
  })

  it('src/lib/appkit.ts does not throw at module load when VITE_ONRAMP_WIDGET_BASE_URL is missing', async () => {
    const prev = import.meta.env.VITE_ONRAMP_WIDGET_BASE_URL
    try {
      import.meta.env.VITE_ONRAMP_WIDGET_BASE_URL = ''
      const mod = await import('../../src/lib/appkit')
      expect(mod.appKit).toBeDefined()
      expect(typeof mod.appKit.estimateSwap).toBe('function')
      expect(typeof mod.appKit.estimateBridge).toBe('function')
      const checkMissing = mod.getSandboxOnrampKit()
      expect(checkMissing.ok).toBe(false)

      import.meta.env.VITE_ONRAMP_WIDGET_BASE_URL = SANDBOX_WIDGET_BASE_URL
      const checkSandbox = mod.getSandboxOnrampKit()
      expect(checkSandbox.ok).toBe(true)
    } finally {
      import.meta.env.VITE_ONRAMP_WIDGET_BASE_URL = prev
    }
  })

  it('renders Swap, Bridge, Buy, and SiteBar cleanly after @circle-fin/app-kit@1.23.0 upgrade', async () => {
    const g = globalThis as Record<string, unknown>
    const hadWindow = 'window' in g
    const hadSvg = 'SVGElement' in g
    const hadHtml = 'HTMLElement' in g
    const hadElement = 'Element' in g
    class DummyDomElement {}
    if (!hadSvg) g.SVGElement = DummyDomElement
    if (!hadHtml) g.HTMLElement = DummyDomElement
    if (!hadElement) g.Element = DummyDomElement
    if (!hadWindow) {
      g.window = {
        location: {
          hostname: 'localhost',
          pathname: '/swap',
          search: '',
          hash: '',
          href: 'http://localhost:5173/swap',
          origin: 'http://localhost:5173',
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
        matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
        localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
        sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    }

    const React = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { WagmiProvider } = await import('wagmi')
    const { ConnectKitProvider } = await import('connectkit')
    const { config } = await import('../../src/config')
    const { ThemeProvider } = await import('../../src/lib/theme')
    const { default: SwapPage } = await import('../../src/pages/Swap')
    const { default: BridgePage } = await import('../../src/pages/Bridge')
    const { default: BuyPage } = await import('../../src/pages/Buy')

    const prev = import.meta.env.VITE_ONRAMP_WIDGET_BASE_URL
    try {
      // Even when VITE_ONRAMP_WIDGET_BASE_URL is missing, Swap and Bridge render cleanly without throwing
      import.meta.env.VITE_ONRAMP_WIDGET_BASE_URL = ''
      const qc = new QueryClient()
      const wrap = (node: React.ReactElement) =>
        renderToStaticMarkup(
          React.createElement(
            WagmiProvider,
            { config },
            React.createElement(
              QueryClientProvider,
              { client: qc },
              React.createElement(ConnectKitProvider, null, React.createElement(ThemeProvider, null, node)),
            ),
          ),
        )

      const swapHtml = wrap(React.createElement(SwapPage))
      expect(swapHtml).toContain('swapping')
      expect(swapHtml).toContain('USDC')
      expect(swapHtml).not.toContain('Buy USDC (sandbox)')

      const bridgeHtml = wrap(React.createElement(BridgePage))
      expect(bridgeHtml).toContain('Bridge')
      expect(bridgeHtml).toContain('USDC')

      // Buy USDC is hidden from top navigation (dev URL-only) and Cash out is not in top Products nav
      const navMatch = swapHtml.match(/<nav[^>]*aria-label="Products"[^>]*>([\s\S]*?)<\/nav>/)
      expect(navMatch?.[1]).not.toContain('Buy USDC')
      expect(navMatch?.[1]).not.toContain('Cash out')

      // Buy page renders required Phase 3 copy and links cash out directly to /p2p?mode=sell
      import.meta.env.VITE_ONRAMP_WIDGET_BASE_URL = SANDBOX_WIDGET_BASE_URL
      const buyHtml = wrap(React.createElement(BuyPage))
      expect(buyHtml).toContain('Sandbox. No real money. Use dummy data.')
      expect(buyHtml).toContain('South Asia')
      expect(buyHtml).toContain('/p2p?mode=sell')
    } finally {
      import.meta.env.VITE_ONRAMP_WIDGET_BASE_URL = prev
      if (!hadWindow) delete g.window
      if (!hadSvg) delete g.SVGElement
      if (!hadHtml) delete g.HTMLElement
      if (!hadElement) delete g.Element
    }
  }, 25_000)
})
