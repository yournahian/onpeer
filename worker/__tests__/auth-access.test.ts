import { describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import type { QueryResultRow } from 'pg'
import {
  SESSION_TTL_SECONDS,
  handleAuthRoutes,
  requireAdmin,
  requireSession,
  sha256Hex,
  signHmacToken,
  timingSafeEqualBytes,
  verifyHmacToken,
} from '../auth'
import {
  BACKUP_ARBITER_DELAY_SECONDS,
  ORDER_STATUS,
  checkAdminAccess,
  checkOrderAccess,
  createVerifierClients,
  type ChainAd,
  type ChainOrder,
  type ChainReader,
  type ChainRoles,
} from '../chain'
import { checkRateLimit, type Queryable } from '../db'
import type { Env } from '../env'
import { createWorkerApp } from '../index'

const BUYER_ACCOUNT = privateKeyToAccount(
  '0x1111111111111111111111111111111111111111111111111111111111111111',
)
const SELLER_ACCOUNT = privateKeyToAccount(
  '0x2222222222222222222222222222222222222222222222222222222222222222',
)
const ARBITER_ACCOUNT = privateKeyToAccount(
  '0x3333333333333333333333333333333333333333333333333333333333333333',
)
const BACKUP_ARBITER_ACCOUNT = privateKeyToAccount(
  '0x4444444444444444444444444444444444444444444444444444444444444444',
)
const OWNER_ACCOUNT = privateKeyToAccount(
  '0x5555555555555555555555555555555555555555555555555555555555555555',
)
const OUTSIDER_ACCOUNT = privateKeyToAccount(
  '0x6666666666666666666666666666666666666666666666666666666666666666',
)
const VERIFIER_PRIVKEY = '0x7777777777777777777777777777777777777777777777777777777777777777'
const VERIFIER_ACCOUNT = privateKeyToAccount(VERIFIER_PRIVKEY)

const TEST_SESSION_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const ESCROW_ADDR = '0xf719ebbc5080aee09e38909764b897e0bf01a9b0'

/** Minimal in-memory SQL double supporting `sessions`, `rate_limits`, and `audit_log` for Step 3 tests. */
class MemoryDb implements Queryable {
  nowMs = 1_795_000_000_000
  sessions = new Map<string, { wallet: string; expiresAtMs: number; revokedAtMs: number | null }>()
  rateLimits = new Map<string, { count: number; resetAtMs: number }>()
  audits: Array<{ actor: string; action: string; subject: string | null }> = []

  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: R[]; rowCount: number | null }> {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized.startsWith('INSERT INTO public.rate_limits') && normalized.includes('ON CONFLICT (bucket) DO UPDATE')) {
      const bucket = String(values[0])
      const windowSec = Number(values[1])
      const existing = this.rateLimits.get(bucket)
      let nextCount = 1
      let resetAtMs = this.nowMs + windowSec * 1000
      if (existing && existing.resetAtMs > this.nowMs) {
        nextCount = existing.count + 1
        resetAtMs = existing.resetAtMs
      }
      this.rateLimits.set(bucket, { count: nextCount, resetAtMs })
      return { rows: [{ count: nextCount } as unknown as R], rowCount: 1 }
    }

    if (normalized.startsWith('INSERT INTO public.rate_limits') && normalized.includes('ON CONFLICT (bucket) DO NOTHING')) {
      const bucket = String(values[0])
      const windowSec = Number(values[1])
      const existing = this.rateLimits.get(bucket)
      if (existing && existing.resetAtMs > this.nowMs) {
        return { rows: [], rowCount: 0 }
      }
      this.rateLimits.set(bucket, { count: 1, resetAtMs: this.nowMs + windowSec * 1000 })
      return { rows: [], rowCount: 1 }
    }

    if (normalized.startsWith('INSERT INTO public.sessions')) {
      const tokenHash = String(values[0])
      const wallet = String(values[1])
      const expiresAtMs = Date.parse(String(values[2]))
      this.sessions.set(tokenHash, { wallet, expiresAtMs, revokedAtMs: null })
      return { rows: [], rowCount: 1 }
    }

    if (normalized.startsWith('SELECT wallet FROM public.sessions')) {
      const tokenHash = String(values[0])
      const row = this.sessions.get(tokenHash)
      if (!row || row.revokedAtMs !== null || row.expiresAtMs <= this.nowMs) {
        return { rows: [], rowCount: 0 }
      }
      return { rows: [{ wallet: row.wallet } as unknown as R], rowCount: 1 }
    }

    if (normalized.startsWith('UPDATE public.sessions SET revoked_at')) {
      const tokenHash = String(values[0])
      const row = this.sessions.get(tokenHash)
      if (!row || row.revokedAtMs !== null) return { rows: [], rowCount: 0 }
      row.revokedAtMs = this.nowMs
      return { rows: [], rowCount: 1 }
    }

    if (normalized.startsWith('INSERT INTO public.audit_log')) {
      this.audits.push({
        actor: String(values[0]),
        action: String(values[1]),
        subject: values[2] == null ? null : String(values[2]),
      })
      return { rows: [], rowCount: 1 }
    }

    throw new Error(`Unhandled SQL in MemoryDb: ${normalized}`)
  }
}

