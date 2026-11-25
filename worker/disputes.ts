import { requireSession } from './auth'
import {
  ARBITER_PAID_DELAY_SECONDS,
  checkAdminAccess,
  checkOrderAccess,
  isArbiterOrderReadAllowed,
  isBackupArbiterEligible,
  ORDER_STATUS,
  type ChainOrder,
  type ChainReader,
  type ChainRoles,
  type OrderPartyRole,
} from './chain'
import { openText, sealText } from './crypto'
import { checkRateLimit, writeAudit, type Queryable } from './db'
import { json, readJsonBody, textField, type Env } from './env'

const MAX_STATEMENT_BYTES = 8_192
const DISPUTE_RETENTION_SECONDS = 365 * 24 * 3600 // 1 year
const DISPUTE_RATE_LIMIT = 5
const DISPUTE_RATE_WINDOW = 24 * 3600

const VALID_REASON_CODES = new Set([
  'payment_not_received',
  'wrong_amount',
  'wrong_account',
  'fraud',
  'other',
])

function disputeAad(orderId: string, filedBy: string): string {
  return `dispute:${orderId}:${filedBy}`
}

function isValidUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export interface DisputeFilingRow {
  id: string
  order_id: string
  filed_by: string
  reason_code: string
  text_enc: string
  evidence_blob_ids: string[] | null
  status: string
  filed_at: string
  closed_at: string | null
}

export interface DisputeFilingOut {
  id: string
  orderId: string
  filedBy: string
  reasonCode: string
  statement: string
  evidenceBlobIds: string[]
  status: string
  filedAt: string
}

/**
 * Handle:
 * - POST /api/orders/:id/disputes  — file a dispute statement (buyer or seller)
 * - GET  /api/orders/:id/disputes  — read filings for order parties/arbiter
 * - GET  /api/admin/disputes       — arbiter queue of open/taken filings
 */
export async function handleDisputeRoutes(
  req: Request,
  env: Env,
  db: Queryable,
  chain: ChainReader,
  subpath: string,
): Promise<Response | null> {
  // ---- GET /admin/disputes ----
  if (subpath === '/admin/disputes') {
    return handleAdminDisputes(req, env, db, chain)
  }

  // ---- /orders/:id/disputes ----
  const orderMatch = subpath.match(/^\/orders\/(\d+)\/disputes$/)
  if (!orderMatch) return null

  const auth = await requireSession(req, db)
  if (!auth.ok) return auth.response
  const wallet = auth.session.wallet

  const orderId = BigInt(orderMatch[1])
  const access = await checkOrderAccess(chain, orderId, wallet)
  if (!access.allowed) return json(access.status, { error: access.error })

  if (req.method === 'POST') {
    // H1: Only buyer or seller may file a dispute (never arbiter/backup_arbiter)
    if (access.role !== 'buyer' && access.role !== 'seller') {
      return json(403, { error: 'forbidden' })
    }
    return handleFileDispute(req, env, db, orderId, wallet, access.order, access.roles)
  }

  if (req.method === 'GET') {
    return handleGetDisputeFilings(env, db, orderId, wallet, access.role, access.order)
  }

  return json(405, { error: 'method_not_allowed' })
}

