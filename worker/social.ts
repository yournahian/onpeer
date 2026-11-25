import { getSession, requireSession } from './auth'
import { ORDER_STATUS, type ChainReader } from './chain'
import { checkRateLimit, writeAudit, type Queryable } from './db'
import { clientIp, json, normalizeWallet, readJsonBody, type Env } from './env'

const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/

export interface PublicTraderSummary {
  wallet: `0x${string}`
  displayName: string | null
  country: string | null
  emailVerified: boolean
  kycApproved: boolean
  joinedAt: string | null
  followersCount: number
  followingCount: number
  positiveCount: number
  negativeCount: number
  totalFeedback: number
  positivePct: number | null
  avgRating: number | null
}

export interface FeedbackItemOut {
  id: string
  orderId: string
  fromWallet: string
  fromDisplayName: string | null
  toWallet: string
  rating: number
  positive: boolean
  comment: string
  anonymous: boolean
  createdAt: string
}

interface RawProfileRow {
  wallet: string
  display_name: string | null
  country: string | null
  email_verified_at: string | Date | null
  kyc_status: string
  created_at: string | Date | null
}

interface RawFeedbackAggRow {
  to_wallet: string
  positive_cnt: string | number
  negative_cnt: string | number
  total_cnt: string | number
  avg_rating: string | number | null
}

interface RawRelAggRow {
  wallet: string
  followers_cnt: string | number
  following_cnt: string | number
}

interface RawFeedbackRow {
  id: string | number
  order_id: string | number
  from_wallet: string
  from_display_name: string | null
  to_wallet: string
  rating: number
  positive: boolean
  comment: string
  anonymous: boolean
  created_at: string | Date
}

function toIso(v: string | Date | null | undefined): string | null {
  if (!v) return null
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString()
}

function maskAnonWallet(w: string): string {
  return `${w.slice(0, 4)}***${w.slice(-3)}`
}

async function buildSummaries(
  db: Queryable,
  wallets: `0x${string}`[],
): Promise<Record<string, PublicTraderSummary>> {
  const unique = Array.from(new Set(wallets.map((w) => w.toLowerCase() as `0x${string}`))).slice(0, 100)
  const out: Record<string, PublicTraderSummary> = {}
  if (unique.length === 0) return out

  for (const w of unique) {
    out[w] = {
      wallet: w,
      displayName: null,
      country: null,
      emailVerified: false,
      kycApproved: false,
      joinedAt: null,
      followersCount: 0,
      followingCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      totalFeedback: 0,
      positivePct: null,
      avgRating: null,
    }
  }

  const placeholders = unique.map((_, i) => `$${i + 1}`).join(', ')

  const [acctRes, fbRes, relRes] = await Promise.all([
    db.query<RawProfileRow>(
      `SELECT wallet, display_name, country, email_verified_at, kyc_status, created_at
         FROM public.accounts
        WHERE wallet IN (${placeholders})
          AND deleted_at IS NULL`,
      unique,
    ),
    db.query<RawFeedbackAggRow>(
      `SELECT to_wallet,
              COUNT(*) FILTER (WHERE positive = true)::int AS positive_cnt,
              COUNT(*) FILTER (WHERE positive = false)::int AS negative_cnt,
              COUNT(*)::int AS total_cnt,
              ROUND(AVG(rating)::numeric, 2) AS avg_rating
         FROM public.p2p_feedback
        WHERE to_wallet IN (${placeholders})
        GROUP BY to_wallet`,
      unique,
    ),
    db.query<RawRelAggRow>(
      `SELECT w.wallet,
              COALESCE((SELECT COUNT(*)::int FROM public.p2p_relations r1 WHERE r1.target = w.wallet AND r1.kind = 'follow'), 0) AS followers_cnt,
              COALESCE((SELECT COUNT(*)::int FROM public.p2p_relations r2 WHERE r2.actor = w.wallet AND r2.kind = 'follow'), 0) AS following_cnt
         FROM (SELECT UNNEST(ARRAY[${placeholders}]::text[]) AS wallet) w`,
      unique,
    ),
  ])

  for (const r of acctRes.rows) {
    const entry = out[r.wallet]
    if (!entry) continue
    entry.displayName = r.display_name
    entry.country = r.country
    entry.emailVerified = !!r.email_verified_at
    entry.kycApproved = r.kyc_status === 'approved'
    entry.joinedAt = toIso(r.created_at)
  }

  for (const r of fbRes.rows) {
    const entry = out[r.to_wallet]
    if (!entry) continue
    const pos = Number(r.positive_cnt) || 0
    const neg = Number(r.negative_cnt) || 0
    const total = Number(r.total_cnt) || 0
    entry.positiveCount = pos
    entry.negativeCount = neg
    entry.totalFeedback = total
    entry.positivePct = total > 0 ? Number(((pos / total) * 100).toFixed(2)) : null
    entry.avgRating = r.avg_rating !== null ? Number(r.avg_rating) : null
  }

  for (const r of relRes.rows) {
    const entry = out[r.wallet]
    if (!entry) continue
    entry.followersCount = Number(r.followers_cnt) || 0
    entry.followingCount = Number(r.following_cnt) || 0
  }

  return out
}