function makeTestEnv(overrides?: Partial<Env>): Env {
  return {
    ASSETS: {
      fetch: async () => new Response('spa-index', { status: 200 }),
    },
    VITE_P2P_ESCROW_ADDRESS: ESCROW_ADDR,
    SESSION_SECRET: TEST_SESSION_SECRET,
    DIDIT_MODE: 'sandbox',
    ...overrides,
  }
}

function makeChainMock(opts?: {
  roles?: Partial<ChainRoles>
  orders?: Map<bigint, ChainOrder>
  ads?: Map<bigint, ChainAd>
}): ChainReader {
  const roles: ChainRoles = {
    owner: OWNER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    arbiter: ARBITER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    backupArbiter: BACKUP_ARBITER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    verifier: VERIFIER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    kycRequired: false,
    sealedEnabled: true,
    payerProofRequired: true,
    ...opts?.roles,
  }
  const orders = opts?.orders ?? new Map<bigint, ChainOrder>()
  const ads = opts?.ads ?? new Map<bigint, ChainAd>()

  return {
    getRoles: async () => roles,
    getOrder: async (id) => orders.get(id) ?? null,
    getAd: async (id) => ads.get(id) ?? null,
    isVerified: async () => false,
    getOpenOrderCount: async () => 0n,
    getUserAdIds: async () => [],
  }
}

function sampleOrder(overrides?: Partial<ChainOrder>): ChainOrder {
  return {
    id: 42n,
    adId: 7n,
    buyer: BUYER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    seller: SELLER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    taker: BUYER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    status: ORDER_STATUS.DISPUTED,
    createdAt: 1_795_000_000n,
    deadline: 1_795_001_800n,
    paidAt: 1_795_000_500n,
    disputedAt: 1_795_001_500n,
    reviewStartedAt: 0n,
    amount: 50_000_000n,
    detailsReady: true,
    detailsHash: ('0x' + 'ab'.repeat(32)) as `0x${string}`,
    payerProof: ('0x' + 'cd'.repeat(32)) as `0x${string}`,
    paidLate: false,
    ...overrides,
  }
}

