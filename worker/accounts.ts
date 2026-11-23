import {
  requireSession,
  sha256Hex,
  signHmacToken,
  timingSafeEqualBytes,
  verifyHmacToken,
} from './auth'
import { openText, sealText } from './crypto'
import type { ChainReader } from './chain'
import { checkRateLimit, withTx, writeAudit, type Queryable } from './db'
import {
  clientIp,
  isDiditSandbox,
  json,
  normalizeWallet,
  publicAppOrigin,
  readJsonBody,
  textField,
  type Env,
} from './env'

export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60_000 // 24 hours
export const EMAIL_UNSUB_TTL_MS = 180 * 24 * 60 * 60_000 // 180 days

export interface AccountRow {
  wallet: string
  display_name: string | null
  country: string | null
  email_enc: string | null
  email_verified_at: string | Date | null
  email_opt_in: boolean
  kyc_status: string
  kyc_level: number
  kyc_expires_at: string | Date | null
  consent_at: string | Date | null
  created_at: string | Date
  deleted_at: string | Date | null
}

export interface EmailVerifySender {
  (params: {
    env: Env
    toEmail: string
    wallet: `0x${string}`
    verifyUrl: string
    unsubscribeUrl: string
  }): Promise<{ queued: boolean; reason?: string }>
}

const EMAIL_RE = /^[^\s@<>,"']+@[^\s@<>,"']+\.[A-Za-z]{2,24}$/
const COUNTRY_RE = /^[A-Z]{2,3}$/

export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const maskedLocal =
    local.length <= 2 ? `${local[0] ?? '*'}***` : `${local[0]}***${local[local.length - 1]}`
  return `${maskedLocal}@${domain}`
}

function toIsoOrNull(val: string | Date | null | undefined): string | null {
  if (!val) return null
  return val instanceof Date ? val.toISOString() : new Date(val).toISOString()
}

export interface SavedPaymentMethodItem {
  id: string
  methodBit: number
  methodName: string
  holderName: string
  accountNumber: string
  bankOrBranch: string
  notes: string
  updatedAt: string
}

const MAX_SAVED_PAYMENT_METHODS = 20
const PM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const CTRL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/

function emailAad(wallet: `0x${string}`): string {
  return `account:email:${wallet}`
}

function paymentMethodsAad(wallet: `0x${string}`): string {
  return `account:pm:${wallet}`
}

function sanitizeSavedPaymentMethods(raw: unknown, nowIso: string): SavedPaymentMethodItem[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SAVED_PAYMENT_METHODS) return null
  const seenIds = new Set<string>()
  const out: SavedPaymentMethodItem[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null
    const e = entry as Record<string, unknown>
    const id = typeof e.id === 'string' ? e.id.trim() : ''
    const methodBit = typeof e.methodBit === 'number' && Number.isInteger(e.methodBit) ? e.methodBit : -1
    const methodName = typeof e.methodName === 'string' ? e.methodName.trim() : ''
    const holderName = typeof e.holderName === 'string' ? e.holderName.trim() : ''
    const accountNumber = typeof e.accountNumber === 'string' ? e.accountNumber.trim() : ''
    const bankOrBranch = typeof e.bankOrBranch === 'string' ? e.bankOrBranch.trim() : ''
    const notes = typeof e.notes === 'string' ? e.notes.trim() : ''

    if (!PM_ID_RE.test(id) || seenIds.has(id)) return null
    if (methodBit < 0 || methodBit > 31) return null
    if (methodName.length < 1 || methodName.length > 48 || CTRL_CHAR_RE.test(methodName)) return null
    if (holderName.length < 2 || holderName.length > 80 || CTRL_CHAR_RE.test(holderName)) return null
    if (accountNumber.length < 2 || accountNumber.length > 160 || CTRL_CHAR_RE.test(accountNumber)) return null
    if (bankOrBranch.length > 120 || CTRL_CHAR_RE.test(bankOrBranch)) return null
    if (notes.length > 160 || CTRL_CHAR_RE.test(notes)) return null

    seenIds.add(id)
    out.push({
      id,
      methodBit,
      methodName,
      holderName,
      accountNumber,
      bankOrBranch,
      notes,
      updatedAt: nowIso,
    })
  }
  return out
}

