import { describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import type { QueryResultRow } from 'pg'
import { sha256Hex } from '../auth'
import { ORDER_STATUS, type ChainOrder, type ChainReader, type ChainRoles } from '../chain'
import { sealText } from '../crypto'
import type { Queryable } from '../db'
import type { Env, HyperdriveBinding } from '../env'
import { handleDisputeRoutes } from '../disputes'

const SELLER_ACCOUNT = privateKeyToAccount(
  '0x2222222222222222222222222222222222222222222222222222222222222222',
)
const BUYER_ACCOUNT = privateKeyToAccount(
  '0x1111111111111111111111111111111111111111111111111111111111111111',
)
const ARBITER_ACCOUNT = privateKeyToAccount(
  '0x3333333333333333333333333333333333333333333333333333333333333333',
)
const OUTSIDER_ACCOUNT = privateKeyToAccount(
  '0x6666666666666666666666666666666666666666666666666666666666666666',
)

const SESSION_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const VAULT_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const ESCROW_ADDR = '0xf719ebbc5080aee09e38909764b897e0bf01a9b0'
const BACKUP_ARBITER_ADDR = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

function makeEnv(): Env {
  return {
    SESSION_SECRET,
    VAULT_MASTER_KEY,
    HYPERDRIVE: { connectionString: 'postgres://localhost/test' } as HyperdriveBinding,
    VITE_P2P_ESCROW_ADDRESS: ESCROW_ADDR,
    CHAIN_RPC_URL: 'http://localhost:8545',
    DIDIT_API_KEY: '',
    DIDIT_WORKFLOW_ID: '',
    DIDIT_WEBHOOK_SECRET: 'testsecret',
    DIDIT_MODE: 'sandbox',
    VERIFIER_PRIVATE_KEY: '0x7777777777777777777777777777777777777777777777777777777777777777',
  } as unknown as Env
}

function makeDefaultRoles(): ChainRoles {
  return {
    owner: '0x54190a788eef66d9abddcf7d135b09b4d2b72f3a',
    arbiter: ARBITER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    backupArbiter: BACKUP_ARBITER_ADDR,
    verifier: '0xeebd29441af1a931c4a6eec2265b0757fd992f5e',
    kycRequired: false,
    sealedEnabled: false,
    payerProofRequired: false,
  }
}

function makeOrder(overrides?: Partial<ChainOrder>): ChainOrder {
  return {
    id: 1n,
    adId: 1n,
    buyer: BUYER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    seller: SELLER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    taker: BUYER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    status: ORDER_STATUS.DISPUTED,
    createdAt: 1_795_000_000n,
    deadline: 1_795_003_600n,
    paidAt: 1_795_001_000n,
    disputedAt: 1_795_002_000n,
    reviewStartedAt: 0n,
    amount: 10_000000n,
    detailsReady: true,
    detailsHash: ZERO_BYTES32 as `0x${string}`,
    payerProof: ZERO_BYTES32 as `0x${string}`,
    paidLate: false,
    ...overrides,
  }
}

function makeChain(opts?: { order?: ChainOrder | null; arbiterIsBackup?: boolean }): ChainReader {
  const roles = makeDefaultRoles()
  const order = opts?.order !== undefined ? opts.order : makeOrder()
  return {
    getRoles: async () => roles,
    getOrder: async (id: bigint) => (id === 1n ? order : null),
    getAd: async () => null,
    isVerified: async () => false,
    getOpenOrderCount: async () => 0n,
    getUserAdIds: async () => [],
  }
}

interface FilingStore {
  id: string
  order_id: string
  filed_by: string
  reason_code: string
  text_enc: string
  evidence_blob_ids: string[] | null
  status: string
  filed_at: string
  closed_at: string | null
  delete_after: string | null
}

class DisputeMemoryDb implements Queryable {
  nowSec = 1_795_000_000
  sessions = new Map<string, { wallet: string; expiresAtSec: number }>()
  rateLimits = new Map<string, { count: number; resetAtSec: number }>()
  filings: FilingStore[] = []
  audits: Array<{ actor: string; action: string; subject: string | null }> = []
  outbox: Array<{ event_type: string; payload: string }> = []
  filingIdCounter = 1

  async seedSession(rawToken: string, wallet: string) {
    this.sessions.set(await sha256Hex(rawToken), { wallet, expiresAtSec: this.nowSec + 3600 })
  }

  async seedFiling(env: Env, orderIdStr: string, filedBy: string, statement: string) {
    const textEnc = await sealText(env, statement, `dispute:${orderIdStr}:${filedBy}`)
    const id = String(this.filingIdCounter++)
    this.filings.push({
      id,
      order_id: orderIdStr,
      filed_by: filedBy,
      reason_code: 'fraud',
      text_enc: textEnc,
      evidence_blob_ids: null,
      status: 'open',
      filed_at: new Date().toISOString(),
      closed_at: null,
      delete_after: null,
    })
    return id
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: R[]; rowCount: number | null }> {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n === 'BEGIN' || n === 'COMMIT' || n === 'ROLLBACK') return { rows: [], rowCount: 0 }

    // Session lookup
    if (n.startsWith('SELECT wallet FROM public.sessions') && n.includes('token_hash')) {
      const token = String(values[0])
      const sess = this.sessions.get(token)
      if (!sess || sess.expiresAtSec <= this.nowSec) return { rows: [], rowCount: 0 }
      return { rows: [{ wallet: sess.wallet } as unknown as R], rowCount: 1 }
    }

    // Rate limits
    if (n.startsWith('INSERT INTO public.rate_limits') && n.includes('ON CONFLICT (bucket) DO UPDATE')) {
      const bucket = String(values[0])
      const windowSec = Number(values[1])
      const existing = this.rateLimits.get(bucket)
      const resetAtSec = existing && existing.resetAtSec > this.nowSec ? existing.resetAtSec : this.nowSec + windowSec
      const count = existing && existing.resetAtSec > this.nowSec ? existing.count + 1 : 1
      this.rateLimits.set(bucket, { count, resetAtSec })
      return { rows: [{ count } as unknown as R], rowCount: 1 }
    }

    // Audit log
    if (n.startsWith('INSERT INTO public.audit_log')) {
      this.audits.push({ actor: String(values[0]), action: String(values[1]), subject: values[2] ? String(values[2]) : null })
      return { rows: [], rowCount: 1 }
    }

    // Notifications outbox insert (non-fatal, can fail)
    if (n.startsWith('INSERT INTO public.notifications_outbox')) {
      this.outbox.push({ event_type: 'dispute_filed', payload: String(values[0]) })
      return { rows: [], rowCount: 1 }
    }

    // Vault blobs check
    if (n.startsWith('SELECT id FROM public.vault_blobs') && n.includes('owner_wallet')) {
      return { rows: [], rowCount: 0 }
    }

    // Insert dispute filing
    if (n.startsWith('INSERT INTO public.dispute_filings') && n.includes('RETURNING id')) {
      const orderIdStr = String(values[0])
      const filedBy = String(values[1])
      // Check UNIQUE(order_id, filed_by) constraint
      const dup = this.filings.find((f) => f.order_id === orderIdStr && f.filed_by === filedBy)
      if (dup) {
        throw new Error('duplicate key value violates unique constraint (23505)')
      }
      const id = String(this.filingIdCounter++)
      this.filings.push({
        id,
        order_id: orderIdStr,
        filed_by: filedBy,
        reason_code: String(values[2]),
        text_enc: String(values[3]),
        evidence_blob_ids: values[4] ? (values[4] as string[]) : null,
        status: 'open',
        filed_at: new Date().toISOString(),
        closed_at: null,
        delete_after: null,
      })
      return { rows: [{ id } as unknown as R], rowCount: 1 }
    }

    // Select dispute filings
    if (n.startsWith('SELECT id, order_id, filed_by, reason_code, text_enc, evidence_blob_ids, status, filed_at, closed_at FROM public.dispute_filings')) {
      let results = [...this.filings]
      if (n.includes('order_id = $1')) {
        results = results.filter((f) => f.order_id === String(values[0]))
      } else if (n.includes('status = $1')) {
        results = results.filter((f) => f.status === String(values[0]))
        const limit = Number(values[1])
        results = results.slice(0, limit)
      }
      return { rows: results as unknown as R[], rowCount: results.length }
    }

    return { rows: [], rowCount: 0 }
  }
}

