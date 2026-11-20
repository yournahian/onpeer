import { describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import type { QueryResultRow } from 'pg'
import { sha256Hex } from '../auth'
import { ORDER_STATUS, type ChainAd, type ChainOrder, type ChainReader, type ChainRoles } from '../chain'
import { sealBlob } from '../crypto'
import type { Queryable } from '../db'
import type { Env, HyperdriveBinding } from '../env'
import { handleVaultRoutes } from '../vault'

// ---- Accounts -----------------------------------------------------------
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
const FAKE_DETAILS_HASH = '0xdeadbeef00000000000000000000000000000000000000000000000000000001'

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
    sealedEnabled: true,
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

function makeAd(overrides?: Partial<ChainAd>): ChainAd {
  return {
    id: 1n,
    maker: SELLER_ACCOUNT.address.toLowerCase() as `0x${string}`,
    side: 1,
    paused: false,
    closed: false,
    expiresAt: 1_800_000_000n,
    detailsMode: 2,
    detailsHash: FAKE_DETAILS_HASH as `0x${string}`,
    ...overrides,
  }
}

function makeChain(opts?: { order?: ChainOrder | null; ad?: ChainAd | null; roles?: ChainRoles }): ChainReader {
  const roles = opts?.roles ?? makeDefaultRoles()
  const order = opts?.order !== undefined ? opts.order : makeOrder()
  const ad = opts?.ad !== undefined ? opts.ad : makeAd()

  return {
    getRoles: async () => roles,
    getOrder: async (id: bigint) => (id === 1n ? order : null),
    getAd: async (id: bigint) => (id === 1n ? ad : null),
    isVerified: async () => false,
    getOpenOrderCount: async () => 0n,
    getUserAdIds: async () => [],
  }
}

// ---- In-memory DB -------------------------------------------------------
interface VaultBlobStore {
  id: string
  kind: string
  ad_id: string | null
  order_id: string | null
  author: string
  ciphertext: Buffer
  wrapped_key: Buffer
  content_hash: string
  size: number
  delete_after: Date | null
  created_at: Date
}

class VaultMemoryDb implements Queryable {
  nowSec = 1_795_000_000
  sessions = new Map<string, { wallet: string; expiresAtSec: number }>()
  rateLimits = new Map<string, { count: number; resetAtSec: number }>()
  blobs: VaultBlobStore[] = []
  audits: Array<{ actor: string; action: string; subject: string | null }> = []
  accounts = new Map<string, { kyc_status: string; kyc_name_enc: string | null }>()
  blobIdCounter = 1

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
      return {
        rows: [{ wallet: sess.wallet } as unknown as R],
        rowCount: 1,
      }
    }

    // Rate limits
    if (n.startsWith('INSERT INTO public.rate_limits') && n.includes('ON CONFLICT (bucket) DO UPDATE')) {
      const bucket = String(values[0])
      const windowSec = Number(values[1])
      const _maxCount = Number(values[2])
      const existing = this.rateLimits.get(bucket)
      const resetAtSec = existing && existing.resetAtSec > this.nowSec
        ? existing.resetAtSec
        : this.nowSec + windowSec
      const count = existing && existing.resetAtSec > this.nowSec ? existing.count + 1 : 1
      this.rateLimits.set(bucket, { count, resetAtSec })
      return { rows: [{ count, reset_at: new Date(resetAtSec * 1000).toISOString() } as unknown as R], rowCount: 1 }
    }

    // Audit log
    if (n.startsWith('INSERT INTO public.audit_log')) {
      this.audits.push({ actor: String(values[0]), action: String(values[1]), subject: values[2] ? String(values[2]) : null })
      return { rows: [], rowCount: 1 }
    }

    // Insert vault blob — for /vault/details (kind, author, ciphertext, wrapped_key, content_hash, size, delete_after)
    if (n.startsWith('INSERT INTO public.vault_blobs') && n.includes('RETURNING id') && !n.startsWith("INSERT INTO public.vault_blobs ( kind, order_id,")) {
      const id = `a1b2c3d4-e5f6-7890-abcd-${String(this.blobIdCounter++).padStart(12, '0')}`
      this.blobs.push({
        id,
        kind: String(values[0]),
        author: String(values[1]),
        ciphertext: values[2] as Buffer,
        wrapped_key: values[3] as Buffer,
        content_hash: String(values[4]),
        size: Number(values[5]),
        delete_after: null,
        ad_id: null,
        order_id: null,
        created_at: new Date(),
      })
      return { rows: [{ id } as unknown as R], rowCount: 1 }
    }

    // Insert vault blob — for /vault/payer (kind hardcoded as 'payer', order_id=$1, author=$2, ...)
    if (n.startsWith("INSERT INTO public.vault_blobs") && n.includes("'payer'") && n.includes('RETURNING id')) {
      const id = `a1b2c3d4-e5f6-7890-abcd-${String(this.blobIdCounter++).padStart(12, '0')}`
      this.blobs.push({
        id,
        kind: 'payer',
        order_id: String(values[0]),
        author: String(values[1]),
        ciphertext: values[2] as Buffer,
        wrapped_key: values[3] as Buffer,
        content_hash: String(values[4]),
        size: Number(values[5]),
        delete_after: null,
        ad_id: null,
        created_at: new Date(),
      })
      return { rows: [{ id } as unknown as R], rowCount: 1 }
    }

    // Update vault blob — bind-ad (kind='ad_details')
    if (n.startsWith('UPDATE public.vault_blobs') && n.includes("kind = 'ad_details'")) {
      const blobId = String(values[0])
      const author = String(values[1])
      const adId = String(values[2])
      const contentHash = String(values[4])
      const idx = this.blobs.findIndex(
        (b) => b.id === blobId && b.author === author && b.kind === 'ad_details' && b.content_hash === contentHash,
      )
      if (idx === -1) return { rows: [], rowCount: 0 }
      this.blobs[idx]!.ad_id = adId
      return { rows: [], rowCount: 1 }
    }

    // Update vault blob — extend retention (order vault GET uses GREATEST/COALESCE)
    if (n.startsWith('UPDATE public.vault_blobs') && n.includes('GREATEST(COALESCE')) {
      const blobId = String(values[0])
      const idx = this.blobs.findIndex((b) => b.id === blobId)
      if (idx !== -1) {
        this.blobs[idx]!.order_id = String(values[1])
        if (!this.blobs[idx]!.ad_id) this.blobs[idx]!.ad_id = String(values[2])
      }
      return { rows: [], rowCount: 1 }
    }

    // Insert vault blob — payer (sealed payer proof)
    if (n.startsWith('UPDATE public.vault_blobs')) {
      return { rows: [], rowCount: 0 }
    }

    // SELECT vault blob by content_hash + author
    if (n.startsWith('SELECT id, kind, ad_id, order_id, author, ciphertext, wrapped_key, content_hash, size FROM public.vault_blobs WHERE content_hash')) {
      const contentHash = String(values[0]).toLowerCase()
      const author = String(values[1]).toLowerCase()
      const blob = this.blobs.find(
        (b) => b.content_hash.toLowerCase() === contentHash && b.author.toLowerCase() === author,
      )
      if (!blob) return { rows: [], rowCount: 0 }
      return { rows: [blob as unknown as R], rowCount: 1 }
    }

    // accounts lookup (for verifyCounterpartyName)
    if (n.startsWith('SELECT kyc_status, kyc_level, kyc_expires_at, kyc_name_enc')) {
      const wallet = String(values[0]).toLowerCase()
      const acc = this.accounts.get(wallet)
      if (!acc) return { rows: [], rowCount: 0 }
      return {
        rows: [{ kyc_status: acc.kyc_status, kyc_level: 2, kyc_expires_at: null, kyc_name_enc: acc.kyc_name_enc, consent_at: null, deleted_at: null } as unknown as R],
        rowCount: 1,
      }
    }

    return { rows: [], rowCount: 0 }
  }
}