export async function mintEmailVerifyUrl(
  env: Env,
  origin: string,
  wallet: `0x${string}`,
  normalizedEmail: string,
  nowMs = Date.now(),
): Promise<string> {
  const emailHash = await sha256Hex(normalizedEmail)
  const token = await signHmacToken(env, {
    kind: 'email_verify',
    sub: wallet,
    eh: emailHash,
    exp: nowMs + EMAIL_VERIFY_TTL_MS,
  })
  // Fragment (#) keeps bearer verification tokens out of server access logs and studio URL sync
  return `${origin}/p2p#verify_email=${encodeURIComponent(token)}`
}

export async function mintUnsubscribeUrl(
  env: Env,
  origin: string,
  wallet: `0x${string}`,
  nowMs = Date.now(),
): Promise<string> {
  const token = await signHmacToken(env, {
    kind: 'email_unsub',
    sub: wallet,
    exp: nowMs + EMAIL_UNSUB_TTL_MS,
  })
  return `${origin}/p2p#unsubscribe=${encodeURIComponent(token)}`
}

async function formatAccountPayload(env: Env, wallet: `0x${string}`, row: AccountRow | undefined) {
  const diditMode = isDiditSandbox(env) ? 'sandbox' : 'live'
  if (!row || row.deleted_at) {
    return {
      exists: false,
      wallet,
      displayName: null,
      country: null,
      hasEmail: false,
      emailMasked: null,
      emailVerified: false,
      emailOptIn: false,
      kycStatus: 'none',
      kycLevel: 0,
      kycExpiresAt: null,
      consentAt: null,
      createdAt: null,
      diditMode,
    }
  }

  let emailMasked: string | null = null
  if (row.email_enc) {
    try {
      const plain = await openText(env, row.email_enc, emailAad(wallet))
      emailMasked = maskEmail(plain)
    } catch {
      emailMasked = null
    }
  }

  return {
    exists: true,
    wallet,
    displayName: row.display_name,
    country: row.country,
    hasEmail: !!emailMasked,
    emailMasked,
    emailVerified: !!row.email_verified_at,
    emailOptIn: row.email_opt_in,
    kycStatus: row.kyc_status,
    kycLevel: Number(row.kyc_level),
    kycExpiresAt: toIsoOrNull(row.kyc_expires_at),
    consentAt: toIsoOrNull(row.consent_at),
    createdAt: toIsoOrNull(row.created_at),
    diditMode,
  }
}

async function loadAccountRow(db: Queryable, wallet: `0x${string}`): Promise<AccountRow | undefined> {
  const res = await db.query<AccountRow>(
    `SELECT wallet, display_name, country, email_enc, email_verified_at, email_opt_in,
            kyc_status, kyc_level, kyc_expires_at, consent_at, created_at, deleted_at
       FROM public.accounts
      WHERE wallet = $1
      LIMIT 1`,
    [wallet],
  )
  return res.rows[0]
}