describe('Step 3: Wallet-Signature Auth, Sessions & Onchain Role Access', () => {
  it('completes nonce + EIP-191 login, stores SHA-256 hashed 12h session, and supports /me and /logout', async () => {
    const db = new MemoryDb()
    const env = makeTestEnv()

    const nonceReq = new Request('https://app.onpeer.xyz/api/auth/nonce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: BUYER_ACCOUNT.address }),
    })
    const nonceRes = await handleAuthRoutes(nonceReq, env, db, '/auth/nonce', db.nowMs)
    expect(nonceRes?.status).toBe(200)
    const { nonce, message } = (await nonceRes!.json()) as { nonce: string; message: string }
    expect(message).toContain(BUYER_ACCOUNT.address.toLowerCase())

    const signature = await BUYER_ACCOUNT.signMessage({ message })
    const loginReq = new Request('https://app.onpeer.xyz/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: BUYER_ACCOUNT.address, signature, nonce }),
    })
    const loginRes = await handleAuthRoutes(loginReq, env, db, '/auth/login', db.nowMs)
    expect(loginRes?.status).toBe(200)
    const loginData = (await loginRes!.json()) as { token: string; wallet: string; expiresInSeconds: number }
    expect(loginData.wallet).toBe(BUYER_ACCOUNT.address.toLowerCase())
    expect(loginData.expiresInSeconds).toBe(SESSION_TTL_SECONDS)
    expect(loginData.token).toMatch(/^[0-9a-f]{64}$/)

    // Raw token is NEVER stored in DB; only its SHA-256 digest is stored
    expect(db.sessions.has(loginData.token)).toBe(false)
    const expectedHash = await sha256Hex(loginData.token)
    expect(db.sessions.has(expectedHash)).toBe(true)

    // /auth/me succeeds with valid bearer token
    const meReq = new Request('https://app.onpeer.xyz/api/auth/me', {
      headers: { authorization: `Bearer ${loginData.token}` },
    })
    const meRes = await handleAuthRoutes(meReq, env, db, '/auth/me', db.nowMs)
    expect(meRes?.status).toBe(200)
    expect(await meRes!.json()).toEqual({ wallet: BUYER_ACCOUNT.address.toLowerCase() })

    // Replaying the exact same signed nonce a second time is rejected (single-use idempotency)
    const replayRes = await handleAuthRoutes(
      new Request('https://app.onpeer.xyz/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: BUYER_ACCOUNT.address, signature, nonce }),
      }),
      env,
      db,
      '/auth/login',
      db.nowMs,
    )
    expect(replayRes?.status).toBe(401)

    // Logout revokes the session immediately
    const logoutRes = await handleAuthRoutes(
      new Request('https://app.onpeer.xyz/api/auth/logout', {
        method: 'POST',
        headers: { authorization: `Bearer ${loginData.token}` },
      }),
      env,
      db,
      '/auth/logout',
      db.nowMs,
    )
    expect(logoutRes?.status).toBe(200)

    const meAfterLogout = await requireSession(
      new Request('https://app.onpeer.xyz/api/auth/me', {
        headers: { authorization: `Bearer ${loginData.token}` },
      }),
      db,
    )
    expect(meAfterLogout.ok).toBe(false)
  })

  it('rejects expired nonces, wrong-wallet signatures, tampered HMAC tokens, and expired 12h sessions', async () => {
    const db = new MemoryDb()
    const env = makeTestEnv()

    const nonceRes = await handleAuthRoutes(
      new Request('https://app.onpeer.xyz/api/auth/nonce', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: BUYER_ACCOUNT.address }),
      }),
      env,
      db,
      '/auth/nonce',
      db.nowMs,
    )
    const { nonce, message } = (await nonceRes!.json()) as { nonce: string; message: string }

    // Wrong wallet signs the message
    const wrongSig = await OUTSIDER_ACCOUNT.signMessage({ message })
    const wrongWalletRes = await handleAuthRoutes(
      new Request('https://app.onpeer.xyz/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: BUYER_ACCOUNT.address, signature: wrongSig, nonce }),
      }),
      env,
      db,
      '/auth/login',
      db.nowMs,
    )
    expect(wrongWalletRes?.status).toBe(401)

    // Valid signature submitted after 5-minute nonce TTL expires
    const validSig = await BUYER_ACCOUNT.signMessage({ message })
    const expiredNonceRes = await handleAuthRoutes(
      new Request('https://app.onpeer.xyz/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: BUYER_ACCOUNT.address, signature: validSig, nonce }),
      }),
      env,
      db,
      '/auth/login',
      db.nowMs + 5 * 60_000 + 1,
    )
    expect(expiredNonceRes?.status).toBe(401)

    // Tampered HMAC signature is rejected in constant time
    const signed = await signHmacToken(env, { kind: 'test', exp: db.nowMs + 60_000 })
    const tampered = signed.slice(0, -2) + (signed.endsWith('aa') ? 'bb' : 'aa')
    expect(await verifyHmacToken(env, tampered, db.nowMs)).toBeNull()
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false)
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true)

    // Session expires after 12h
    const loginRes = await handleAuthRoutes(
      new Request('https://app.onpeer.xyz/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: BUYER_ACCOUNT.address, signature: validSig, nonce }),
      }),
      env,
      db,
      '/auth/login',
      db.nowMs,
    )
    const { token } = (await loginRes!.json()) as { token: string }
    db.nowMs += SESSION_TTL_SECONDS * 1000 + 1000
    const expiredSess = await requireSession(
      new Request('https://app.onpeer.xyz/api/auth/me', {
        headers: { authorization: `Bearer ${token}` },
      }),
      db,
    )
    expect(expiredSess.ok).toBe(false)
  })

  it('enforces order-role access checks strictly from chain state (buyer, seller, arbiter, 7-day backupArbiter, non-party 403)', async () => {
    const order = sampleOrder()
    const orders = new Map<bigint, ChainOrder>([[42n, order]])
    const chain = makeChainMock({ orders })
    const baseNow = Number(order.disputedAt) + 60

    // Buyer, Seller, and Primary Arbiter are allowed
    const buyerAcc = await checkOrderAccess(chain, 42n, BUYER_ACCOUNT.address.toLowerCase() as `0x${string}`, baseNow)
    expect(buyerAcc.allowed && buyerAcc.role).toBe('buyer')

    const sellerAcc = await checkOrderAccess(chain, 42n, SELLER_ACCOUNT.address.toLowerCase() as `0x${string}`, baseNow)
    expect(sellerAcc.allowed && sellerAcc.role).toBe('seller')

    const arbAcc = await checkOrderAccess(chain, 42n, ARBITER_ACCOUNT.address.toLowerCase() as `0x${string}`, baseNow)
    expect(arbAcc.allowed && arbAcc.role).toBe('arbiter')

    // Non-party outsider AND distinct contract owner (who is not arbiter or party) get 403
    const outsiderAcc = await checkOrderAccess(
      chain,
      42n,
      OUTSIDER_ACCOUNT.address.toLowerCase() as `0x${string}`,
      baseNow,
    )
    expect(outsiderAcc).toEqual({ allowed: false, status: 403, error: 'forbidden' })

    const ownerAcc = await checkOrderAccess(chain, 42n, OWNER_ACCOUNT.address.toLowerCase() as `0x${string}`, baseNow)
    expect(ownerAcc).toEqual({ allowed: false, status: 403, error: 'forbidden' })

    // Backup arbiter is rejected 1 second before 7 days, and allowed at/after 7 days
    const before7d = Number(order.disputedAt) + BACKUP_ARBITER_DELAY_SECONDS - 1
    const at7d = Number(order.disputedAt) + BACKUP_ARBITER_DELAY_SECONDS
    const backupEarly = await checkOrderAccess(
      chain,
      42n,
      BACKUP_ARBITER_ACCOUNT.address.toLowerCase() as `0x${string}`,
      before7d,
    )
    expect(backupEarly).toEqual({ allowed: false, status: 403, error: 'forbidden' })

    const backupReady = await checkOrderAccess(
      chain,
      42n,
      BACKUP_ARBITER_ACCOUNT.address.toLowerCase() as `0x${string}`,
      at7d,
    )
    expect(backupReady.allowed && backupReady.role).toBe('backup_arbiter')

    // Non-existent order returns 404
    const missing = await checkOrderAccess(chain, 999n, BUYER_ACCOUNT.address.toLowerCase() as `0x${string}`, baseNow)
    expect(missing).toEqual({ allowed: false, status: 404, error: 'order_not_found' })
  })

  it('enforces admin access from chain state and forbids governance keys as VERIFIER_PRIVATE_KEY', async () => {
    const db = new MemoryDb()
    const chain = makeChainMock()

    expect((await checkAdminAccess(chain, OWNER_ACCOUNT.address.toLowerCase() as `0x${string}`)).allowed).toBe(true)
    expect((await checkAdminAccess(chain, ARBITER_ACCOUNT.address.toLowerCase() as `0x${string}`)).allowed).toBe(true)
    expect((await checkAdminAccess(chain, BACKUP_ARBITER_ACCOUNT.address.toLowerCase() as `0x${string}`)).allowed).toBe(
      false,
    )
    expect(
      (
        await checkAdminAccess(chain, BACKUP_ARBITER_ACCOUNT.address.toLowerCase() as `0x${string}`, {
          allowBackupArbiter: true,
        })
      ).allowed,
    ).toBe(true)
    expect((await checkAdminAccess(chain, OUTSIDER_ACCOUNT.address.toLowerCase() as `0x${string}`)).allowed).toBe(false)

    // Non-admin session calling requireAdmin gets 403
    const token = 'a'.repeat(64)
    db.sessions.set(await sha256Hex(token), {
      wallet: OUTSIDER_ACCOUNT.address.toLowerCase(),
      expiresAtMs: db.nowMs + 3_600_000,
      revokedAtMs: null,
    })
    const adminCheck = await requireAdmin(
      new Request('https://app.onpeer.xyz/api/admin/ai', {
        headers: { authorization: `Bearer ${token}` },
      }),
      db,
      chain,
    )
    expect(adminCheck.ok).toBe(false)
    if (!adminCheck.ok) expect(adminCheck.response.status).toBe(403)

    // Verifier key isolation check: owner/arbiter key rejected, separate appointed verifier accepted
    const roles = await chain.getRoles()
    await expect(
      createVerifierClients(
        makeTestEnv({
          VERIFIER_PRIVATE_KEY: '0x5555555555555555555555555555555555555555555555555555555555555555', // OWNER
        }),
        roles,
      ),
    ).rejects.toThrow('verifier_key_must_be_separate_from_governance')

    const validVerifier = await createVerifierClients(makeTestEnv({ VERIFIER_PRIVATE_KEY: VERIFIER_PRIVKEY }), roles)
    expect(validVerifier.account.address.toLowerCase()).toBe(VERIFIER_ACCOUNT.address.toLowerCase())
  })

  it('enforces rate limits per bucket and resets cleanly after the window', async () => {
    const db = new MemoryDb()
    expect(await checkRateLimit(db, 'rl:test', 2, 60)).toBe(true)
    expect(await checkRateLimit(db, 'rl:test', 2, 60)).toBe(true)
    expect(await checkRateLimit(db, 'rl:test', 2, 60)).toBe(false)

    db.nowMs += 61_000
    expect(await checkRateLimit(db, 'rl:test', 2, 60)).toBe(true)
  })

  it('never redirects /api/* on app.onpeer.xyz or onpeer.xyz, and keeps /privacy unredirected on onpeer.xyz', async () => {
    const db = new MemoryDb()
    const env = makeTestEnv()
    const chain = makeChainMock()
    const worker = createWorkerApp({
      runWithDb: async (_env, fn) => fn(db),
      makeChain: () => chain,
    })

    const appApiRes = await worker.fetch(new Request('https://app.onpeer.xyz/api/health'), env)
    expect(appApiRes.status).toBe(200)

    const landingApiRes = await worker.fetch(new Request('https://onpeer.xyz/api/health'), env)
    expect(landingApiRes.status).toBe(200)

    const landingP2pRes = await worker.fetch(new Request('https://onpeer.xyz/p2p'), env)
    expect(landingP2pRes.status).toBe(302)
    expect(landingP2pRes.headers.get('location')).toBe('https://app.onpeer.xyz/p2p')

    const landingPrivacyRes = await worker.fetch(new Request('https://onpeer.xyz/privacy'), env)
    expect(landingPrivacyRes.status).toBe(200)
  })
})
