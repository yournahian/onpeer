import { describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import type { QueryResultRow } from 'pg'
import { sha256Hex } from '../auth'
import { ORDER_STATUS, type ChainOrder, type ChainReader, type ChainRoles } from '../chain'
import { sealText } from '../crypto'
import type { Queryable } from '../db'
import type { Env, HyperdriveBinding } from '../env'
import { handleChatRoutes } from '../chat'

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
    status: ORDER_STATUS.PENDING,
    createdAt: 1_795_000_000n,
    deadline: 1_795_003_600n,
    paidAt: 0n,
    disputedAt: 0n,
    reviewStartedAt: 0n,
    amount: 10_000000n,
    detailsReady: true,
    detailsHash: ZERO_BYTES32 as `0x${string}`,
    payerProof: ZERO_BYTES32 as `0x${string}`,
    paidLate: false,
    ...overrides,
  }
}

function makeChain(opts?: { order?: ChainOrder | null }): ChainReader {
  const roles = makeDefaultRoles()
  const order = opts?.order !== undefined ? opts.order : makeOrder()
  return {
    getRoles: async () => roles,
    getOrder: async (id: bigint) => (id === 1n ? order : null),
    getAd: async () => null,
    isVerified: async () => false,
  } as unknown as ChainReader
}

interface ChatMsgStore {
  id: string
  order_id: string
  author: string
  body_enc: string
  evidence_blob_id: string | null
  created_at: string
  delete_after: string | null
}

class ChatMemoryDb implements Queryable {
  nowSec = 1_795_000_000
  sessions = new Map<string, { wallet: string; expiresAtSec: number }>()
  rateLimits = new Map<string, { count: number; resetAtSec: number }>()
  chatMessages: ChatMsgStore[] = []
  audits: Array<{ actor: string; action: string; subject: string | null }> = []
  msgIdCounter = 1

  async seedSession(rawToken: string, wallet: string) {
    this.sessions.set(await sha256Hex(rawToken), { wallet, expiresAtSec: this.nowSec + 3600 })
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
      const _maxCount = Number(values[2])
      const existing = this.rateLimits.get(bucket)
      const resetAtSec = existing && existing.resetAtSec > this.nowSec ? existing.resetAtSec : this.nowSec + windowSec
      const count = existing && existing.resetAtSec > this.nowSec ? existing.count + 1 : 1
      this.rateLimits.set(bucket, { count, resetAtSec })
      return { rows: [{ count, reset_at: new Date(resetAtSec * 1000).toISOString() } as unknown as R], rowCount: 1 }
    }

    // Audit log
    if (n.startsWith('INSERT INTO public.audit_log')) {
      this.audits.push({ actor: String(values[0]), action: String(values[1]), subject: values[2] ? String(values[2]) : null })
      return { rows: [], rowCount: 1 }
    }

    // Insert chat message
    if (n.startsWith('INSERT INTO public.chat_messages') && n.includes('RETURNING id')) {
      const id = String(this.msgIdCounter++)
      this.chatMessages.push({
        id,
        order_id: String(values[0]),
        author: String(values[1]),
        body_enc: String(values[2]),
        evidence_blob_id: values[3] ? String(values[3]) : null,
        created_at: new Date().toISOString(),
        delete_after: null,
      })
      return { rows: [{ id } as unknown as R], rowCount: 1 }
    }

    // Select chat messages
    if (n.startsWith('SELECT id, order_id, author, body_enc, evidence_blob_id, created_at FROM public.chat_messages WHERE order_id')) {
      const orderId = String(values[0])
      const afterId = values[1] ? String(values[1]) : null
      let msgs = this.chatMessages.filter((m) => m.order_id === orderId)
      if (afterId) msgs = msgs.filter((m) => Number(m.id) > Number(afterId))
      msgs = msgs.slice(0, 50)
      return { rows: msgs as unknown as R[], rowCount: msgs.length }
    }

    return { rows: [], rowCount: 0 }
  }
}

async function authHeader(wallet: `0x${string}`, db: ChatMemoryDb): Promise<string> {
  const rawToken = wallet.slice(2).toLowerCase().padEnd(64, '0')
  await db.seedSession(rawToken, wallet.toLowerCase())
  return `Bearer ${rawToken}`
}

