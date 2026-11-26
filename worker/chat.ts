import { requireSession } from './auth'
import { checkOrderAccess, isArbiterOrderReadAllowed, ORDER_STATUS, type ChainReader } from './chain'
import { CryptoTamperError, openText, sealText } from './crypto'
import { checkRateLimit, writeAudit, type Queryable } from './db'
import { json, publicAppOrigin, readJsonBody, type Env } from './env'
import { buildTelegramAlertMessage, sendTelegramBotMessage, tgChatAad } from './telegram'

const MAX_MSG_BYTES = 4_096
const MAX_MSGS_PER_PAGE = 50
const CHAT_RETENTION_SECONDS = 90 * 24 * 3600 // 90 days

const memoryChatRead = new Map<string, string>()

async function markChatRead(env: Env, orderId: string, role: 'buyer' | 'seller'): Promise<void> {
  const key = `chat_read:${orderId}:${role}`
  const nowIso = new Date().toISOString()
  memoryChatRead.set(key, nowIso)
  if (env.AI_SETTINGS_KV) {
    try {
      await env.AI_SETTINGS_KV.put(key, JSON.stringify({ at: nowIso }))
    } catch {
      /* non-fatal */
    }
  }
}

async function getCounterpartyReadAt(env: Env, orderId: string, role: 'buyer' | 'seller'): Promise<string | null> {
  const otherRole = role === 'buyer' ? 'seller' : 'buyer'
  const key = `chat_read:${orderId}:${otherRole}`
  if (env.AI_SETTINGS_KV) {
    try {
      const val = (await env.AI_SETTINGS_KV.get(key, 'json')) as { at?: string } | null
      if (typeof val?.at === 'string') return val.at
    } catch {
      /* fallback */
    }
  }
  return memoryChatRead.get(key) ?? null
}

function chatAad(orderId: string, author: string): string {
  return `chat:${orderId}:${author}`
}

export interface ChatMessageRow {
  id: string
  order_id: string
  author: string
  body_enc: string
  evidence_blob_id: string | null
  created_at: string
}

export interface ChatMessageOut {
  id: string
  author: string
  body: string
  evidenceBlobId: string | null
  createdAt: string
}

/**
 * Handle:
 * - `POST /api/orders/:id/chat`  — seal + store a message (≤4 KB plaintext)
 * - `GET  /api/orders/:id/chat`  — decrypt + return messages for order parties/arbiter
 */
