import { requireSession } from './auth'
import {
  checkOrderAccess,
  isArbiterOrderReadAllowed,
  ORDER_STATUS,
  type ChainReader,
} from './chain'
import { CryptoTamperError, openBlob, sealBlob } from './crypto'
import { checkRateLimit, writeAudit, type Queryable } from './db'
import { json, readJsonBody, textField, type Env } from './env'
import { verifyCounterpartyName, type NameMatchResult } from './kyc'

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const MAX_JSON_BLOB_BYTES = 4_096
const MAX_EVIDENCE_BYTES = 1_048_576 // 1 MB
const MAX_PAYER_BLOBS_PER_ORDER = 5
const MAX_EVIDENCE_BLOBS_PER_ORDER = 10
const EVIDENCE_RETENTION_SECONDS = 90 * 24 * 3600 // 90 days
const ALLOWED_EVIDENCE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/** Verify actual file magic bytes match the claimed MIME type (prevents spoofed Content-Type). */
export function matchesMagicBytes(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/png') {
    return (
      bytes.byteLength >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    )
  }
  if (mime === 'image/jpeg') {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (mime === 'image/webp') {
    return (
      bytes.byteLength >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    )
  }
  if (mime === 'application/pdf') {
    return (
      bytes.byteLength >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d
    )
  }
  return false
}

export interface SellerDetailsPayload {
  holderName: string
  accountDetails: string
  notes: string
}

export interface BuyerPayerPayload {
  orderId: string
  transferId: string
  senderName: string
  last4: string
  paymentMethod?: string
}

export interface VaultBlobRow {
  id: string
  kind: 'ad_details' | 'order_details' | 'payer' | 'evidence'
  ad_id: string | number | null
  order_id: string | number | null
  author: string
  mime_type?: string | null
  ciphertext: Uint8Array | Buffer
  wrapped_key: Uint8Array | Buffer
  content_hash: string
  size: number
}

function vaultAad(kind: string, author: `0x${string}`, orderId?: string): string {
  return orderId ? `vault:${kind}:${orderId}:${author}` : `vault:${kind}:${author}`
}

async function hasOrderFiling(db: Queryable, orderId: bigint): Promise<boolean> {
  const res = await db.query<{ exists: number }>(
    `SELECT 1 AS exists FROM public.dispute_filings WHERE order_id = $1 LIMIT 1`,
    [orderId.toString()],
  )
  return res.rows.length > 0
}

function parsePositiveBigInt(val: unknown): bigint | null {
  if (typeof val === 'number' && Number.isSafeInteger(val) && val > 0) return BigInt(val)
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
    const b = BigInt(val.trim())
    return b > 0n ? b : null
  }
  return null
}

function sanitizePlainLine(val: unknown, max: number): string | null {
  if (typeof val !== 'string') return null
  const trimmed = val.trim()
  if (trimmed.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed)) return null
  return trimmed
}

function toUint8(buf: Uint8Array | Buffer): Uint8Array {
  return buf instanceof Uint8Array
    ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    : new Uint8Array(buf)
}

/**
 * Handle:
 * - `POST /api/vault/details`                   (seal `ad_details` or `order_details` before createAd/openOrder)
 * - `POST /api/vault/bind-ad`                   (link an `ad_details` blob to its mined `adId` and extend TTL)
 * - `POST /api/vault/bind-order`                (link an `order_details` blob to its mined `orderId` and extend TTL)
 * - `POST /api/vault/payer`                     (seal buyer `payer` proof before markPaid; max 5 per order)
 * - `GET  /api/orders/:id/vault`                (decrypt seller details + buyer payer proof + KYC name-match badges)
 * - `POST /api/orders/:id/evidence`             (upload encrypted <= 1 MB evidence bound to the order)
 * - `GET  /api/orders/:id/evidence/:blobId`     (download decrypted evidence for parties / eligible arbiter)
 */