// ---- POST: file a new dispute statement ----
async function handleFileDispute(
  req: Request,
  env: Env,
  db: Queryable,
  orderId: bigint,
  wallet: `0x${string}`,
  order: ChainOrder,
  roles: ChainRoles,
): Promise<Response> {
  // H1: Offchain dispute filing allowed when order is PAID or DISPUTED (enables 0-USDC buyer filing)
  if (order.status !== ORDER_STATUS.PAID && order.status !== ORDER_STATUS.DISPUTED) {
    return json(400, { error: 'dispute_not_eligible' })
  }

  // M-04: Match contract rule — buyer must wait 15 minutes after `paidAt` before escalating a PAID order
  const nowSec = Math.floor(Date.now() / 1000)
  if (
    order.status === ORDER_STATUS.PAID &&
    wallet === order.buyer &&
    order.paidAt > 0n &&
    nowSec < Number(order.paidAt) + ARBITER_PAID_DELAY_SECONDS
  ) {
    return json(400, { error: 'too_early_to_dispute' })
  }

  const allowed = await checkRateLimit(db, `rl:dispute:${wallet}`, DISPUTE_RATE_LIMIT, DISPUTE_RATE_WINDOW)
  if (!allowed) return json(429, { error: 'rate_limited' })

  const body = await readJsonBody(req)
  if (!body) return json(400, { error: 'bad_request' })

  const reasonCode = textField(body.reasonCode, 64)
  if (!reasonCode || !VALID_REASON_CODES.has(reasonCode)) {
    return json(400, { error: 'invalid_reason_code' })
  }

  const rawStatement = typeof body.statement === 'string' ? body.statement.trim() : ''
  if (!rawStatement) return json(400, { error: 'bad_request' })
  if (new TextEncoder().encode(rawStatement).byteLength > MAX_STATEMENT_BYTES) {
    return json(400, { error: 'statement_too_long' })
  }

  // Validate evidence blob IDs (optional)
  const rawBlobIds = Array.isArray(body.evidenceBlobIds) ? (body.evidenceBlobIds as unknown[]) : []
  const evidenceBlobIds: string[] = []
  for (const id of rawBlobIds) {
    if (typeof id === 'string' && isValidUuid(id)) {
      evidenceBlobIds.push(id)
    } else if (rawBlobIds.length > 0) {
      return json(400, { error: 'invalid_vault_payload' })
    }
  }

  const orderIdStr = orderId.toString()

  // H1: Verify evidence blobs belong to this wallet (`author`), are `kind = 'evidence'`, and are bound to this order
  if (evidenceBlobIds.length > 0) {
    const placeholders = evidenceBlobIds.map((_, i) => `$${i + 3}`).join(', ')
    const blobCheck = await db.query<{ id: string }>(
      `SELECT id
         FROM public.vault_blobs
        WHERE author = $1
          AND kind = 'evidence'
          AND order_id = $2
          AND id = ANY(ARRAY[${placeholders}]::uuid[])`,
      [wallet, orderIdStr, ...evidenceBlobIds],
    )
    if (blobCheck.rows.length !== evidenceBlobIds.length) {
      return json(400, { error: 'invalid_vault_payload' })
    }
  }

  const textEnc = await sealText(env, rawStatement, disputeAad(orderIdStr, wallet))
  const initialStatus = order.reviewStartedAt > 0n ? 'taken' : 'open'

  try {
    const ins = await db.query<{ id: string }>(
      `INSERT INTO public.dispute_filings
         (order_id, filed_by, reason_code, text_enc, evidence_blob_ids, status, delete_after)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
       RETURNING id`,
      [
        orderIdStr,
        wallet,
        reasonCode,
        textEnc,
        evidenceBlobIds.length > 0 ? evidenceBlobIds : '{}',
        initialStatus,
        DISPUTE_RETENTION_SECONDS,
      ],
    )
    const filingId = ins.rows[0]?.id ?? ''

    await writeAudit(db, wallet, 'dispute.file', `order:${orderIdStr}`)

    // H1: Notify the counterparty AND the arbiter (never the filer)
    const counterparty = wallet === order.buyer ? order.seller : order.buyer
    const recipients = Array.from(new Set([counterparty, roles.arbiter].filter((r) => r && r !== wallet)))
    for (const recipient of recipients) {
      await db.query(
        `INSERT INTO public.notifications_outbox (wallet, event, order_id, dedupe_key)
         VALUES ($1, 'dispute_filed', $2, $3)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [recipient, orderIdStr, `dispute_filed:${orderIdStr}:${wallet}:to:${recipient}`],
      ).catch(() => undefined)
    }

    return json(201, { id: filingId, status: initialStatus })
  } catch (err) {
    const msg = (err as { message?: string }).message ?? ''
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('23505')) {
      return json(409, { error: 'dispute_already_filed' })
    }
    throw err
  }
}

function deriveFilingStatus(currentStatus: string, order: ChainOrder | null): string {
  if (!order) return currentStatus
  if (order.status === ORDER_STATUS.RESOLVED_BUYER || order.status === ORDER_STATUS.RESOLVED_SELLER) {
    return 'resolved'
  }
  if (
    order.status === ORDER_STATUS.SETTLED ||
    order.status === ORDER_STATUS.COMPLETED ||
    order.status === ORDER_STATUS.CANCELLED
  ) {
    return 'settled'
  }
  if (order.reviewStartedAt > 0n && currentStatus === 'open') {
    return 'taken'
  }
  return currentStatus
}

// ---- GET: read filings for order parties/arbiter ----
async function handleGetDisputeFilings(
  env: Env,
  db: Queryable,
  orderId: bigint,
  wallet: `0x${string}`,
  role: string,
  order: ChainOrder,
): Promise<Response> {
  const orderIdStr = orderId.toString()
  const rows = await db.query<DisputeFilingRow>(
    `SELECT id, order_id, filed_by, reason_code, text_enc, evidence_blob_ids, status, filed_at, closed_at
       FROM public.dispute_filings
      WHERE order_id = $1
      ORDER BY filed_at ASC`,
    [orderIdStr],
  )

  const isArbiter = role === 'arbiter' || role === 'backup_arbiter'
  if (isArbiter) {
    if (!isArbiterOrderReadAllowed(order, role as OrderPartyRole, rows.rows.length > 0)) {
      return json(403, { error: 'forbidden' })
    }
    await writeAudit(db, wallet, 'dispute.arbiter_read', `order:${orderIdStr}`)
  }
  const reviewTaken = order.reviewStartedAt > 0n
  const out: DisputeFilingOut[] = []

  for (const row of rows.rows) {
    // Parties can see their own filing; counterparty filing visible once arbiter has taken case
    const isMine = row.filed_by === wallet
    const canRead = isArbiter || isMine || reviewTaken

    if (!canRead) continue

    let statement = ''
    try {
      statement = await openText(env, row.text_enc, disputeAad(row.order_id.toString(), row.filed_by))
    } catch {
      statement = '[decryption failed]'
    }

    out.push({
      id: row.id.toString(),
      orderId: row.order_id.toString(),
      filedBy: row.filed_by,
      reasonCode: row.reason_code,
      statement,
      evidenceBlobIds: row.evidence_blob_ids ?? [],
      status: deriveFilingStatus(row.status, order),
      filedAt: row.filed_at,
    })
  }

  return json(200, { orderId: orderIdStr, filings: out })
}

// ---- GET /admin/disputes — arbiter queue ----
async function handleAdminDisputes(
  req: Request,
  env: Env,
  db: Queryable,
  chain: ChainReader,
): Promise<Response> {
  const auth = await requireSession(req, db)
  if (!auth.ok) return auth.response

  const adminAccess = await checkAdminAccess(chain, auth.session.wallet, { allowBackupArbiter: true })
  if (!adminAccess.allowed) return json(403, { error: 'forbidden' })

  const url = new URL(req.url)
  const statusFilter = url.searchParams.get('status') ?? 'open'
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '20', 10)
  const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 20 : limitRaw), 100)
  const afterId = url.searchParams.get('after') ?? null

  // Reconcile open/taken filings against live onchain order state in bounded parallel batches (M-05)
  const activeRows = await db.query<{ order_id: string; status: string }>(
    `SELECT DISTINCT order_id, status FROM public.dispute_filings WHERE status IN ('open', 'taken') LIMIT 100`,
  )
  const orderCache = new Map<string, ChainOrder | null>()
  const uniqueOrderIds = Array.from(new Set(activeRows.rows.map((r) => r.order_id.toString())))
  for (let i = 0; i < uniqueOrderIds.length; i += 10) {
    const chunk = uniqueOrderIds.slice(i, i + 10)
    const fetched = await Promise.all(
      chunk.map(async (oid) => [oid, await chain.getOrder(BigInt(oid)).catch(() => null)] as const),
    )
    for (const [oid, ord] of fetched) {
      orderCache.set(oid, ord)
    }
  }
  for (const r of activeRows.rows) {
    const oid = r.order_id.toString()
    const nextStatus = deriveFilingStatus(r.status, orderCache.get(oid) ?? null)
    if (nextStatus !== r.status) {
      await db
        .query(
          `UPDATE public.dispute_filings
              SET status = $1,
                  closed_at = CASE WHEN $1 IN ('resolved', 'settled') THEN COALESCE(closed_at, now()) ELSE closed_at END
            WHERE order_id = $2 AND status = $3`,
          [nextStatus, oid, r.status],
        )
        .catch(() => undefined)
    }
  }

  const isResolvedFilter = statusFilter === 'resolved'
  const rows = isResolvedFilter
    ? await db.query<DisputeFilingRow>(
        `SELECT id, order_id, filed_by, reason_code, text_enc, evidence_blob_ids, status, filed_at, closed_at
           FROM public.dispute_filings
          WHERE status IN ('resolved', 'settled', 'closed')
            ${afterId && /^\d+$/.test(afterId) ? 'AND id < $2' : ''}
          ORDER BY id DESC
          LIMIT $1`,
        afterId && /^\d+$/.test(afterId) ? [limit, afterId] : [limit],
      )
    : await db.query<DisputeFilingRow>(
        `SELECT id, order_id, filed_by, reason_code, text_enc, evidence_blob_ids, status, filed_at, closed_at
           FROM public.dispute_filings
          WHERE status = $1
            ${afterId && /^\d+$/.test(afterId) ? 'AND id > $3' : ''}
          ORDER BY id ASC
          LIMIT $2`,
        afterId && /^\d+$/.test(afterId) ? [statusFilter, limit, afterId] : [statusFilter, limit],
      )

  const isBackupOnly = adminAccess.role === 'backup_arbiter'
  const nowSec = Math.floor(Date.now() / 1000)
  const out: DisputeFilingOut[] = []

  for (const row of rows.rows) {
    // M4: Apply the 7-day rule per row for backup_arbiter before decrypting
    if (isBackupOnly) {
      const oid = row.order_id.toString()
      const order = orderCache.has(oid) ? orderCache.get(oid)! : await chain.getOrder(BigInt(oid))
      if (!order || !isBackupArbiterEligible(order, nowSec)) {
        continue
      }
    }

    let statement = ''
    try {
      statement = await openText(env, row.text_enc, disputeAad(row.order_id.toString(), row.filed_by))
    } catch {
      statement = '[decryption failed]'
    }
    out.push({
      id: row.id.toString(),
      orderId: row.order_id.toString(),
      filedBy: row.filed_by,
      reasonCode: row.reason_code,
      statement,
      evidenceBlobIds: row.evidence_blob_ids ?? [],
      status: row.status,
      filedAt: row.filed_at,
    })
  }

  await writeAudit(db, auth.session.wallet, 'dispute.arbiter_queue_read', `status:${statusFilter}`)
  return json(200, { filings: out, hasMore: rows.rows.length === limit })
}