// ---- Helpers ------------------------------------------------------------
async function authHeader(wallet: `0x${string}`, db: VaultMemoryDb): Promise<string> {
  // Must be exactly 64 lowercase hex chars (enforced by getSession regex)
  const rawToken = wallet.slice(2).toLowerCase().padEnd(64, '0')
  await db.seedSession(rawToken, wallet.toLowerCase())
  return `Bearer ${rawToken}`
}

function vaultPost(path: string, body: unknown, auth: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(body),
  })
}

function vaultGet(path: string, auth: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { Authorization: auth },
  })
}

// =========================================================================
describe('vault — POST /api/vault/details (seal ad_details)', () => {
  it('seals a valid ad_details payload and returns id + contentHash', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(SELLER_ACCOUNT.address, db)

    const req = vaultPost('/vault/details', {
      kind: 'ad_details',
      holderName: 'Test Holder',
      accountDetails: 'BDT account: 01711000000',
      notes: 'Send via bKash',
    }, auth)

    const res = await handleVaultRoutes(req, env, db, chain, '/vault/details')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const body = await res!.json() as { id: string; contentHash: string }
    expect(body.id).toBeTruthy()
    expect(body.contentHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(db.blobs).toHaveLength(1)
    expect(db.blobs[0]!.kind).toBe('ad_details')
    expect(db.blobs[0]!.content_hash).toBe(body.contentHash)
    expect(db.audits.some((a) => a.action === 'vault.seal.ad_details')).toBe(true)
  })

  it('rejects holderName shorter than 2 chars', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(SELLER_ACCOUNT.address, db)

    const res = await handleVaultRoutes(
      vaultPost('/vault/details', { kind: 'ad_details', holderName: 'X', accountDetails: 'some account' }, auth),
      env, db, chain, '/vault/details',
    )
    expect(res!.status).toBe(400)
    expect(await res!.json()).toMatchObject({ error: 'invalid_vault_payload' })
  })

  it('returns 401 without a valid session', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const chain = makeChain()

    const res = await handleVaultRoutes(
      vaultPost('/vault/details', { kind: 'ad_details', holderName: 'Test', accountDetails: 'acct' }, 'Bearer bad'),
      env, db, chain, '/vault/details',
    )
    expect(res!.status).toBe(401)
  })

  it('seals order_details kind correctly', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const chain = makeChain()
    const auth = await authHeader(SELLER_ACCOUNT.address, db)

    const res = await handleVaultRoutes(
      vaultPost('/vault/details', { kind: 'order_details', holderName: 'Ahmed Ali', accountDetails: 'PKR 03001234567' }, auth),
      env, db, chain, '/vault/details',
    )
    expect(res!.status).toBe(200)
    expect(db.blobs[0]!.kind).toBe('order_details')
  })
})