function formatFeedbackRow(row: RawFeedbackRow, viewerWallet?: string | null): FeedbackItemOut {
  const isAuthor = !!viewerWallet && row.from_wallet === viewerWallet.toLowerCase()
  const hideAuthor = row.anonymous && !isAuthor
  return {
    id: String(row.id),
    // L-01b: Never expose `orderId` publicly when `hideAuthor` is true so anonymous profile reviews cannot be de-anonymized via onchain `getOrder(orderId)`
    orderId: hideAuthor ? '' : String(row.order_id),
    fromWallet: hideAuthor ? maskAnonWallet(row.from_wallet) : row.from_wallet,
    fromDisplayName: hideAuthor ? 'Anonymous Trader' : row.from_display_name,
    toWallet: row.to_wallet,
    rating: Number(row.rating),
    positive: Boolean(row.positive),
    comment: row.comment ?? '',
    anonymous: Boolean(row.anonymous),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  }
}

/**
 * Handle:
 * - `GET  /api/p2p/profiles?wallets=0x...,0x...`
 * - `GET  /api/p2p/profile/:wallet`
 * - `GET  /api/p2p/relations`
 * - `POST /api/p2p/relations`
 * - `GET  /api/orders/:id/feedback`
 * - `POST /api/orders/:id/feedback`
 */