async function authHeader(wallet: `0x${string}`, db: DisputeMemoryDb): Promise<string> {
  const rawToken = wallet.slice(2).toLowerCase().padEnd(64, '0')
  await db.seedSession(rawToken, wallet.toLowerCase())
  return `Bearer ${rawToken}`
}

// =========================================================================
describe('disputes — POST /api/orders/:id/disputes', () => {
  it('files a dispute as buyer (DISPUTED order) → 201', async () => {
    const db = new DisputeMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/1/disputes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        reasonCode: 'payment_not_received',
        statement: 'I sent the payment but seller did not release. Transaction ID: TXN-9999',
        evidenceBlobIds: [],
      }),
    })

    const res = await handleDisputeRoutes(req, env, db, chain, '/orders/1/disputes')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(201)
    const body = await res!.json() as { id: string; status: string }
    expect(body.id).toBeTruthy()
    expect(body.status).toBe('open')
    expect(db.filings).toHaveLength(1)
    // Statement must be encrypted at rest
    expect(db.filings[0]!.text_enc).not.toContain('TXN-9999')
    expect(db.audits.some((a) => a.action === 'dispute.file')).toBe(true)
  })

  it('files a dispute as seller → 201', async () => {
    const db = new DisputeMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(SELLER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/1/disputes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        reasonCode: 'fraud',
        statement: 'Buyer made fraudulent payment claim.',
      }),
    })

    const res = await handleDisputeRoutes(req, env, db, chain, '/orders/1/disputes')
    expect(res!.status).toBe(201)
    expect(db.filings).toHaveLength(1)
  })

  it('returns 403 for a non-party (outsider)', async () => {
    const db = new DisputeMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(OUTSIDER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/1/disputes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ reasonCode: 'fraud', statement: 'test' }),
    })

    const res = await handleDisputeRoutes(req, env, db, chain, '/orders/1/disputes')
    expect(res!.status).toBe(403)
  })

  it('returns 409 when buyer files a second time (duplicate)', async () => {
    const db = new DisputeMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const body = JSON.stringify({ reasonCode: 'fraud', statement: 'First statement.' })

    // First filing
    await handleDisputeRoutes(
      new Request('http://localhost/orders/1/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body,
      }),
      env, db, chain, '/orders/1/disputes',
    )

    // Second filing (re-seed session so token is still valid)
    await db.seedSession(BUYER_ACCOUNT.address.slice(2).toLowerCase().padEnd(64, '0'), BUYER_ACCOUNT.address.toLowerCase())
    const res2 = await handleDisputeRoutes(
      new Request('http://localhost/orders/1/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body,
      }),
      env, db, chain, '/orders/1/disputes',
    )
    expect(res2!.status).toBe(409)
    expect(await res2!.json()).toMatchObject({ error: 'dispute_already_filed' })
  })

  it('allows buyer to file offchain while order is PAID (0-USDC flow) and notifies seller + arbiter', async () => {
    const db = new DisputeMemoryDb()
    const env = makeEnv()
    const chain = makeChain({ order: makeOrder({ status: ORDER_STATUS.PAID }) })
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/1/disputes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ reasonCode: 'payment_not_received', statement: 'Paid via bKash, seller unresponsive.' }),
    })

    const res = await handleDisputeRoutes(req, env, db, chain, '/orders/1/disputes')
    expect(res!.status).toBe(201)
    expect(db.filings).toHaveLength(1)
  })

  it('returns 400 dispute_not_eligible for PENDING order and 403 when arbiter tries to file', async () => {
    const db = new DisputeMemoryDb()
    const env = makeEnv()
    const pendingChain = makeChain({ order: makeOrder({ status: ORDER_STATUS.PENDING }) })
    const buyerAuth = await authHeader(BUYER_ACCOUNT.address, db)

    const pendingRes = await handleDisputeRoutes(
      new Request('http://localhost/orders/1/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: buyerAuth },
        body: JSON.stringify({ reasonCode: 'fraud', statement: 'Trying to file on PENDING.' }),
      }),
      env,
      db,
      pendingChain,
      '/orders/1/disputes',
    )
    expect(pendingRes!.status).toBe(400)
    expect(await pendingRes!.json()).toMatchObject({ error: 'dispute_not_eligible' })

    const disputedChain = makeChain({ order: makeOrder({ status: ORDER_STATUS.DISPUTED }) })
    const arbiterAuth = await authHeader(ARBITER_ACCOUNT.address, db)
    const arbiterRes = await handleDisputeRoutes(
      new Request('http://localhost/orders/1/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: arbiterAuth },
        body: JSON.stringify({ reasonCode: 'fraud', statement: 'Arbiter cannot file.' }),
      }),
      env,
      db,
      disputedChain,
      '/orders/1/disputes',
    )
    expect(arbiterRes!.status).toBe(403)
  })
})