// =========================================================================
describe('chat — POST /api/orders/:id/chat', () => {
  it('seals and stores a message for an authorized buyer', async () => {
    const db = new ChatMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ body: 'Payment sent! Reference: TXN-001' }),
    })

    const res = await handleChatRoutes(req, env, db, chain, '/orders/1/chat')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(201)
    const body = await res!.json() as { id: string }
    expect(body.id).toBeTruthy()
    // Message was stored encrypted
    expect(db.chatMessages).toHaveLength(1)
    expect(db.chatMessages[0]!.body_enc).not.toBe('Payment sent! Reference: TXN-001')
    expect(db.chatMessages[0]!.body_enc.length).toBeGreaterThan(20)
    expect(db.audits.some((a) => a.action === 'chat.post')).toBe(true)
  })

  it('seals and stores a message for an authorized seller', async () => {
    const db = new ChatMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(SELLER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ body: 'Please include your name as reference.' }),
    })

    const res = await handleChatRoutes(req, env, db, chain, '/orders/1/chat')
    expect(res!.status).toBe(201)
  })

  it('returns 403 for a non-party', async () => {
    const db = new ChatMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(OUTSIDER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ body: 'Hello!' }),
    })

    const res = await handleChatRoutes(req, env, db, chain, '/orders/1/chat')
    expect(res!.status).toBe(403)
  })

  it('returns 400 message_empty for blank message', async () => {
    const db = new ChatMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ body: '   ' }),
    })

    const res = await handleChatRoutes(req, env, db, chain, '/orders/1/chat')
    expect(res!.status).toBe(400)
    expect(await res!.json()).toMatchObject({ error: 'message_empty' })
  })

  it('returns 400 message_too_long for oversized body', async () => {
    const db = new ChatMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ body: 'A'.repeat(5_000) }),
    })

    const res = await handleChatRoutes(req, env, db, chain, '/orders/1/chat')
    expect(res!.status).toBe(400)
    expect(await res!.json()).toMatchObject({ error: 'message_too_long' })
  })
})

// =========================================================================
describe('chat — GET /api/orders/:id/chat', () => {
  async function seedMessage(env: Env, db: ChatMemoryDb, author: string, plaintext: string) {
    const orderIdStr = '1'
    const enc = await sealText(env, plaintext, `chat:${orderIdStr}:${author.toLowerCase()}`)
    const id = String(db.msgIdCounter++)
    db.chatMessages.push({
      id,
      order_id: orderIdStr,
      author: author.toLowerCase(),
      body_enc: enc,
      evidence_blob_id: null,
      created_at: new Date().toISOString(),
      delete_after: null,
    })
    return id
  }

  it('decrypts and returns messages for authorized buyer', async () => {
    const db = new ChatMemoryDb()
    const env = makeEnv()
    await seedMessage(env, db, SELLER_ACCOUNT.address, 'Send to bank account XYZ')
    await seedMessage(env, db, BUYER_ACCOUNT.address, 'Sent! Ref: TXN-001')

    const chain = makeChain()
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/1/chat', {
      headers: { Authorization: auth },
    })

    const res = await handleChatRoutes(req, env, db, chain, '/orders/1/chat')
    expect(res!.status).toBe(200)
    const body = await res!.json() as { orderId: string; messages: Array<{ body: string; author: string }>; hasMore: boolean }
    expect(body.orderId).toBe('1')
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]!.body).toBe('Send to bank account XYZ')
    expect(body.messages[1]!.body).toBe('Sent! Ref: TXN-001')
    expect(body.hasMore).toBe(false)
  })

  it('returns 403 for a non-party', async () => {
    const db = new ChatMemoryDb()
    const env = makeEnv()
    await seedMessage(env, db, SELLER_ACCOUNT.address, 'private message')

    const chain = makeChain()
    const auth = await authHeader(OUTSIDER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/1/chat', {
      headers: { Authorization: auth },
    })

    const res = await handleChatRoutes(req, env, db, chain, '/orders/1/chat')
    expect(res!.status).toBe(403)
  })

  it('returns 404 for unknown order', async () => {
    const db = new ChatMemoryDb()
    const env = makeEnv()
    const chain = makeChain({ order: null })
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const req = new Request('http://localhost/orders/99/chat', {
      headers: { Authorization: auth },
    })

    const res = await handleChatRoutes(req, env, db, chain, '/orders/99/chat')
    expect(res!.status).toBe(404)
  })

  it('supports pagination via after= query parameter', async () => {
    const db = new ChatMemoryDb()
    const env = makeEnv()
    const id1 = await seedMessage(env, db, SELLER_ACCOUNT.address, 'First')
    await seedMessage(env, db, BUYER_ACCOUNT.address, 'Second')

    const chain = makeChain()
    const auth = await authHeader(SELLER_ACCOUNT.address, db)

    const req = new Request(`http://localhost/orders/1/chat?after=${id1}`, {
      headers: { Authorization: auth },
    })

    const res = await handleChatRoutes(req, env, db, chain, '/orders/1/chat')
    expect(res!.status).toBe(200)
    const body = await res!.json() as { messages: Array<{ body: string }> }
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]!.body).toBe('Second')
  })
})