export async function handleVaultRoutes(
  req: Request,
  env: Env,
  db: Queryable,
  chain: ChainReader,
  subpath: string,
): Promise<Response | null> {
  const orderVaultMatch = subpath.match(/^\/orders\/(\d+)\/vault$/)
  const evidenceUploadMatch = subpath.match(/^\/orders\/(\d+)\/evidence$/)
  const evidenceDownloadMatch = subpath.match(/^\/orders\/(\d+)\/evidence\/([0-9a-f-]{36})$/i)
  const isVaultWrite =
    subpath === '/vault/details' ||
    subpath === '/vault/bind-ad' ||
    subpath === '/vault/bind-order' ||
    subpath === '/vault/payer'

  if (!orderVaultMatch && !evidenceUploadMatch && !evidenceDownloadMatch && !isVaultWrite) {
    return null
  }

  const auth = await requireSession(req, db)
  if (!auth.ok) return auth.response
  const wallet = auth.session.wallet

  // ---- 1. Seal seller payment details (`ad_details` or `order_details`) ----
  if (req.method === 'POST' && subpath === '/vault/details') {
    if (!(await checkRateLimit(db, `rl:vault:details:${wallet}`, 20, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const body = await readJsonBody(req, 16_384)
    if (!body) return json(400, { error: 'bad_request' })

    const kind = body.kind === 'ad_details' || body.kind === 'order_details' ? body.kind : null
    const holderName = sanitizePlainLine(body.holderName, 80)
    const accountDetails = typeof body.accountDetails === 'string' ? body.accountDetails.trim() : ''
    const notes = body.notes !== undefined ? (sanitizePlainLine(body.notes, 200) ?? '') : ''

    if (
      !kind ||
      !holderName ||
      holderName.length < 2 ||
      accountDetails.length < 2 ||
      accountDetails.length > 1500 ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(accountDetails)
    ) {
      return json(400, { error: 'invalid_vault_payload' })
    }

    const payloadObj: SellerDetailsPayload = { holderName, accountDetails, notes }
    const plainBytes = new TextEncoder().encode(JSON.stringify(payloadObj))
    if (plainBytes.byteLength > MAX_JSON_BLOB_BYTES) {
      return json(400, { error: 'invalid_vault_payload' })
    }

    const sealed = await sealBlob(env, plainBytes, vaultAad(kind, wallet))
    // Keep both `ad_details` and `order_details` drafts alive for 8 days before explicit/auto binding
    const ttlSeconds = 8 * 24 * 3600

    const ins = await db.query<{ id: string }>(
      `INSERT INTO public.vault_blobs (
         kind, author, ciphertext, wrapped_key, content_hash, size, delete_after
       )
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
       RETURNING id`,
      [
        kind,
        wallet,
        Buffer.from(sealed.ciphertext),
        Buffer.from(sealed.wrappedKey),
        sealed.contentHash,
        sealed.size,
        ttlSeconds,
      ],
    )
    const id = ins.rows[0]?.id ?? ''
    await writeAudit(db, wallet, `vault.seal.${kind}`, sealed.contentHash.slice(0, 18))

    return json(200, { id, contentHash: sealed.contentHash })
  }

  // ---- 2. Bind `ad_details` blob to mined `adId` ----
  if (req.method === 'POST' && subpath === '/vault/bind-ad') {
    if (!(await checkRateLimit(db, `rl:vault:bind:${wallet}`, 30, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const body = await readJsonBody(req, 4_096)
    if (!body) return json(400, { error: 'bad_request' })

    const blobId = body.blobId !== undefined && body.blobId !== null ? textField(body.blobId, 64) : undefined
    const adId = parsePositiveBigInt(body.adId)
    if ((blobId !== undefined && !/^[0-9a-f-]{36}$/i.test(blobId)) || !adId) {
      return json(400, { error: 'bad_request' })
    }

    const ad = await chain.getAd(adId)
    if (!ad) return json(404, { error: 'ad_not_found' })
    if (ad.maker !== wallet) return json(403, { error: 'forbidden' })

    const retainSec = Math.max(95 * 24 * 3600, Number(ad.expiresAt) - Math.floor(Date.now() / 1000) + 95 * 24 * 3600)
    const upd = blobId
      ? await db.query(
          `UPDATE public.vault_blobs
              SET ad_id = $3,
                  delete_after = now() + make_interval(secs => $4)
            WHERE id = $1::uuid
              AND author = $2
              AND kind = 'ad_details'
              AND content_hash = $5`,
          [blobId, wallet, adId.toString(), retainSec, ad.detailsHash],
        )
      : await db.query(
          `UPDATE public.vault_blobs
              SET ad_id = $2,
                  delete_after = now() + make_interval(secs => $3)
            WHERE author = $1
              AND kind = 'ad_details'
              AND content_hash = $4`,
          [wallet, adId.toString(), retainSec, ad.detailsHash],
        )
    if ((upd.rowCount ?? 0) === 0) {
      return json(404, { error: 'blob_not_found' })
    }
    await writeAudit(db, wallet, 'vault.bind_ad', `ad:${adId.toString()}`)
    return json(200, { ok: true })
  }

  // ---- 2b. Bind `order_details` blob to mined `orderId` (C-06) ----
  if (req.method === 'POST' && subpath === '/vault/bind-order') {
    if (!(await checkRateLimit(db, `rl:vault:bind_order:${wallet}`, 30, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const body = await readJsonBody(req, 4_096)
    if (!body) return json(400, { error: 'bad_request' })

    const blobId = body.blobId !== undefined && body.blobId !== null ? textField(body.blobId, 64) : undefined
    const orderId = parsePositiveBigInt(body.orderId)
    if ((blobId !== undefined && !/^[0-9a-f-]{36}$/i.test(blobId)) || !orderId) {
      return json(400, { error: 'bad_request' })
    }

    const order = await chain.getOrder(orderId)
    if (!order) return json(404, { error: 'order_not_found' })
    if (order.seller !== wallet) return json(403, { error: 'forbidden' })

    const retainSec = 95 * 24 * 3600
    const upd = blobId
      ? await db.query(
          `UPDATE public.vault_blobs
              SET order_id = $3,
                  ad_id = $4,
                  delete_after = now() + make_interval(secs => $5)
            WHERE id = $1::uuid
              AND author = $2
              AND kind = 'order_details'
              AND content_hash = $6`,
          [blobId, wallet, orderId.toString(), order.adId.toString(), retainSec, order.detailsHash],
        )
      : await db.query(
          `UPDATE public.vault_blobs
              SET order_id = $2,
                  ad_id = $3,
                  delete_after = now() + make_interval(secs => $4)
            WHERE author = $1
              AND kind = 'order_details'
              AND content_hash = $5`,
          [wallet, orderId.toString(), order.adId.toString(), retainSec, order.detailsHash],
        )
    if ((upd.rowCount ?? 0) === 0) {
      return json(404, { error: 'blob_not_found' })
    }
    await writeAudit(db, wallet, 'vault.bind_order', `order:${orderId.toString()}`)
    return json(200, { ok: true })
  }

  // ---- 3. Seal buyer `payer` proof before `markPaid` (idempotent + prunes uncommitted drafts) ----
  if (req.method === 'POST' && subpath === '/vault/payer') {
    if (!(await checkRateLimit(db, `rl:vault:payer:${wallet}`, 20, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const body = await readJsonBody(req, 8_192)
    if (!body) return json(400, { error: 'bad_request' })

    const orderId = parsePositiveBigInt(body.orderId)
    if (!orderId) return json(400, { error: 'bad_request' })

    const access = await checkOrderAccess(chain, orderId, wallet)
    if (!access.allowed) {
      return json(access.status, { error: access.error })
    }
    if (access.role !== 'buyer') {
      return json(403, { error: 'forbidden' })
    }
    if (access.order.status !== ORDER_STATUS.PENDING) {
      return json(400, { error: 'invalid_order_status' })
    }

    const transferId = sanitizePlainLine(body.transferId ?? '', 80) ?? ''
    const senderName = sanitizePlainLine(body.senderName ?? '', 80) ?? ''
    const last4 = sanitizePlainLine(body.last4 ?? '', 4) ?? ''
    const paymentMethod = sanitizePlainLine(body.paymentMethod ?? '', 40) ?? ''
    if (last4 && !/^\d{4}$/.test(last4)) {
      return json(400, { error: 'invalid_vault_payload' })
    }

    const nowSec = Math.floor(Date.now() / 1000)
    const pastDeadline = access.order.detailsReady && access.order.deadline > 0n && nowSec > Number(access.order.deadline)
    if (pastDeadline && transferId.length < 2) {
      return json(400, { error: 'transfer_id_required' })
    }
    if (senderName.length < 2 && transferId.length < 2) {
      return json(400, { error: 'invalid_vault_payload' })
    }

    const orderIdStr = orderId.toString()
    const payerObj: BuyerPayerPayload = {
      orderId: orderIdStr,
      transferId,
      senderName,
      last4,
      ...(paymentMethod ? { paymentMethod } : {}),
    }
    const plainBytes = new TextEncoder().encode(JSON.stringify(payerObj))
    // M-03: Bind `orderId` into AES-256-GCM AAD so payer proof hashes cannot be replayed across orders
    const sealed = await sealBlob(env, plainBytes, vaultAad('payer', wallet, orderIdStr))

    // H-04: Return existing row idempotently when the buyer retries signing with the same proof
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM public.vault_blobs
        WHERE order_id = $1 AND kind = 'payer' AND author = $2 AND content_hash = $3
        LIMIT 1`,
      [orderIdStr, wallet, sealed.contentHash],
    )
    if (existing.rows[0]?.id) {
      return json(200, { id: existing.rows[0].id, contentHash: sealed.contentHash })
    }

    const countRes = await db.query<{ cnt: string | number }>(
      `SELECT count(*)::int AS cnt FROM public.vault_blobs WHERE order_id = $1 AND kind = 'payer' AND author = $2`,
      [orderIdStr, wallet],
    )
    const currentCount = Number(countRes.rows[0]?.cnt ?? 0)
    if (currentCount >= MAX_PAYER_BLOBS_PER_ORDER) {
      // Order is still PENDING (unpaid), so older payer blobs are uncommitted wallet-popup retries; prune oldest drafts
      await db.query(
        `DELETE FROM public.vault_blobs
          WHERE id IN (
            SELECT id FROM public.vault_blobs
             WHERE order_id = $1 AND kind = 'payer' AND author = $2
             ORDER BY created_at ASC
             LIMIT $3
          )`,
        [orderIdStr, wallet, currentCount - MAX_PAYER_BLOBS_PER_ORDER + 1],
      )
    }

    const ins = await db.query<{ id: string }>(
      `INSERT INTO public.vault_blobs (
         kind, order_id, author, ciphertext, wrapped_key, content_hash, size, delete_after
       )
       VALUES ('payer', $1, $2, $3, $4, $5, $6, now() + interval '95 days')
       RETURNING id`,
      [
        orderIdStr,
        wallet,
        Buffer.from(sealed.ciphertext),
        Buffer.from(sealed.wrappedKey),
        sealed.contentHash,
        sealed.size,
      ],
    )
    const id = ins.rows[0]?.id ?? ''
    await writeAudit(db, wallet, 'vault.seal.payer', `order:${orderIdStr}`)

    return json(200, { id, contentHash: sealed.contentHash })
  }

  // ---- 4. Read & decrypt order vault (`GET /api/orders/:orderId/vault`) ----
  if (req.method === 'GET' && orderVaultMatch) {
    const orderId = BigInt(orderVaultMatch[1])
    if (!(await checkRateLimit(db, `rl:vault:get:${wallet}`, 60, 60))) {
      return json(429, { error: 'rate_limited' })
    }

    const access = await checkOrderAccess(chain, orderId, wallet)
    if (!access.allowed) {
      return json(access.status, { error: access.error })
    }

    const { order, role } = access

    // H-02: Block non-arbiters from reading encrypted PII after an order has been cancelled
    if (order.status === ORDER_STATUS.CANCELLED && role !== 'arbiter' && role !== 'backup_arbiter') {
      return json(403, { error: 'forbidden' })
    }

    // M-04: Restrict arbiter/backup_arbiter reads to DISPUTED, reviewStartedAt > 0, or PAID >= 15m; audit every privileged read
    if (role === 'arbiter' || role === 'backup_arbiter') {
      const hasFiling = await hasOrderFiling(db, orderId)
      if (!isArbiterOrderReadAllowed(order, role, hasFiling)) {
        return json(403, { error: 'forbidden' })
      }
      await writeAudit(db, wallet, 'vault.arbiter_read', `order:${orderId.toString()}`)
    }

    let sellerDetails: {
      sealed: true
      verifiedHash: true
      contentHash: string
      holderName: string
      accountDetails: string
      notes: string
      kycNameMatch: NameMatchResult
    } | null = null

    // H-02: Never reveal seller payment details to a buyer before Handshake `detailsReady == true`
    const canSeeSellerDetails = role !== 'buyer' || order.detailsReady
    if (canSeeSellerDetails && order.detailsHash && order.detailsHash !== ZERO_BYTES32) {
      const res = await db.query<VaultBlobRow>(
        `SELECT id, kind, ad_id, order_id, author, ciphertext, wrapped_key, content_hash, size
           FROM public.vault_blobs
          WHERE content_hash = $1
            AND author = $2
            AND kind IN ('ad_details', 'order_details')
          ORDER BY created_at DESC
          LIMIT 1`,
        [order.detailsHash, order.seller],
      )
      const blob = res.rows[0]
      if (blob) {
        const plainBytes = await openBlob(
          env,
          toUint8(blob.ciphertext),
          toUint8(blob.wrapped_key),
          vaultAad(blob.kind, order.seller),
          order.detailsHash,
        )
        const parsed = JSON.parse(new TextDecoder().decode(plainBytes)) as SellerDetailsPayload
        const kycNameMatch = await verifyCounterpartyName(env, db, order.seller, parsed.holderName)

        // H-02: Never reset 7-day deletion retention on deleted accounts, and never overwrite `order_id` on shared `ad_details`
        const sellerAcct = await db
          .query<{ deleted_at: string | Date | null }>(
            `SELECT deleted_at FROM public.accounts WHERE wallet = $1 LIMIT 1`,
            [order.seller],
          )
          .catch(() => ({ rows: [] as Array<{ deleted_at: string | Date | null }> }))
        const sellerDeleted = !!sellerAcct.rows[0]?.deleted_at
        if (!sellerDeleted) {
          await db.query(
            `UPDATE public.vault_blobs
                SET order_id = CASE WHEN kind = 'order_details' THEN COALESCE(order_id, $2) ELSE order_id END,
                    ad_id = COALESCE(ad_id, $3),
                    delete_after = GREATEST(COALESCE(delete_after, now()), now() + interval '90 days')
              WHERE id = $1::uuid`,
            [blob.id, order.id.toString(), order.adId.toString()],
          )
        }

        sellerDetails = {
          sealed: true,
          verifiedHash: true,
          contentHash: order.detailsHash,
          holderName: parsed.holderName,
          accountDetails: parsed.accountDetails,
          notes: parsed.notes ?? '',
          kycNameMatch,
        }
      }
    }

    let buyerPayer: {
      sealed: true
      verifiedHash: true
      contentHash: string
      transferId: string
      senderName: string
      last4: string
      paymentMethod: string
      kycNameMatch: NameMatchResult
    } | null = null

    if (order.payerProof && order.payerProof !== ZERO_BYTES32) {
      const orderIdStr = order.id.toString()
      const res = await db.query<VaultBlobRow>(
        `SELECT id, kind, ad_id, order_id, author, ciphertext, wrapped_key, content_hash, size
           FROM public.vault_blobs
          WHERE content_hash = $1
            AND author = $2
            AND order_id = $3
            AND kind = 'payer'
          ORDER BY created_at DESC
          LIMIT 1`,
        [order.payerProof, order.buyer, orderIdStr],
      )
      const blob = res.rows[0]
      if (blob) {
        let plainBytes: Uint8Array
        try {
          plainBytes = await openBlob(
            env,
            toUint8(blob.ciphertext),
            toUint8(blob.wrapped_key),
            vaultAad('payer', order.buyer, orderIdStr),
            order.payerProof,
          )
        } catch (err) {
          if (err instanceof CryptoTamperError) {
            // Backward-compatible read for pre-upgrade payer blobs already bound to `order_id = $3`
            plainBytes = await openBlob(
              env,
              toUint8(blob.ciphertext),
              toUint8(blob.wrapped_key),
              vaultAad('payer', order.buyer),
              order.payerProof,
            )
          } else {
            throw err
          }
        }
        const parsed = JSON.parse(new TextDecoder().decode(plainBytes)) as BuyerPayerPayload
        const kycNameMatch = await verifyCounterpartyName(env, db, order.buyer, parsed.senderName)

        buyerPayer = {
          sealed: true,
          verifiedHash: true,
          contentHash: order.payerProof,
          transferId: parsed.transferId,
          senderName: parsed.senderName,
          last4: parsed.last4,
          paymentMethod: parsed.paymentMethod ?? '',
          kycNameMatch,
        }
      }
    }

    return json(200, {
      orderId: order.id.toString(),
      viewerRole: role,
      sellerDetails,
      buyerPayer,
    })
  }

  // ---- 5. Upload encrypted evidence (`POST /api/orders/:id/evidence`, <= 1 MB, buyer/seller only, active orders, max 10) ----
  if (req.method === 'POST' && evidenceUploadMatch) {
    const orderId = BigInt(evidenceUploadMatch[1])
    if (!(await checkRateLimit(db, `rl:evidence:post:${wallet}`, 10, 60))) {
      return json(429, { error: 'rate_limited' })
    }

    const access = await checkOrderAccess(chain, orderId, wallet)
    if (!access.allowed) return json(access.status, { error: access.error })
    if (access.role !== 'buyer' && access.role !== 'seller') {
      return json(403, { error: 'forbidden' })
    }
    if (
      access.order.status !== ORDER_STATUS.PENDING &&
      access.order.status !== ORDER_STATUS.PAID &&
      access.order.status !== ORDER_STATUS.DISPUTED
    ) {
      return json(400, { error: 'invalid_order_status' })
    }

    const orderIdStr = orderId.toString()
    const evCountRes = await db.query<{ cnt: string | number }>(
      `SELECT count(*)::int AS cnt FROM public.vault_blobs WHERE order_id = $1 AND kind = 'evidence'`,
      [orderIdStr],
    )
    if (Number(evCountRes.rows[0]?.cnt ?? 0) >= MAX_EVIDENCE_BLOBS_PER_ORDER) {
      return json(429, { error: 'evidence_limit_reached' })
    }

    const rawMime = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_EVIDENCE_MIMES.has(rawMime)) {
      return json(400, { error: 'unsupported_media_type' })
    }

    const contentLength = Number(req.headers.get('content-length') ?? '0')
    if (contentLength > MAX_EVIDENCE_BYTES) {
      return json(413, { error: 'evidence_too_large' })
    }

    const buf = await req.arrayBuffer()
    if (buf.byteLength === 0) return json(400, { error: 'bad_request' })
    if (buf.byteLength > MAX_EVIDENCE_BYTES) {
      return json(413, { error: 'evidence_too_large' })
    }
    const rawBytes = new Uint8Array(buf)
    if (!matchesMagicBytes(rawBytes, rawMime)) {
      return json(400, { error: 'invalid_file_signature' })
    }

    const sealed = await sealBlob(env, rawBytes, vaultAad('evidence', wallet, orderIdStr))

    const ins = await db.query<{ id: string }>(
      `INSERT INTO public.vault_blobs (
         kind, order_id, author, mime_type, ciphertext, wrapped_key, content_hash, size, delete_after
       )
       VALUES ('evidence', $1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))
       RETURNING id`,
      [
        orderIdStr,
        wallet,
        rawMime,
        Buffer.from(sealed.ciphertext),
        Buffer.from(sealed.wrappedKey),
        sealed.contentHash,
        sealed.size,
        EVIDENCE_RETENTION_SECONDS,
      ],
    )
    const id = ins.rows[0]?.id ?? ''
    await writeAudit(db, wallet, 'evidence.upload', `order:${orderIdStr}`)

    return json(201, {
      id,
      orderId: orderIdStr,
      contentHash: sealed.contentHash,
      size: sealed.size,
      mimeType: rawMime,
    })
  }

  // ---- 6. Download decrypted evidence (`GET /api/orders/:id/evidence/:blobId`) (H4 + M4) ----
  if (req.method === 'GET' && evidenceDownloadMatch) {
    const orderId = BigInt(evidenceDownloadMatch[1])
    const blobId = evidenceDownloadMatch[2]
    if (!(await checkRateLimit(db, `rl:evidence:get:${wallet}`, 60, 60))) {
      return json(429, { error: 'rate_limited' })
    }

    const access = await checkOrderAccess(chain, orderId, wallet)
    if (!access.allowed) return json(access.status, { error: access.error })

    if (access.role === 'arbiter' || access.role === 'backup_arbiter') {
      const hasFiling = await hasOrderFiling(db, orderId)
      if (!isArbiterOrderReadAllowed(access.order, access.role, hasFiling)) {
        return json(403, { error: 'forbidden' })
      }
      await writeAudit(db, wallet, 'evidence.arbiter_read', `order:${orderId.toString()}`)
    }

    const res = await db.query<VaultBlobRow>(
      `SELECT id, kind, ad_id, order_id, author, mime_type, ciphertext, wrapped_key, content_hash, size
         FROM public.vault_blobs
        WHERE id = $1::uuid
          AND order_id = $2
          AND kind = 'evidence'
        LIMIT 1`,
      [blobId, orderId.toString()],
    )
    const blob = res.rows[0]
    if (!blob) return json(404, { error: 'not_found' })

    const plainBytes = await openBlob(
      env,
      toUint8(blob.ciphertext),
      toUint8(blob.wrapped_key),
      vaultAad('evidence', blob.author.toLowerCase() as `0x${string}`, orderId.toString()),
      blob.content_hash,
    )

    const outBuf = new Uint8Array(plainBytes.byteLength)
    outBuf.set(plainBytes)
    const mime = blob.mime_type ?? 'application/octet-stream'
    const ext = MIME_EXTENSIONS[mime] ?? 'bin'
    return new Response(outBuf, {
      status: 200,
      headers: {
        'content-type': mime,
        'content-disposition': `attachment; filename="evidence-${blobId}.${ext}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  }

  return null
}