export async function handleChatRoutes(
  req: Request,
  env: Env,
  db: Queryable,
  chain: ChainReader,
  subpath: string,
): Promise<Response | null> {
  const chatMatch = subpath.match(/^\/orders\/(\d+)\/chat$/)
  if (!chatMatch) return null

  const auth = await requireSession(req, db)
  if (!auth.ok) return auth.response
  const wallet = auth.session.wallet

  const orderId = BigInt(chatMatch[1])
  const access = await checkOrderAccess(chain, orderId, wallet)
  if (!access.allowed) return json(access.status, { error: access.error })

  // ---- POST: seal and store a new message ----
  if (req.method === 'POST') {
    if (!(await checkRateLimit(db, `rl:chat:${wallet}`, 30, 60))) {
      return json(429, { error: 'rate_limited' })
    }

    // H-03: Block chat writes on terminal orders (COMPLETED, CANCELLED, RESOLVED_*, SETTLED)
    if (
      access.order.status !== ORDER_STATUS.PENDING &&
      access.order.status !== ORDER_STATUS.PAID &&
      access.order.status !== ORDER_STATUS.DISPUTED
    ) {
      return json(400, { error: 'invalid_order_status' })
    }

    // Gate arbiter/backup_arbiter chat POST identically to GET + audit
    if (access.role === 'arbiter' || access.role === 'backup_arbiter') {
      const filingRes = await db.query<{ exists: number }>(
        `SELECT 1 AS exists FROM public.dispute_filings WHERE order_id = $1 LIMIT 1`,
        [orderId.toString()],
      )
      const hasFiling = filingRes.rows.length > 0
      if (!isArbiterOrderReadAllowed(access.order, access.role, hasFiling)) {
        return json(403, { error: 'forbidden' })
      }
      await writeAudit(db, wallet, 'chat.arbiter_post', `order:${orderId.toString()}`)
    }

    const body = await readJsonBody(req, MAX_MSG_BYTES * 2)
    if (!body) return json(400, { error: 'bad_request' })

    const text = typeof body.body === 'string' ? body.body.trim() : ''
    if (text.length === 0) return json(400, { error: 'message_empty' })

    const bytes = new TextEncoder().encode(text).byteLength
    if (bytes > MAX_MSG_BYTES) return json(400, { error: 'message_too_long' })

    // H4: Verify evidence blob ownership, kind='evidence', and order binding
    let evidenceBlobId: string | null = null
    if (body.evidenceBlobId !== undefined && body.evidenceBlobId !== null && body.evidenceBlobId !== '') {
      if (typeof body.evidenceBlobId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.evidenceBlobId)) {
        return json(400, { error: 'invalid_evidence_blob' })
      }
      const check = await db.query<{ id: string }>(
        `SELECT id
           FROM public.vault_blobs
          WHERE id = $1::uuid
            AND kind = 'evidence'
            AND author = $2
            AND order_id = $3
          LIMIT 1`,
        [body.evidenceBlobId, wallet, orderId.toString()],
      )
      if (check.rows.length === 0) {
        return json(400, { error: 'invalid_evidence_blob' })
      }
      evidenceBlobId = body.evidenceBlobId
    }

    const orderIdStr = orderId.toString()
    const enc = await sealText(env, text, chatAad(orderIdStr, wallet))

    const ins = await db.query<{ id: string }>(
      `INSERT INTO public.chat_messages (order_id, author, body_enc, evidence_blob_id, delete_after)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
       RETURNING id`,
      [orderIdStr, wallet, enc, evidenceBlobId, CHAT_RETENTION_SECONDS],
    )
    const msgId = ins.rows[0]?.id ?? ''
    await writeAudit(db, wallet, 'chat.post', `order:${orderIdStr}`)

    // Instant zero-PII counterparty Telegram push + 2-minute deduplicated outbox notification
    const counterparty =
      access.role === 'buyer'
        ? access.order.seller
        : access.role === 'seller'
          ? access.order.buyer
          : null

    if (counterparty) {
      const targetWallet = counterparty.toLowerCase() as `0x${string}`
      const bucket = Math.floor(Date.now() / 120_000)
      const dedupeKey = `order_chat:${targetWallet}:${orderIdStr}:${bucket}`

      let deliveredInstant = false
      if (env.TELEGRAM_BOT_TOKEN?.trim()) {
        const tgRow = await db
          .query<{ telegram_chat_id_enc: string | null; telegram_opt_in: boolean }>(
            `SELECT telegram_chat_id_enc, telegram_opt_in
               FROM public.accounts
              WHERE wallet = $1 AND deleted_at IS NULL`,
            [targetWallet],
          )
          .then((r) => r.rows[0])
          .catch(() => undefined)

        if (tgRow?.telegram_chat_id_enc && tgRow.telegram_opt_in) {
          try {
            const chatId = await openText(env, tgRow.telegram_chat_id_enc, tgChatAad(targetWallet))
            const appOrigin = publicAppOrigin(env, new URL(req.url))
            const alert = buildTelegramAlertMessage('order_chat', orderId, appOrigin)
            deliveredInstant = await sendTelegramBotMessage(env, {
              chatId,
              text: alert.text,
              buttons: alert.buttons,
            })
          } catch {
            deliveredInstant = false
          }
        }
      }

      if (!deliveredInstant) {
        await db
          .query(
            `INSERT INTO public.notifications_outbox (wallet, event, order_id, dedupe_key)
             VALUES ($1, 'order_chat', $2, $3)
             ON CONFLICT (dedupe_key) DO NOTHING`,
            [targetWallet, orderIdStr, dedupeKey],
          )
          .catch(() => undefined)
      } else {
        // M-06: Also deliver deduplicated email alert when counterparty opted into BOTH Telegram and Email
        const emailRow = await db
          .query<{ email_enc: string | null; email_verified_at: string | null; email_opt_in: boolean }>(
            `SELECT email_enc, email_verified_at, email_opt_in
               FROM public.accounts
              WHERE wallet = $1 AND deleted_at IS NULL`,
            [targetWallet],
          )
          .then((r) => r.rows[0])
          .catch(() => undefined)
        if (emailRow?.email_enc && emailRow.email_verified_at && emailRow.email_opt_in) {
          await db
            .query(
              `INSERT INTO public.notifications_outbox (wallet, event, order_id, dedupe_key)
               VALUES ($1, 'order_chat_email', $2, $3)
               ON CONFLICT (dedupe_key) DO NOTHING`,
              [targetWallet, orderIdStr, `${dedupeKey}:email`],
            )
            .catch(() => undefined)
        }
      }
    }

    return json(201, { id: msgId })
  }

  // ---- GET: decrypt and return messages ----
  if (req.method === 'GET') {
    // L6: Rate limit chat GET
    if (!(await checkRateLimit(db, `rl:chat:get:${wallet}`, 60, 60))) {
      return json(429, { error: 'rate_limited' })
    }

    // M4: Restrict arbiter/backup_arbiter chat reads and audit every privileged read
    if (access.role === 'arbiter' || access.role === 'backup_arbiter') {
      const filingRes = await db.query<{ exists: number }>(
        `SELECT 1 AS exists FROM public.dispute_filings WHERE order_id = $1 LIMIT 1`,
        [orderId.toString()],
      )
      const hasFiling = filingRes.rows.length > 0
      if (!isArbiterOrderReadAllowed(access.order, access.role, hasFiling)) {
        return json(403, { error: 'forbidden' })
      }
      await writeAudit(db, wallet, 'chat.arbiter_read', `order:${orderId.toString()}`)
    }

    const url = new URL(req.url)
    const afterId = url.searchParams.get('after') ?? null
    const afterBigInt = afterId && /^\d+$/.test(afterId) ? BigInt(afterId) : null

    const rows = await db.query<ChatMessageRow>(
      `SELECT id, order_id, author, body_enc, evidence_blob_id, created_at
         FROM public.chat_messages
        WHERE order_id = $1
          ${afterBigInt ? 'AND id > $2' : ''}
        ORDER BY id ASC
        LIMIT ${MAX_MSGS_PER_PAGE}`,
      afterBigInt ? [orderId.toString(), afterBigInt.toString()] : [orderId.toString()],
    )

    const messages: ChatMessageOut[] = []
    for (const row of rows.rows) {
      try {
        const plaintext = await openText(env, row.body_enc, chatAad(row.order_id.toString(), row.author))
        messages.push({
          id: row.id.toString(),
          author: row.author,
          body: plaintext,
          evidenceBlobId: row.evidence_blob_id,
          createdAt: row.created_at,
        })
      } catch (e) {
        if (e instanceof CryptoTamperError) {
          // Skip tampered/corrupted messages — log but don't expose
          await writeAudit(db, wallet, 'chat.tampered', `msg:${row.id}`)
          continue
        }
        throw e
      }
    }

    let counterpartyReadAt: string | null = null
    if (access.role === 'buyer' || access.role === 'seller') {
      await markChatRead(env, orderId.toString(), access.role)
      counterpartyReadAt = await getCounterpartyReadAt(env, orderId.toString(), access.role)
    }

    return json(200, {
      orderId: orderId.toString(),
      messages,
      hasMore: rows.rows.length === MAX_MSGS_PER_PAGE,
      counterpartyReadAt,
    })
  }

  return json(405, { error: 'method_not_allowed' })
}
