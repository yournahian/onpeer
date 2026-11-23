import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import { sha256Hex } from '../auth'
import { ORDER_STATUS, type ChainOrder, type ChainReader } from '../chain'
import type { Queryable } from '../db'
import type { Env } from '../env'
import { handleSocialRoutes } from '../social'

const BUYER = '0x1111111111111111111111111111111111111111' as const
const SELLER = '0x2222222222222222222222222222222222222222' as const
const OUTSIDER = '0x3333333333333333333333333333333333333333' as const

const BUYER_TOK = '1'.repeat(64)
const SELLER_TOK = '2'.repeat(64)
const OUTSIDER_TOK = '3'.repeat(64)

class SocialMemoryDb implements Queryable {
  nowMs = 1_795_500_000_000
  sessions = new Map<string, { wallet: string; expiresAtMs: number }>()
  accounts = new Map<
    string,
    {
      wallet: string
      display_name: string | null
      country: string | null
      email_verified_at: string | null
      kyc_status: string
      created_at: string
      deleted_at: string | null
    }
  >()
  feedback: Array<{
    id: number
    order_id: string
    from_wallet: string
    to_wallet: string
    rating: number
    positive: boolean
    comment: string
    anonymous: boolean
    created_at: string
  }> = []
  relations: Array<{ actor: string; target: string; kind: 'follow' | 'block'; created_at: string }> = []
  rateLimits = new Map<string, { count: number; resetAtMs: number }>()
  nextFbId = 1

  async seedSession(rawToken: string, wallet: string) {
    this.sessions.set(await sha256Hex(rawToken), {
      wallet,
      expiresAtMs: this.nowMs + 3_600_000,
    })
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: R[]; rowCount: number | null }> {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n.startsWith('INSERT INTO public.rate_limits')) {
      const bucket = String(values[0])
      const cur = (this.rateLimits.get(bucket)?.count ?? 0) + 1
      this.rateLimits.set(bucket, { count: cur, resetAtMs: this.nowMs + 60_000 })
      return { rows: [{ count: cur } as unknown as R], rowCount: 1 }
    }

    if (n.startsWith('SELECT wallet FROM public.sessions')) {
      const s = this.sessions.get(String(values[0]))
      if (!s || s.expiresAtMs <= this.nowMs) return { rows: [], rowCount: 0 }
      return { rows: [{ wallet: s.wallet } as unknown as R], rowCount: 1 }
    }

    if (n.startsWith('SELECT wallet, display_name, country, email_verified_at, kyc_status, created_at FROM public.accounts')) {
      const wallets = values.map((v) => String(v).toLowerCase())
      const rows = wallets
        .map((w) => this.accounts.get(w))
        .filter((a): a is NonNullable<typeof a> => !!a && a.deleted_at === null)
      return { rows: rows as unknown as R[], rowCount: rows.length }
    }

    if (n.startsWith('SELECT to_wallet, COUNT(*) FILTER')) {
      const wallets = new Set(values.map((v) => String(v).toLowerCase()))
      const grouped = new Map<string, { pos: number; neg: number; total: number; sumRating: number }>()
      for (const f of this.feedback) {
        if (!wallets.has(f.to_wallet)) continue
        const cur = grouped.get(f.to_wallet) ?? { pos: 0, neg: 0, total: 0, sumRating: 0 }
        cur.total++
        if (f.positive) cur.pos++
        else cur.neg++
        cur.sumRating += f.rating
        grouped.set(f.to_wallet, cur)
      }
      const rows = Array.from(grouped.entries()).map(([to_wallet, g]) => ({
        to_wallet,
        positive_cnt: g.pos,
        negative_cnt: g.neg,
        total_cnt: g.total,
        avg_rating: Number((g.sumRating / g.total).toFixed(2)),
      }))
      return { rows: rows as unknown as R[], rowCount: rows.length }
    }

    if (n.startsWith('SELECT w.wallet, COALESCE((SELECT COUNT(*)::int FROM public.p2p_relations')) {
      const wallets = values.map((v) => String(v).toLowerCase())
      const rows = wallets.map((w) => ({
        wallet: w,
        followers_cnt: this.relations.filter((r) => r.target === w && r.kind === 'follow').length,
        following_cnt: this.relations.filter((r) => r.actor === w && r.kind === 'follow').length,
      }))
      return { rows: rows as unknown as R[], rowCount: rows.length }
    }

    if (n.includes('FROM public.p2p_feedback f') && n.includes('WHERE f.to_wallet = $1')) {
      const target = String(values[0]).toLowerCase()
      const rows = this.feedback
        .filter((f) => f.to_wallet === target)
        .map((f) => ({
          ...f,
          from_display_name: this.accounts.get(f.from_wallet)?.display_name ?? null,
        }))
      return { rows: rows as unknown as R[], rowCount: rows.length }
    }

    if (n.includes('FROM public.p2p_feedback f') && n.includes('WHERE f.order_id = $1')) {
      const orderId = String(values[0])
      const rows = this.feedback
        .filter((f) => f.order_id === orderId)
        .map((f) => ({
          ...f,
          from_display_name: this.accounts.get(f.from_wallet)?.display_name ?? null,
        }))
      return { rows: rows as unknown as R[], rowCount: rows.length }
    }