export async function handleSocialRoutes(
  req: Request,
  _env: Env,
  db: Queryable,
  chain: ChainReader,
  subpath: string,
): Promise<Response | null> {
  const ip = clientIp(req)
  const url = new URL(req.url)

  // ---- 1. Batch Public Trader Summaries ----
  if (req.method === 'GET' && subpath === '/p2p/profiles') {
    if (!(await checkRateLimit(db, `rl:p2p:profiles:${ip}`, 90, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const rawWallets = (url.searchParams.get('wallets') ?? '')
      .split(',')
      .map((s) => normalizeWallet(s.trim()))
      .filter((w): w is `0x${string}` => w !== null)
      .slice(0, 100)

    const profiles = await buildSummaries(db, rawWallets)
    return json(200, { profiles })
  }

  // ---- 2. Detailed Public Trader Profile + Feedback List ----
  const profileMatch = subpath.match(/^\/p2p\/profile\/(0x[0-9a-fA-F]{40})$/)
  if (req.method === 'GET' && profileMatch) {
    if (!(await checkRateLimit(db, `rl:p2p:prof:${ip}`, 60, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const target = normalizeWallet(profileMatch[1])
    if (!target) return json(400, { error: 'invalid_wallet' })

    const session = await getSession(req, db).catch(() => null)
    const viewer = session?.wallet ?? null

    const summaries = await buildSummaries(db, [target])
    const summary = summaries[target]!

    const fbRows = await db.query<RawFeedbackRow>(
      `SELECT f.id, f.order_id, f.from_wallet, a.display_name AS from_display_name,
              f.to_wallet, f.rating, f.positive, f.comment, f.anonymous, f.created_at
         FROM public.p2p_feedback f
         LEFT JOIN public.accounts a ON a.wallet = f.from_wallet AND a.deleted_at IS NULL
        WHERE f.to_wallet = $1
        ORDER BY f.created_at DESC
        LIMIT 50`,
      [target],
    )

    let viewerFollowing = false
    let viewerBlocked = false
    if (viewer && viewer !== target) {
      const rel = await db.query<{ kind: string }>(
        `SELECT kind FROM public.p2p_relations WHERE actor = $1 AND target = $2`,
        [viewer, target],
      )
      for (const r of rel.rows) {
        if (r.kind === 'follow') viewerFollowing = true
        if (r.kind === 'block') viewerBlocked = true
      }
    }

    return json(200, {
      profile: summary,
      viewerFollowing,
      viewerBlocked,
      feedback: fbRows.rows.map((r) => formatFeedbackRow(r, viewer)),
    })
  }

  // ---- 3. Follow & Block Relations ----
  if (subpath === '/p2p/relations') {
    const auth = await requireSession(req, db)
    if (!auth.ok) return auth.response
    const wallet = auth.session.wallet

    if (req.method === 'GET') {
      const rows = await db.query<{ target: string; kind: string }>(
        `SELECT target, kind FROM public.p2p_relations WHERE actor = $1 ORDER BY created_at DESC LIMIT 200`,
        [wallet],
      )
      const followingWallets = rows.rows
        .filter((r) => r.kind === 'follow')
        .map((r) => r.target as `0x${string}`)
      const blockedWallets = rows.rows
        .filter((r) => r.kind === 'block')
        .map((r) => r.target as `0x${string}`)

      const allSummaries = await buildSummaries(db, [...followingWallets, ...blockedWallets])
      return json(200, {
        following: followingWallets.map((w) => allSummaries[w]!).filter(Boolean),
        blocked: blockedWallets.map((w) => allSummaries[w]!).filter(Boolean),
      })
    }

    if (req.method === 'POST') {
      if (!(await checkRateLimit(db, `rl:p2p:rel:${wallet}`, 30, 60))) {
        return json(429, { error: 'rate_limited' })
      }
      const body = await readJsonBody(req, 4_096)
      if (!body) return json(400, { error: 'bad_request' })
      const target = normalizeWallet(body.target)
      const kind = body.kind === 'follow' || body.kind === 'block' ? body.kind : null
      const active = typeof body.active === 'boolean' ? body.active : null

      if (!target || !kind || active === null || target === wallet) {
        return json(400, { error: 'invalid_relation' })
      }

      if (active) {
        await db.query(
          `INSERT INTO public.p2p_relations (actor, target, kind)
           VALUES ($1, $2, $3)
           ON CONFLICT (actor, target, kind) DO NOTHING`,
          [wallet, target, kind],
        )
        // Blocking a user automatically unfollows them
        if (kind === 'block') {
          await db.query(
            `DELETE FROM public.p2p_relations WHERE actor = $1 AND target = $2 AND kind = 'follow'`,
            [wallet, target],
          )
        }
      } else {
        await db.query(
          `DELETE FROM public.p2p_relations WHERE actor = $1 AND target = $2 AND kind = $3`,
          [wallet, target, kind],
        )
      }

      await writeAudit(db, wallet, `p2p.${kind}.${active ? 'add' : 'remove'}`, target)
      return json(200, { ok: true, target, kind, active })
    }

    return json(405, { error: 'method_not_allowed' })
  }

  // ---- 4. Per-Order Post-Trade Feedback + Rating ----
  const orderFbMatch = subpath.match(/^\/orders\/(\d+)\/feedback$/)
  if (orderFbMatch) {
    const orderId = BigInt(orderFbMatch[1])
    const orderIdStr = orderId.toString()

    if (req.method === 'GET') {
      const session = await getSession(req, db).catch(() => null)
      const viewer = session?.wallet?.toLowerCase() ?? null
      const rows = await db.query<RawFeedbackRow>(
        `SELECT f.id, f.order_id, f.from_wallet, a.display_name AS from_display_name,
                f.to_wallet, f.rating, f.positive, f.comment, f.anonymous, f.created_at
           FROM public.p2p_feedback f
           LEFT JOIN public.accounts a ON a.wallet = f.from_wallet AND a.deleted_at IS NULL
          WHERE f.order_id = $1
          ORDER BY f.created_at ASC`,
        [orderIdStr],
      )
      // L-01b: Hide anonymous per-order feedback from non-party probes so outsiders cannot correlate anonymous profile reviews
      const visible = rows.rows.filter(
        (r) => !r.anonymous || (viewer !== null && (r.from_wallet === viewer || r.to_wallet === viewer)),
      )
      return json(200, {
        orderId: orderIdStr,
        items: visible.map((r) => formatFeedbackRow(r, viewer)),
      })
    }

    if (req.method === 'POST') {
      const auth = await requireSession(req, db)
      if (!auth.ok) return auth.response
      const wallet = auth.session.wallet

      if (!(await checkRateLimit(db, `rl:p2p:fb:${wallet}`, 20, 300))) {
        return json(429, { error: 'rate_limited' })
      }

      const order = await chain.getOrder(orderId)
      if (!order) return json(404, { error: 'order_not_found' })

      const isBuyer = wallet === order.buyer
      const isSeller = wallet === order.seller
      if (!isBuyer && !isSeller) {
        return json(403, { error: 'forbidden' })
      }

      const isTerminalFeedbackEligible =
        order.status === ORDER_STATUS.COMPLETED ||
        order.status === ORDER_STATUS.RESOLVED_BUYER ||
        order.status === ORDER_STATUS.RESOLVED_SELLER ||
        order.status === ORDER_STATUS.SETTLED

      if (!isTerminalFeedbackEligible) {
        return json(400, { error: 'order_not_completed' })
      }

      const body = await readJsonBody(req, 4_096)
      if (!body) return json(400, { error: 'bad_request' })

      const rating = typeof body.rating === 'number' && Number.isInteger(body.rating) ? body.rating : 0
      const positive = typeof body.positive === 'boolean' ? body.positive : null
      const rawComment = typeof body.comment === 'string' ? body.comment.trim() : ''
      const anonymous = body.anonymous === true

      if (rating < 1 || rating > 5 || positive === null) {
        return json(400, { error: 'invalid_rating' })
      }
      if (rawComment.length > 280 || CTRL_RE.test(rawComment)) {
        return json(400, { error: 'invalid_comment' })
      }

      const toWallet = isBuyer ? order.seller : order.buyer

      await db.query(
        `INSERT INTO public.p2p_feedback
           (order_id, from_wallet, to_wallet, rating, positive, comment, anonymous)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (order_id, from_wallet) DO UPDATE
           SET rating = EXCLUDED.rating,
               positive = EXCLUDED.positive,
               comment = EXCLUDED.comment,
               anonymous = EXCLUDED.anonymous`,
        [orderIdStr, wallet, toWallet, rating, positive, rawComment, anonymous],
      )

      await writeAudit(db, wallet, 'p2p.feedback_submitted', `order:${orderIdStr}`)

      const savedRows = await db.query<RawFeedbackRow>(
        `SELECT f.id, f.order_id, f.from_wallet, a.display_name AS from_display_name,
                f.to_wallet, f.rating, f.positive, f.comment, f.anonymous, f.created_at
           FROM public.p2p_feedback f
           LEFT JOIN public.accounts a ON a.wallet = f.from_wallet AND a.deleted_at IS NULL
          WHERE f.order_id = $1
          ORDER BY f.created_at ASC`,
        [orderIdStr],
      )

      return json(200, {
        orderId: orderIdStr,
        items: savedRows.rows.map((r) => formatFeedbackRow(r, wallet)),
      })
    }

    return json(405, { error: 'method_not_allowed' })
  }

  return null
}