const defaultVerifySender: EmailVerifySender = async ({ env, toEmail, verifyUrl, unsubscribeUrl }) => {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.EMAIL_FROM?.trim()
  if (!apiKey || !from) {
    return { queued: false, reason: 'email_not_configured' }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [toEmail],
        subject: 'Confirm your OnPeer P2P alert email',
        text: [
          'Confirm this email address to receive OnPeer P2P trade and dispute alerts:',
          verifyUrl,
          '',
          'This link expires in 24 hours. If you did not request this, ignore this email or opt out:',
          unsubscribeUrl,
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok ? { queued: true } : { queued: false, reason: 'email_send_failed' }
  } catch {
    return { queued: false, reason: 'email_send_failed' }
  }
}

/**
 * Handle:
 * - `GET    /api/account`
 * - `PUT    /api/account`
 * - `POST   /api/account/email/resend`
 * - `DELETE /api/account`
 * - `POST   /api/email/verify`
 * - `POST   /api/email/unsubscribe`
 */
export async function handleAccountRoutes(
  req: Request,
  env: Env,
  db: Queryable,
  subpath: string,
  opts?: { sendVerifyEmail?: EmailVerifySender; nowMs?: number; chain?: ChainReader },
): Promise<Response | null> {
  const ip = clientIp(req)
  const nowMs = opts?.nowMs ?? Date.now()
  const sendVerify = opts?.sendVerifyEmail ?? defaultVerifySender
  const reqUrl = new URL(req.url)
  const origin = publicAppOrigin(env, reqUrl)

  // Public token endpoints (clicked from user's email client, bearer token in POST JSON body)
  if (req.method === 'POST' && subpath === '/email/verify') {
    if (!(await checkRateLimit(db, `rl:email:verify:${ip}`, 15, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const body = await readJsonBody(req, 4_096)
    const token = body ? textField(body.token, 1_024) : undefined
    if (!token) return json(400, { error: 'bad_request' })

    const verified = await verifyHmacToken(env, token, nowMs)
    const wallet = verified ? normalizeWallet(verified.sub) : null
    const expectedHash = verified && typeof verified.eh === 'string' ? verified.eh : null
    if (!verified || verified.kind !== 'email_verify' || !wallet || !expectedHash) {
      return json(400, { error: 'invalid_or_expired_token' })
    }

    const row = await loadAccountRow(db, wallet)
    if (!row || row.deleted_at || !row.email_enc) {
      return json(400, { error: 'invalid_or_expired_token' })
    }

    let currentEmail: string
    try {
      currentEmail = await openText(env, row.email_enc, emailAad(wallet))
    } catch {
      return json(400, { error: 'invalid_or_expired_token' })
    }

    const actualHash = await sha256Hex(currentEmail)
    const enc = new TextEncoder()
    if (!timingSafeEqualBytes(enc.encode(actualHash), enc.encode(expectedHash))) {
      return json(400, { error: 'invalid_or_expired_token' })
    }

    await db.query(
      `UPDATE public.accounts
          SET email_verified_at = COALESCE(email_verified_at, now()),
              email_opt_in = true
        WHERE wallet = $1 AND deleted_at IS NULL`,
      [wallet],
    )
    await writeAudit(db, wallet, 'account.email_verified', null)
    return json(200, { ok: true })
  }

  if (req.method === 'POST' && subpath === '/email/unsubscribe') {
    if (!(await checkRateLimit(db, `rl:email:unsub:${ip}`, 20, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const body = await readJsonBody(req, 4_096)
    const token = body ? textField(body.token, 1_024) : undefined
    if (!token) return json(400, { error: 'bad_request' })

    const verified = await verifyHmacToken(env, token, nowMs)
    const wallet = verified ? normalizeWallet(verified.sub) : null
    if (!verified || verified.kind !== 'email_unsub' || !wallet) {
      return json(400, { error: 'invalid_or_expired_token' })
    }

    await db.query(`UPDATE public.accounts SET email_opt_in = false WHERE wallet = $1`, [wallet])
    await db.query(
      `UPDATE public.notifications_outbox
          SET status = 'skipped'
        WHERE wallet = $1 AND status = 'pending'`,
      [wallet],
    )
    await writeAudit(db, wallet, 'account.email_unsubscribed', null)
    return json(200, { ok: true })
  }

  // Authenticated `/api/account*` routes
  if (subpath !== '/account' && !subpath.startsWith('/account/')) {
    return null
  }

  const auth = await requireSession(req, db)
  if (!auth.ok) return auth.response
  const wallet = auth.session.wallet

  if (req.method === 'GET' && subpath === '/account') {
    if (!(await checkRateLimit(db, `rl:acct:get:${wallet}`, 60, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const row = await loadAccountRow(db, wallet)
    return json(200, await formatAccountPayload(env, wallet, row))
  }

  if (req.method === 'PUT' && subpath === '/account') {
    if (!(await checkRateLimit(db, `rl:acct:put:${wallet}`, 15, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const body = await readJsonBody(req, 16_384)
    if (!body) return json(400, { error: 'bad_request' })

    const existing = await loadAccountRow(db, wallet)
    const hasPriorConsent = !!(existing && !existing.deleted_at && existing.consent_at)
    const consentAccepted = body.consent === true || hasPriorConsent
    if (!consentAccepted) {
      return json(400, { error: 'consent_required' })
    }

    // Validate displayName
    let displayName: string | null = existing && !existing.deleted_at ? existing.display_name : null
    if (body.displayName !== undefined) {
      if (body.displayName === null || body.displayName === '') {
        displayName = null
      } else if (typeof body.displayName === 'string') {
        const cleaned = body.displayName.trim()
        if (cleaned.length < 1 || cleaned.length > 48 || /[<>\\\u0000-\u001F]/.test(cleaned)) {
          return json(400, { error: 'invalid_display_name' })
        }
        displayName = cleaned
      } else {
        return json(400, { error: 'invalid_display_name' })
      }
    }

    // Validate country
    let country: string | null = existing && !existing.deleted_at ? existing.country : null
    if (body.country !== undefined) {
      if (body.country === null || body.country === '') {
        country = null
      } else if (typeof body.country === 'string') {
        const up = body.country.trim().toUpperCase()
        if (!COUNTRY_RE.test(up)) {
          return json(400, { error: 'invalid_country' })
        }
        country = up
      } else {
        return json(400, { error: 'invalid_country' })
      }
    }

    // Validate email & double opt-in transition
    let currentPlainEmail: string | null = null
    if (existing && !existing.deleted_at && existing.email_enc) {
      try {
        currentPlainEmail = await openText(env, existing.email_enc, emailAad(wallet))
      } catch {
        currentPlainEmail = null
      }
    }

    let nextEmailEnc: string | null = existing && !existing.deleted_at ? existing.email_enc : null
    let keepVerified = !!(existing && !existing.deleted_at && existing.email_verified_at)
    let emailOptIn = existing && !existing.deleted_at ? existing.email_opt_in : false
    let emailToVerify: string | null = null

    if (typeof body.emailOptIn === 'boolean') {
      emailOptIn = body.emailOptIn
    }

    if (body.email !== undefined) {
      if (body.email === null || body.email === '') {
        if (keepVerified) {
          return json(403, { error: 'email_locked' })
        }
        nextEmailEnc = null
        keepVerified = false
        emailOptIn = false
      } else if (typeof body.email === 'string') {
        const normEmail = body.email.trim().toLowerCase()
        if (normEmail.length > 254 || !EMAIL_RE.test(normEmail)) {
          return json(400, { error: 'invalid_email' })
        }
        if (normEmail !== currentPlainEmail) {
          if (keepVerified) {
            return json(403, { error: 'email_locked' })
          }
          nextEmailEnc = await sealText(env, normEmail, emailAad(wallet))
          keepVerified = false
          emailToVerify = normEmail
        }
      } else {
        return json(400, { error: 'invalid_email' })
      }
    }

    const upserted = await db.query<AccountRow>(
      `INSERT INTO public.accounts (
         wallet, display_name, country, email_enc, email_verified_at, email_opt_in, consent_at, deleted_at
       )
       VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END, $6, now(), NULL)
       ON CONFLICT (wallet) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             country = EXCLUDED.country,
             email_enc = EXCLUDED.email_enc,
             email_verified_at = CASE
               WHEN $5 THEN public.accounts.email_verified_at
               ELSE NULL
             END,
             email_opt_in = EXCLUDED.email_opt_in,
             consent_at = COALESCE(public.accounts.consent_at, now()),
             deleted_at = NULL
       RETURNING wallet, display_name, country, email_enc, email_verified_at, email_opt_in,
                 kyc_status, kyc_level, kyc_expires_at, consent_at, created_at, deleted_at`,
      [wallet, displayName, country, nextEmailEnc, keepVerified, emailOptIn],
    )
    await writeAudit(db, wallet, 'account.upsert', null)

    let verificationEmail: { queued: boolean; reason?: string } | undefined
    if (emailToVerify) {
      const [verifyUrl, unsubscribeUrl] = await Promise.all([
        mintEmailVerifyUrl(env, origin, wallet, emailToVerify, nowMs),
        mintUnsubscribeUrl(env, origin, wallet, nowMs),
      ])
      verificationEmail = await sendVerify({
        env,
        toEmail: emailToVerify,
        wallet,
        verifyUrl,
        unsubscribeUrl,
      })
    }

    return json(200, {
      ...(await formatAccountPayload(env, wallet, upserted.rows[0])),
      ...(verificationEmail ? { verificationEmail } : {}),
    })
  }

  if (req.method === 'GET' && subpath === '/account/payment-methods') {
    if (!(await checkRateLimit(db, `rl:acct:pm:get:${wallet}`, 60, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const res = await db.query<{ payment_methods_enc: string | null; deleted_at: string | Date | null }>(
      `SELECT payment_methods_enc, deleted_at FROM public.accounts WHERE wallet = $1 LIMIT 1`,
      [wallet],
    )
    const row = res.rows[0]
    if (!row || row.deleted_at || !row.payment_methods_enc) {
      return json(200, { paymentMethods: [] })
    }
    try {
      const plain = await openText(env, row.payment_methods_enc, paymentMethodsAad(wallet))
      const parsed = JSON.parse(plain) as unknown
      return json(200, { paymentMethods: Array.isArray(parsed) ? parsed : [] })
    } catch {
      return json(200, { paymentMethods: [] })
    }
  }

  if (req.method === 'PUT' && subpath === '/account/payment-methods') {
    if (!(await checkRateLimit(db, `rl:acct:pm:put:${wallet}`, 20, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const body = await readJsonBody(req, 32_768)
    if (!body) return json(400, { error: 'bad_request' })

    const nowIso = new Date(nowMs).toISOString()
    const sanitized = sanitizeSavedPaymentMethods(body.paymentMethods, nowIso)
    if (!sanitized) {
      return json(400, { error: 'invalid_payment_methods' })
    }

    const enc =
      sanitized.length > 0 ? await sealText(env, JSON.stringify(sanitized), paymentMethodsAad(wallet)) : null

    await db.query(
      `INSERT INTO public.accounts (wallet, payment_methods_enc, consent_at, deleted_at)
       VALUES ($1, $2, now(), NULL)
       ON CONFLICT (wallet) DO UPDATE
         SET payment_methods_enc = EXCLUDED.payment_methods_enc,
             consent_at = COALESCE(public.accounts.consent_at, now()),
             deleted_at = NULL`,
      [wallet, enc],
    )
    await writeAudit(db, wallet, 'account.payment_methods_saved', `count:${sanitized.length}`)
    return json(200, { paymentMethods: sanitized })
  }

  if (req.method === 'POST' && subpath === '/account/email/resend') {
    if (!(await checkRateLimit(db, `rl:acct:resend:${wallet}`, 3, 300))) {
      return json(429, { error: 'rate_limited' })
    }
    const row = await loadAccountRow(db, wallet)
    if (!row || row.deleted_at || !row.email_enc) {
      return json(400, { error: 'no_email_set' })
    }
    if (row.email_verified_at) {
      return json(200, { queued: false, reason: 'already_verified' })
    }
    const plainEmail = await openText(env, row.email_enc, emailAad(wallet))
    const [verifyUrl, unsubscribeUrl] = await Promise.all([
      mintEmailVerifyUrl(env, origin, wallet, plainEmail, nowMs),
      mintUnsubscribeUrl(env, origin, wallet, nowMs),
    ])
    const res = await sendVerify({ env, toEmail: plainEmail, wallet, verifyUrl, unsubscribeUrl })
    await writeAudit(db, wallet, 'account.email_verify_resent', null)
    return json(200, res)
  }

  if (req.method === 'DELETE' && subpath === '/account') {
    if (!(await checkRateLimit(db, `rl:acct:del:${wallet}`, 5, 300))) {
      return json(429, { error: 'rate_limited' })
    }
    // Block account deletion while the wallet has any open orders or active ads onchain
    if (opts?.chain) {
      const openOrders = await opts.chain.getOpenOrderCount(wallet)
      if (openOrders > 0n) {
        return json(409, { error: 'open_orders_remain' })
      }
      const adIds = await opts.chain.getUserAdIds(wallet)
      const nowSec = Math.floor(nowMs / 1000)
      for (const adId of adIds) {
        const ad = await opts.chain.getAd(adId)
        if (ad && !ad.closed && Number(ad.expiresAt) > nowSec) {
          return json(409, { error: 'active_ads_remain' })
        }
      }
    }
    await withTx(db, async (tx) => {
      const existing = await loadAccountRow(tx, wallet)
      const shouldRevokeOnchain =
        existing && (existing.kyc_status === 'approved' || Number(existing.kyc_level) > 0)

      await tx.query(
        `UPDATE public.accounts
            SET display_name = NULL,
                country = NULL,
                email_enc = NULL,
                email_verified_at = NULL,
                email_opt_in = false,
                payment_methods_enc = NULL,
                kyc_status = CASE WHEN kyc_status = 'approved' THEN 'revoked' ELSE 'none' END,
                kyc_level = 0,
                kyc_expires_at = NULL,
                kyc_name_enc = NULL,
                approved_session_id = NULL,
                consent_at = NULL,
                deleted_at = now()
          WHERE wallet = $1`,
        [wallet],
      )
      await tx.query(
        `UPDATE public.sessions SET revoked_at = now() WHERE wallet = $1 AND revoked_at IS NULL`,
        [wallet],
      )
      await tx.query(
        `UPDATE public.notifications_outbox SET status = 'skipped' WHERE wallet = $1 AND status = 'pending'`,
        [wallet],
      )
      await tx.query(
        `DELETE FROM public.p2p_relations WHERE actor = $1 OR target = $1`,
        [wallet],
      )
      await tx.query(
        `UPDATE public.p2p_feedback SET anonymous = true WHERE from_wallet = $1`,
        [wallet],
      )
      // Immediately delete author's truly unbound draft blobs (never touch ad_details bound to an ad)
      await tx.query(
        `DELETE FROM public.vault_blobs WHERE author = $1 AND order_id IS NULL AND ad_id IS NULL`,
        [wallet],
      )
      // Shorten retention to 7 days for remaining bound vault blobs, chat messages, and dispute filings
      await tx.query(
        `UPDATE public.vault_blobs
            SET delete_after = LEAST(COALESCE(delete_after, now() + interval '7 days'), now() + interval '7 days')
          WHERE author = $1 AND (order_id IS NOT NULL OR ad_id IS NOT NULL)`,
        [wallet],
      )
      await tx.query(
        `UPDATE public.chat_messages
            SET delete_after = LEAST(COALESCE(delete_after, now() + interval '7 days'), now() + interval '7 days')
          WHERE author = $1`,
        [wallet],
      )
      await tx.query(
        `UPDATE public.dispute_filings
            SET delete_after = LEAST(COALESCE(delete_after, now() + interval '7 days'), now() + interval '7 days')
          WHERE filed_by = $1`,
        [wallet],
      )
      if (shouldRevokeOnchain) {
        await tx.query(
          `INSERT INTO public.onchain_jobs (kind, payload, status, run_after)
           VALUES ('revoke_verification', $1::jsonb, 'pending', now())`,
          [JSON.stringify({ wallet, reason: 'account_deleted' })],
        )
      }
      await writeAudit(tx, wallet, 'account.deleted', null)
    })
    return json(200, { ok: true })
  }

  return json(404, { error: 'not_found' })
}