// =========================================================================
describe('vault — POST /api/vault/bind-ad', () => {
  it('binds a sealed ad_details blob to its mined adId when hash matches', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    // Seal first
    const auth = await authHeader(SELLER_ACCOUNT.address, db)
    const sealRes = await handleVaultRoutes(
      vaultPost('/vault/details', { kind: 'ad_details', holderName: 'Test Holder', accountDetails: 'BDT 01711000000' }, auth),
      env, db, makeChain(), '/vault/details',
    )
    const { id: blobId } = await sealRes!.json() as { id: string; contentHash: string }

    // Force hash match to what the ad's detailsHash reports
    db.blobs[0]!.content_hash = FAKE_DETAILS_HASH

    const auth2 = await authHeader(SELLER_ACCOUNT.address, db)
    const bindRes = await handleVaultRoutes(
      vaultPost('/vault/bind-ad', { blobId, adId: 1 }, auth2),
      env, db, makeChain(), '/vault/bind-ad',
    )
    expect(bindRes!.status).toBe(200)
    expect(await bindRes!.json()).toMatchObject({ ok: true })
    expect(db.blobs[0]!.ad_id).toBe('1')
    expect(db.audits.some((a) => a.action === 'vault.bind_ad')).toBe(true)
  })

  it('returns 403 when non-maker tries to bind', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    // Insert a blob owned by seller with a valid UUID id
    db.blobs.push({
      id: 'a1b2c3d4-e5f6-7890-abcd-999999999999',
      kind: 'ad_details',
      ad_id: null,
      order_id: null,
      author: SELLER_ACCOUNT.address.toLowerCase(),
      ciphertext: Buffer.alloc(32),
      wrapped_key: Buffer.alloc(32),
      content_hash: FAKE_DETAILS_HASH,
      size: 32,
      delete_after: null,
      created_at: new Date(),
    })

    // Buyer tries to bind — maker check happens before DB lookup
    const auth = await authHeader(BUYER_ACCOUNT.address, db)
    const res = await handleVaultRoutes(
      vaultPost('/vault/bind-ad', { blobId: 'a1b2c3d4-e5f6-7890-abcd-999999999999', adId: 1 }, auth),
      env, db, makeChain(), '/vault/bind-ad',
    )
    expect(res!.status).toBe(403)
  })

  it('returns 400 for malformed blobId', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const auth = await authHeader(SELLER_ACCOUNT.address, db)

    const res = await handleVaultRoutes(
      vaultPost('/vault/bind-ad', { blobId: 'not-a-uuid!@#', adId: 1 }, auth),
      env, db, makeChain(), '/vault/bind-ad',
    )
    expect(res!.status).toBe(400)
  })
})

