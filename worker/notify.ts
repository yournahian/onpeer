/**
 * worker/notify.ts — Email notification sender & outbox processor
 *
 * Rules:
 *  - Never put payment details, names, chat content, or private info in email body.
 *  - Only order IDs + links + event descriptions.
 *  - Respect email_opt_in; skip if false or email not verified.
 *  - Each outbox row is processed at most MAX_ATTEMPTS times; then marked 'failed'.
 *  - Signed unsubscribe link (180-day HMAC token) appended to every notification email.
 */
import { mintUnsubscribeUrl } from './accounts'
import { openText } from './crypto'
import { type Queryable } from './db'
import { publicAppOrigin, type Env } from './env'

const MAX_ATTEMPTS = 3
const BATCH_SIZE = 20
// Email AAD matches what accounts.ts uses when sealing the email address
const EMAIL_AAD = (wallet: `0x${string}`) => `account:email:${wallet}`

// ---- Event definitions ----
type NotifyEvent =
  | 'kyc_approved'
  | 'kyc_declined'
  | 'kyc_expired'
  | 'order_opened'
  | 'order_paid'
  | 'order_completed'
  | 'order_disputed'
  | 'dispute_filed'

function eventSubject(event: string): string {
  switch (event as NotifyEvent) {
    case 'kyc_approved':     return 'Your OnPeer identity verification was approved'
    case 'kyc_declined':     return 'Your OnPeer identity verification was not approved'
    case 'kyc_expired':      return 'Your OnPeer identity verification has expired'
    case 'order_opened':     return 'New trade order opened on OnPeer'
    case 'order_paid':       return 'Your OnPeer trade order has been marked paid'
    case 'order_completed':  return 'Your OnPeer trade order is complete'
    case 'order_disputed':   return 'A dispute has been opened on your OnPeer order'
    case 'dispute_filed':    return 'A dispute statement was filed on your OnPeer order'
    default:                 return 'OnPeer notification'
  }
}

function eventBody(event: string, orderId: bigint | null, appOrigin: string): string {
  const link = orderId
    ? `${appOrigin}/p2p?order=${orderId.toString()}`
    : `${appOrigin}/p2p`

  switch (event as NotifyEvent) {
    case 'kyc_approved':
      return [
        'Your identity verification on OnPeer P2P has been approved.',
        '',
        `View your account: ${appOrigin}/p2p`,
      ].join('\n')

    case 'kyc_declined':
      return [
        'Your identity verification on OnPeer P2P was not approved.',
        'Please contact support or start a new verification.',
        '',
        `View your account: ${appOrigin}/p2p`,
      ].join('\n')

    case 'kyc_expired':
      return [
        'Your identity verification on OnPeer P2P has expired.',
        'Please complete a new verification to continue trading at higher tiers.',
        '',
        `View your account: ${appOrigin}/p2p`,
      ].join('\n')

    case 'order_opened':
      return [
        orderId ? `A new trade order (#${orderId.toString()}) has been opened.` : 'A new trade order has been opened.',
        '',
        `View order: ${link}`,
      ].join('\n')

    case 'order_paid':
      return [
        orderId ? `Order #${orderId.toString()} has been marked as paid.` : 'Your order has been marked as paid.',
        'Please release the USDC once you have confirmed receipt.',
        '',
        `View order: ${link}`,
      ].join('\n')

    case 'order_completed':
      return [
        orderId ? `Order #${orderId.toString()} has been completed successfully.` : 'Your order has completed.',
        '',
        `View order: ${link}`,
      ].join('\n')

    case 'order_disputed':
      return [
        orderId ? `A dispute has been opened on order #${orderId.toString()}.` : 'A dispute has been opened on your order.',
        'The arbiter will review the case. Please file your dispute statement through the app.',
        '',
        `View order: ${link}`,
      ].join('\n')

    case 'dispute_filed':
      return [
        orderId ? `A dispute statement has been filed on order #${orderId.toString()}.` : 'A dispute statement has been filed on your order.',
        'The arbiter will review the submitted evidence.',
        '',
        `View order: ${link}`,
      ].join('\n')

    default:
      return `You have a new notification on OnPeer.\n\n${link}`
  }
}

interface OutboxRow {
  id: string
  wallet: string
  event: string
  order_id: string | null
  attempts: number
}

interface AccountEmailRow {
  email_enc: string | null
  email_verified_at: string | null
  email_opt_in: boolean
}