// =========================================================================
describe('disputes — GET /api/orders/:id/disputes', () => {
  it('buyer sees their own filing decrypted', async () => {
    const db = new DisputeMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const buyerAddr = BUYER_ACCOUNT.address.toLowerCase()
    await db.seedFiling(env, '1', buyerAddr, 'My detailed buyer statement.')

    const auth = await authHeader(BUYER_ACCOUNT.address, db)
    const req = new Request('http://localhost/orders/1/disputes', {
      headers: { Authorization: auth },
    })

    const res = await handleDisputeRoutes(req, env, db, chain, '/orders/1/disputes')
    expect(res!.status).toBe(200)
    const body = await res!.json() as { orderId: string; filings: Array<{ statement: string; filedBy: string }> }
    expect(body.orderId).toBe('1')
    expect(body.filings).toHaveLength(1)
    expect(body.filings[0]!.statement).toBe('My detailed buyer statement.')
  })

  it('returns 403 for outsider on GET', async () => {
    const db = new DisputeMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    await db.seedFiling(env, '1', BUYER_ACCOUNT.address.toLowerCase(), 'Private statement.')

    const auth = await authHeader(OUTSIDER_ACCOUNT.address, db)
    const req = new Request('http://localhost/orders/1/disputes', {
      headers: { Authorization: auth },
    })

    const res = await handleDisputeRoutes(req, env, db, chain, '/orders/1/disputes')
    expect(res!.status).toBe(403)
  })
})