// =========================================================================
describe('vault — GET /api/orders/:id/vault (decrypt order vault)', () => {
  async function seedSellerDetails(env: Env, db: VaultMemoryDb): Promise<`0x${string}`> {
    const sellerPlain = JSON.stringify({
      holderName: 'Tariq Rahman',
      accountDetails: 'BDT 01711000000 bKash',
      notes: '',
    })
    const sellerBytes = new TextEncoder().encode(sellerPlain)
    const sealed = await sealBlob(env, sellerBytes, `vault:ad_details:${SELLER_ACCOUNT.address.toLowerCase()}`)
    // Use the sealed contentHash as BOTH the blob's content_hash AND the order's detailsHash
    db.blobs.push({
      id: 'a1b2c3d4-e5f6-7890-abcd-seller00blob',
      kind: 'ad_details',
      ad_id: '1',
      order_id: null,
      author: SELLER_ACCOUNT.address.toLowerCase(),
      ciphertext: Buffer.from(sealed.ciphertext),
      wrapped_key: Buffer.from(sealed.wrappedKey),
      content_hash: sealed.contentHash.toLowerCase(),
      size: sealed.size,
      delete_after: null,
      created_at: new Date(),
    })
    return sealed.contentHash as `0x${string}`
  }

  it('returns decrypted seller details to authorized seller', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const hash = await seedSellerDetails(env, db)

    const chain = makeChain({ order: makeOrder({ status: ORDER_STATUS.PENDING, detailsHash: hash }) })
    const auth = await authHeader(SELLER_ACCOUNT.address, db)

    const res = await handleVaultRoutes(vaultGet('/orders/1/vault', auth), env, db, chain, '/orders/1/vault')
    expect(res!.status).toBe(200)
    const body = await res!.json() as { viewerRole: string; sellerDetails: { holderName: string; accountDetails: string }; buyerPayer: null }
    expect(body.viewerRole).toBe('seller')
    expect(body.sellerDetails).not.toBeNull()
    expect(body.sellerDetails.holderName).toBe('Tariq Rahman')
    expect(body.sellerDetails.accountDetails).toBe('BDT 01711000000 bKash')
    expect(body.buyerPayer).toBeNull()
  })

  it('returns decrypted seller details to authorized buyer', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const hash = await seedSellerDetails(env, db)

    const chain = makeChain({ order: makeOrder({ status: ORDER_STATUS.PENDING, detailsHash: hash }) })
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const res = await handleVaultRoutes(vaultGet('/orders/1/vault', auth), env, db, chain, '/orders/1/vault')
    expect(res!.status).toBe(200)
    const body = await res!.json() as { viewerRole: string; sellerDetails: { holderName: string } }
    expect(body.viewerRole).toBe('buyer')
    expect(body.sellerDetails.holderName).toBe('Tariq Rahman')
  })

  it('returns 403 to an outsider (non-party)', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const hash = await seedSellerDetails(env, db)

    const chain = makeChain({ order: makeOrder({ detailsHash: hash }) })
    const auth = await authHeader(OUTSIDER_ACCOUNT.address, db)

    const res = await handleVaultRoutes(vaultGet('/orders/1/vault', auth), env, db, chain, '/orders/1/vault')
    expect(res!.status).toBe(403)
  })

  it('returns null sellerDetails + null buyerPayer in plain mode (zero hashes)', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const chain = makeChain({ order: makeOrder({ detailsHash: ZERO_BYTES32 as `0x${string}`, payerProof: ZERO_BYTES32 as `0x${string}` }) })
    const auth = await authHeader(SELLER_ACCOUNT.address, db)

    const res = await handleVaultRoutes(vaultGet('/orders/1/vault', auth), env, db, chain, '/orders/1/vault')
    expect(res!.status).toBe(200)
    const body = await res!.json() as { sellerDetails: null; buyerPayer: null }
    expect(body.sellerDetails).toBeNull()
    expect(body.buyerPayer).toBeNull()
  })
})