/**
 * Queue a notification for delivery.
 * Safe to call fire-and-forget; errors are caught internally.
 * Uses dedupe_key to prevent duplicate rows for the same wallet+event+orderId combo.
 */
export async function queueNotification(
  db: Queryable,
  wallet: `0x${string}`,
  event: string,
  orderId?: bigint | null,
): Promise<void> {
  const dedupeKey = orderId
    ? `${event}:${wallet}:${orderId.toString()}`
    : `${event}:${wallet}`
  await db.query(
    `INSERT INTO public.notifications_outbox (wallet, event, order_id, dedupe_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [wallet, event, orderId ? orderId.toString() : null, dedupeKey],
  )
}

/**
 * Resend API call — returns true on success.
 * Never logs any email address or message content.
 */
async function sendEmail(
  env: Env,
  toEmail: string,
  subject: string,
  body: string,
): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.EMAIL_FROM?.trim()
  if (!apiKey || !from) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to: [toEmail], subject, text: body }),
      signal: AbortSignal.timeout(12_000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Process up to BATCH_SIZE pending outbox rows.
 * Called from the cron scheduled handler every minute.
 * Skips rows where the wallet has no verified opted-in email.
 */
export async function processNotificationsOutbox(env: Env, db: Queryable): Promise<void> {
  // Claim a batch atomically: bump attempts, mark 'processing', stamp claimed_at (L3)
  // Only re-claim stale 'processing' rows older than 5 minutes so overlapping cron runs never double-send.
  const claimed = await db.query<OutboxRow>(
    `UPDATE public.notifications_outbox
        SET status = 'processing',
            attempts = attempts + 1,
            claimed_at = now()
      WHERE id IN (
        SELECT id FROM public.notifications_outbox
         WHERE (
                 status = 'pending'
                 OR (status = 'processing' AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes'))
               )
           AND attempts < $1
           AND send_after <= now()
         ORDER BY id ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, wallet, event, order_id, attempts`,
    [MAX_ATTEMPTS, BATCH_SIZE],
  )

  if (claimed.rows.length === 0) return

  const appOrigin = publicAppOrigin(env)

  for (const row of claimed.rows) {
    const wallet = row.wallet as `0x${string}`
    const orderId = row.order_id ? BigInt(row.order_id) : null
    let success = false
    let skipReason: string | null = null

    try {
      // Load account email
      const accRes = await db.query<AccountEmailRow>(
        `SELECT email_enc, email_verified_at, email_opt_in
           FROM public.accounts
          WHERE wallet = $1 AND deleted_at IS NULL`,
        [wallet],
      )
      const acc = accRes.rows[0]

      if (!acc?.email_enc || !acc.email_verified_at || !acc.email_opt_in) {
        skipReason = 'no_verified_opt_in_email'
      } else {
        // Decrypt email (AES-GCM — no PII logged)
        let plainEmail: string
        try {
          plainEmail = await openText(env, acc.email_enc, EMAIL_AAD(wallet))
        } catch {
          skipReason = 'email_decrypt_failed'
          continue
        }

        const unsubUrl = await mintUnsubscribeUrl(env, appOrigin, wallet)
        const subject = eventSubject(row.event)
        const bodyText = [
          eventBody(row.event, orderId, appOrigin),
          '',
          '---',
          `Unsubscribe: ${unsubUrl}`,
        ].join('\n')

        success = await sendEmail(env, plainEmail, subject, bodyText)
        if (!success) skipReason = 'send_failed'
      }
    } catch {
      skipReason = 'internal_error'
      // Don't re-throw — keep processing other rows
    } finally {
      if (skipReason) {
        const isFinal = row.attempts >= MAX_ATTEMPTS
        const nextStatus =
          skipReason === 'no_verified_opt_in_email'
            ? 'skipped'
            : isFinal
              ? 'failed'
              : 'pending'
        // L3: Exponential backoff on retries (60s, 300s, 900s)
        const backoffSec = row.attempts <= 1 ? 60 : row.attempts === 2 ? 300 : 900
        await db.query(
          `UPDATE public.notifications_outbox
              SET status = $1,
                  last_error = $2,
                  send_after = CASE WHEN $1 = 'pending' THEN now() + make_interval(secs => $4) ELSE send_after END
            WHERE id = $3`,
          [nextStatus, skipReason, row.id, backoffSec],
        ).catch(() => undefined)
      } else if (success) {
        await db.query(
          `UPDATE public.notifications_outbox SET status = 'sent', last_error = NULL WHERE id = $1`,
          [row.id],
        ).catch(() => undefined)
      }
    }
  }
}