// =========================================================================
describe('disputes — GET /api/admin/disputes', () => {
  it('arbiter sees all open filings', async () => {
    const db = new DisputeMemoryDb()
    const env = makeEnv()
    const chain = makeChain()

    await db.seedFiling(env, '1', BUYER_ACCOUNT.address.toLowerCase(), 'Buyer statement text.')
    await db.seedFiling(env, '1', SELLER_ACCOUNT.address.toLowerCase(), 'Seller statement text.')

    const auth = await authHeader(ARBITER_ACCOUNT.address, db)
    const req = new Request('http://localhost/admin/disputes?status=open', {
      headers: { Authorization: auth },
    })

    const res = await handleDisputeRoutes(req, env, db, chain, '/admin/disputes')
    expect(res!.status).toBe(200)
    const body = await res!.json() as { filings: Array<{ statement: string }> }
    expect(body.filings).toHaveLength(2)
    expect(body.filings[0]!.statement).toBe('Buyer statement text.')
    expect(body.filings[1]!.statement).toBe('Seller statement text.')
  })

  it('returns 403 for non-arbiter on admin disputes endpoint', async () => {
    const db = new DisputeMemoryDb()
    const env = makeEnv()
    const chain = makeChain()

    const auth = await authHeader(BUYER_ACCOUNT.address, db)
    const req = new Request('http://localhost/admin/disputes', {
      headers: { Authorization: auth },
    })

    const res = await handleDisputeRoutes(req, env, db, chain, '/admin/disputes')
    expect(res!.status).toBe(403)
  })
})