    if (n.startsWith('INSERT INTO public.p2p_feedback')) {
      const [order_id, from_wallet, to_wallet, rating, positive, comment, anonymous] = values as [
        string,
        string,
        string,
        number,
        boolean,
        string,
        boolean,
      ]
      const existing = this.feedback.find(
        (f) => f.order_id === order_id && f.from_wallet === from_wallet,
      )
      if (existing) {
        existing.rating = rating
        existing.positive = positive
        existing.comment = comment
        existing.anonymous = anonymous
      } else {
        this.feedback.push({
          id: this.nextFbId++,
          order_id,
          from_wallet,
          to_wallet,
          rating,
          positive,
          comment,
          anonymous,
          created_at: new Date(this.nowMs).toISOString(),
        })
      }
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('SELECT kind FROM public.p2p_relations WHERE actor = $1 AND target = $2')) {
      const [actor, target] = values.map((v) => String(v).toLowerCase())
      const rows = this.relations
        .filter((r) => r.actor === actor && r.target === target)
        .map((r) => ({ kind: r.kind }))
      return { rows: rows as unknown as R[], rowCount: rows.length }
    }

    if (n.startsWith('SELECT target, kind FROM public.p2p_relations WHERE actor = $1')) {
      const actor = String(values[0]).toLowerCase()
      const rows = this.relations
        .filter((r) => r.actor === actor)
        .map((r) => ({ target: r.target, kind: r.kind }))
      return { rows: rows as unknown as R[], rowCount: rows.length }
    }

    if (n.startsWith('INSERT INTO public.p2p_relations')) {
      const [actor, target, kind] = values as [string, string, 'follow' | 'block']
      if (!this.relations.some((r) => r.actor === actor && r.target === target && r.kind === kind)) {
        this.relations.push({
          actor,
          target,
          kind,
          created_at: new Date(this.nowMs).toISOString(),
        })
      }
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith("DELETE FROM public.p2p_relations WHERE actor = $1 AND target = $2 AND kind = 'follow'")) {
      const [actor, target] = values.map((v) => String(v).toLowerCase())
      this.relations = this.relations.filter(
        (r) => !(r.actor === actor && r.target === target && r.kind === 'follow'),
      )
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('DELETE FROM public.p2p_relations WHERE actor = $1 AND target = $2 AND kind = $3')) {
      const [actor, target, kind] = values as [string, string, 'follow' | 'block']
      this.relations = this.relations.filter(
        (r) => !(r.actor === actor && r.target === target && r.kind === kind),
      )
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.audit_log')) {
      return { rows: [], rowCount: 1 }
    }

    throw new Error(`Unhandled SQL in SocialMemoryDb: ${n}`)
  }
}

function makeEnv(): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') },
    SESSION_SECRET: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    VAULT_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  }
}

function makeChain(ordersById: Map<string, ChainOrder>): ChainReader {
  return {
    getRoles: async () => ({
      owner: BUYER,
      arbiter: BUYER,
      backupArbiter: BUYER,
      verifier: BUYER,
      kycRequired: false,
      sealedEnabled: false,
      payerProofRequired: false,
    }),
    getOrder: async (id: bigint) => ordersById.get(id.toString()) ?? null,
    isVerified: async () => false,
    getOpenOrderCount: async () => 0n,
    getUserAdIds: async () => [],
    getAd: async () => null,
  }
}

function makeOrder(id: bigint, status: number): ChainOrder {
  return {
    id,
    adId: 1n,
    buyer: BUYER,
    seller: SELLER,
    taker: BUYER,
    status,
    createdAt: 1_795_000_000n,
    deadline: 1_795_000_900n,
    paidAt: 1_795_000_300n,
    disputedAt: 0n,
    reviewStartedAt: 0n,
    amount: 50_000_000n,
    detailsReady: true,
    detailsHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
    payerProof: ('0x' + '00'.repeat(32)) as `0x${string}`,
    paidLate: false,
  }
}