// =========================================================================
describe('vault — POST /api/vault/payer (seal payer proof)', () => {
  it('seals a valid payer payload (buyer, PENDING order)', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const chain = makeChain({ order: makeOrder({ status: ORDER_STATUS.PENDING }) })
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const res = await handleVaultRoutes(
      vaultPost('/vault/payer', { orderId: 1, transferId: 'TXN-20241120-001', senderName: 'John Doe', last4: '1234' }, auth),
      env, db, chain, '/vault/payer',
    )
    expect(res!.status).toBe(200)
    const body = await res!.json() as { contentHash: string }
    expect(body.contentHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(db.blobs[0]!.kind).toBe('payer')
    expect(db.audits.some((a) => a.action === 'vault.seal.payer')).toBe(true)
  })

  it('returns 403 when seller tries to seal payer proof', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const chain = makeChain({ order: makeOrder({ status: ORDER_STATUS.PENDING }) })
    const auth = await authHeader(SELLER_ACCOUNT.address, db)

    const res = await handleVaultRoutes(
      vaultPost('/vault/payer', { orderId: 1, senderName: 'Jane Doe' }, auth),
      env, db, chain, '/vault/payer',
    )
    expect(res!.status).toBe(403)
  })

  it('returns 400 invalid_order_status when order is not PENDING', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const chain = makeChain({ order: makeOrder({ status: ORDER_STATUS.PAID }) })
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const res = await handleVaultRoutes(
      vaultPost('/vault/payer', { orderId: 1, senderName: 'John Doe' }, auth),
      env, db, chain, '/vault/payer',
    )
    expect(res!.status).toBe(400)
    expect(await res!.json()).toMatchObject({ error: 'invalid_order_status' })
  })

  it('returns 400 invalid_vault_payload for bad last4 (non-digits)', async () => {
    const db = new VaultMemoryDb()
    const env = makeEnv()
    const chain = makeChain({ order: makeOrder({ status: ORDER_STATUS.PENDING }) })
    const auth = await authHeader(BUYER_ACCOUNT.address, db)

    const res = await handleVaultRoutes(
      vaultPost('/vault/payer', { orderId: 1, senderName: 'John Doe', last4: 'ABCD' }, auth),
      env, db, chain, '/vault/payer',
    )
    expect(res!.status).toBe(400)
    expect(await res!.json()).toMatchObject({ error: 'invalid_vault_payload' })
  })
})