describe('P2P Social Profiles, Follow/Block Relations & Post-Trade Feedback', () => {
  it('returns public Display Aliases, enforces completed-order participant check on feedback, and masks anonymous reviews', async () => {
    const db = new SocialMemoryDb()
    await db.seedSession(BUYER_TOK, BUYER)
    await db.seedSession(SELLER_TOK, SELLER)
    await db.seedSession(OUTSIDER_TOK, OUTSIDER)

    db.accounts.set(SELLER, {
      wallet: SELLER,
      display_name: 'AL-AMIN_TRADER',
      country: 'BD',
      email_verified_at: '2026-01-01T00:00:00.000Z',
      kyc_status: 'approved',
      created_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
    })
    db.accounts.set(BUYER, {
      wallet: BUYER,
      display_name: 'nyx0y',
      country: 'BD',
      email_verified_at: '2026-01-02T00:00:00.000Z',
      kyc_status: 'none',
      created_at: '2026-01-02T00:00:00.000Z',
      deleted_at: null,
    })

    const orders = new Map<string, ChainOrder>([
      ['10', makeOrder(10n, ORDER_STATUS.PENDING)],
      ['11', makeOrder(11n, ORDER_STATUS.COMPLETED)],
    ])
    const chain = makeChain(orders)
    const env = makeEnv()

    // 1. Rejects feedback on PENDING order (400 order_not_completed)
    const pendingFb = await handleSocialRoutes(
      new Request('https://app.onpeer.xyz/api/orders/10/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${BUYER_TOK}` },
        body: JSON.stringify({ rating: 5, positive: true, comment: 'Too early' }),
      }),
      env,
      db,
      chain,
      '/orders/10/feedback',
    )
    expect(pendingFb?.status).toBe(400)
    expect(await pendingFb!.json()).toEqual({ error: 'order_not_completed' })

    // 2. Rejects outsider on COMPLETED order (403 forbidden)
    const outsiderFb = await handleSocialRoutes(
      new Request('https://app.onpeer.xyz/api/orders/11/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${OUTSIDER_TOK}` },
        body: JSON.stringify({ rating: 1, positive: false, comment: 'Spam' }),
      }),
      env,
      db,
      chain,
      '/orders/11/feedback',
    )
    expect(outsiderFb?.status).toBe(403)

    // 3. Buyer submits anonymous 5-star positive review for Seller on completed order #11
    const okFb = await handleSocialRoutes(
      new Request('https://app.onpeer.xyz/api/orders/11/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${BUYER_TOK}` },
        body: JSON.stringify({
          rating: 5,
          positive: true,
          comment: 'Super fast bKash release!',
          anonymous: true,
        }),
      }),
      env,
      db,
      chain,
      '/orders/11/feedback',
    )
    expect(okFb?.status).toBe(200)

    // 4. Batch profiles endpoint returns Display Alias + 100% positive rating
    const batchRes = await handleSocialRoutes(
      new Request(`https://app.onpeer.xyz/api/p2p/profiles?wallets=${SELLER},${BUYER}`),
      env,
      db,
      chain,
      '/p2p/profiles',
    )
    expect(batchRes?.status).toBe(200)
    const batchJson = (await batchRes!.json()) as {
      profiles: Record<string, { displayName: string; positivePct: number; avgRating: number; kycApproved: boolean }>
    }
    expect(batchJson.profiles[SELLER]?.displayName).toBe('AL-AMIN_TRADER')
    expect(batchJson.profiles[SELLER]?.positivePct).toBe(100)
    expect(batchJson.profiles[SELLER]?.avgRating).toBe(5)
    expect(batchJson.profiles[SELLER]?.kycApproved).toBe(true)

    // 5. Public viewer sees masked anonymous reviewer on Seller's profile
    const detailRes = await handleSocialRoutes(
      new Request(`https://app.onpeer.xyz/api/p2p/profile/${SELLER}`),
      env,
      db,
      chain,
      `/p2p/profile/${SELLER}`,
    )
    expect(detailRes?.status).toBe(200)
    const detailJson = (await detailRes!.json()) as {
      feedback: Array<{ fromDisplayName: string; fromWallet: string; comment: string }>
    }
    expect(detailJson.feedback).toHaveLength(1)
    expect(detailJson.feedback[0]?.fromDisplayName).toBe('Anonymous Trader')
    expect(detailJson.feedback[0]?.fromWallet).not.toBe(BUYER)
    expect(detailJson.feedback[0]?.comment).toBe('Super fast bKash release!')
  })

  it('manages follow & block relations and automatically unfollows when blocking', async () => {
    const db = new SocialMemoryDb()
    await db.seedSession(BUYER_TOK, BUYER)
    const chain = makeChain(new Map())
    const env = makeEnv()

    // Follow seller
    const followRes = await handleSocialRoutes(
      new Request('https://app.onpeer.xyz/api/p2p/relations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${BUYER_TOK}` },
        body: JSON.stringify({ target: SELLER, kind: 'follow', active: true }),
      }),
      env,
      db,
      chain,
      '/p2p/relations',
    )
    expect(followRes?.status).toBe(200)

    // Blocking seller automatically drops the follow relation
    const blockRes = await handleSocialRoutes(
      new Request('https://app.onpeer.xyz/api/p2p/relations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${BUYER_TOK}` },
        body: JSON.stringify({ target: SELLER, kind: 'block', active: true }),
      }),
      env,
      db,
      chain,
      '/p2p/relations',
    )
    expect(blockRes?.status).toBe(200)

    const listRes = await handleSocialRoutes(
      new Request('https://app.onpeer.xyz/api/p2p/relations', {
        headers: { authorization: `Bearer ${BUYER_TOK}` },
      }),
      env,
      db,
      chain,
      '/p2p/relations',
    )
    const relJson = (await listRes!.json()) as {
      following: Array<{ wallet: string }>
      blocked: Array<{ wallet: string }>
    }
    expect(relJson.following).toHaveLength(0)
    expect(relJson.blocked).toHaveLength(1)
    expect(relJson.blocked[0]?.wallet).toBe(SELLER)
  })
})
