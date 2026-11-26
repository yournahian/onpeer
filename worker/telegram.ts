/**
 * worker/telegram.ts — Telegram Mini App (`initData` HMAC verification) & Live Trade Alert Bot
 *
 * Security & Zero-PII Design:
 *  - Telegram `chat_id` and `username` are envelope-encrypted at rest (`VAULT_MASTER_KEY`)
 *    with per-wallet AAD (`account:tg:<wallet>`, `account:tg_user:<wallet>`).
 *  - Incoming bot commands (`/start`, `/status`, `/mute`, `/unmute`, `/unlink`) look up accounts
 *    via keyed HMAC-SHA256 (`telegram_id_hash`), never storing raw Telegram IDs in Postgres.
 *  - Webhook endpoint (`POST /api/telegram/webhook`) requires constant-time verification of
 *    `X-Telegram-Bot-Api-Secret-Token` against `env.TELEGRAM_WEBHOOK_SECRET`.
 *  - Mini App one-tap link (`POST /api/telegram/link-miniapp`) verifies `Telegram.WebApp.initData`
 *    per Telegram's official WebApp HMAC-SHA256 specification (`HMAC-SHA256("WebAppData", botToken)`).
 *  - Never puts payment account numbers, real names, or private chat messages into Telegram alerts.
 */
import {
  requireSession,
  sha256Hex,
  signHmacToken,
  timingSafeEqualBytes,
  verifyHmacToken,
} from './auth'
import { formatScopedOrderLabel } from './chain'
import { openText, sealText } from './crypto'
import { checkRateLimit, withTx, writeAudit, type Queryable } from './db'
import {
  clientIp,
  json,
  normalizeWallet,
  publicAppOrigin,
  readJsonBody,
  textField,
  type Env,
} from './env'

export const TELEGRAM_LINK_TTL_MS = 15 * 60_000 // 15 minutes
export const TELEGRAM_INIT_DATA_MAX_AGE_SEC = 24 * 3_600 // 24 hours

export const tgChatAad = (wallet: `0x${string}`) => `account:tg:${wallet}`
export const tgUserAad = (wallet: `0x${string}`) => `account:tg_user:${wallet}`

const BOT_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/
const TG_USERNAME_CLEAN_RE = /[^A-Za-z0-9_]/g

function hexFromBytes(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0')
  }
  return out
}

function bytesFromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

async function hmacSha256Raw(keyBytes: Uint8Array, messageBytes: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, messageBytes as BufferSource)
  return new Uint8Array(sig)
}

/** Keyed HMAC-SHA256 digest of a Telegram numeric user/chat ID for indexed lookup without storing raw IDs. */
export async function computeTelegramIdHash(env: Env, telegramId: string): Promise<string> {
  const secret = env.SESSION_SECRET?.trim() ?? ''
  if (secret.length < 32) throw new Error('session_secret_missing')
  const enc = new TextEncoder()
  const mac = await hmacSha256Raw(enc.encode(secret), enc.encode(`tg-id:${telegramId}`))
  return hexFromBytes(mac)
}

export interface VerifiedTelegramUser {
  id: string
  username: string | null
  firstName: string | null
  allowsWriteToPm: boolean
  authDate: number
  startParam: string | null
}

/**
 * Verify `window.Telegram.WebApp.initData` per Telegram Mini Apps official spec:
 * 1. Parse URL-encoded key=value pairs, extract `hash`, sort remaining keys alphabetically (`k=v` joined by `\n`).
 * 2. Compute `secret_key = HMAC_SHA256(key="WebAppData", msg=botToken)`.
 * 3. Verify `HMAC_SHA256(key=secret_key, msg=data_check_string) === hash` in constant time.
 * 4. Reject payloads older than `maxAgeSec`.
 */
export async function verifyTelegramInitData(
  initDataRaw: string,
  botToken: string,
  nowSec = Math.floor(Date.now() / 1000),
  maxAgeSec = TELEGRAM_INIT_DATA_MAX_AGE_SEC,
): Promise<VerifiedTelegramUser | null> {
  const trimmedToken = botToken.trim()
  if (!trimmedToken || !initDataRaw || initDataRaw.length > 8_192) return null

  const params = new URLSearchParams(initDataRaw)
  const hashHex = params.get('hash')?.trim().toLowerCase() ?? ''
  const expectedSig = bytesFromHex(hashHex)
  if (!expectedSig || expectedSig.length !== 32) return null

  const pairs: string[] = []
  params.forEach((value, key) => {
    if (key !== 'hash') {
      pairs.push(`${key}=${value}`)
    }
  })
  if (pairs.length === 0) return null
  pairs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const dataCheckString = pairs.join('\n')

  const enc = new TextEncoder()
  const secretKey = await hmacSha256Raw(enc.encode('WebAppData'), enc.encode(trimmedToken))
  const computedSig = await hmacSha256Raw(secretKey, enc.encode(dataCheckString))
  if (!timingSafeEqualBytes(computedSig, expectedSig)) return null

  const authDate = Number(params.get('auth_date') ?? '0')
  if (!Number.isInteger(authDate) || authDate <= 0) return null
  if (authDate > nowSec + 300 || nowSec - authDate > maxAgeSec) return null

  const rawUser = params.get('user')
  if (!rawUser) return null
  try {
    const parsed = JSON.parse(rawUser) as {
      id?: number | string
      username?: string
      first_name?: string
      allows_write_to_pm?: boolean
    }
    const idStr = parsed.id !== undefined ? String(parsed.id) : ''
    if (!/^-?\d{4,20}$/.test(idStr)) return null
    const cleanUser =
      typeof parsed.username === 'string'
        ? parsed.username.replace(TG_USERNAME_CLEAN_RE, '').slice(0, 32) || null
        : null
    const firstName =
      typeof parsed.first_name === 'string' ? parsed.first_name.trim().slice(0, 64) || null : null
    const startParam = params.get('start_param')?.trim().slice(0, 128) || null
    return {
      id: idStr,
      username: cleanUser,
      firstName,
      allowsWriteToPm: parsed.allows_write_to_pm !== false,
      authDate,
      startParam,
    }
  } catch {
    return null
  }
}

export interface TelegramInlineButton {
  text: string
  url?: string
  web_app?: { url: string }
}

export interface SendTelegramOptions {
  chatId: string
  text: string
  buttons?: TelegramInlineButton[][]
  fetchImpl?: typeof globalThis.fetch
}

/**
 * Send a message via Telegram Bot API (`sendMessage`).
 * Never logs chat IDs, usernames, or message contents.
 */
export async function sendTelegramBotMessage(
  env: Env,
  opts: SendTelegramOptions,
): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token || !opts.chatId) return false
  const f = opts.fetchImpl ?? globalThis.fetch
  try {
    const payload: Record<string, unknown> = {
      chat_id: opts.chatId,
      text: opts.text,
      disable_web_page_preview: true,
    }
    if (opts.buttons && opts.buttons.length > 0) {
      payload.reply_markup = { inline_keyboard: opts.buttons }
    }
    const res = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}

function shortWalletLabel(wallet: string): string {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

function configuredBotUsername(env: Env): string | null {
  const raw = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '') ?? ''
  return BOT_USERNAME_RE.test(raw) ? raw : null
}

/** Build a rich, zero-PII Telegram message + Mini App deep-link button for a notification event. */
export function buildTelegramAlertMessage(
  event: string,
  orderId: bigint | null,
  appOrigin: string,
): { text: string; buttons: TelegramInlineButton[][] } {
  const targetUrl = orderId
    ? `${appOrigin}/p2p?order=${orderId.toString()}`
    : `${appOrigin}/p2p`
  const label = orderId ? formatScopedOrderLabel(orderId) : null
  const btnLabel = label ? `Open Order ${label}` : 'Open OnPeer P2P'
  const buttons: TelegramInlineButton[][] = [[{ text: btnLabel, web_app: { url: targetUrl } }]]

  switch (event) {
    case 'order_opened':
      return {
        text: [
          `🔔 New P2P Order${label ? ` ${label}` : ''} Opened`,
          '',
          'A counterparty opened an order on your OnPeer ad. Open the order room to review instructions and chat.',
        ].join('\n'),
        buttons,
      }
    case 'order_paid':
      return {
        text: [
          `💸 Order${label ? ` ${label}` : ''} Marked as Paid`,
          '',
          'Log directly into your bank or mobile wallet app to confirm settled available balance before releasing crypto.',
        ].join('\n'),
        buttons: [[{ text: label ? `Review & Release ${label}` : 'Review Order', web_app: { url: targetUrl } }]],
      }
    case 'order_completed':
      return {
        text: [
          `✅ Order${label ? ` ${label}` : ''} Completed`,
          '',
          'Escrow settlement is complete on Arc.',
        ].join('\n'),
        buttons,
      }
    case 'order_cancelled':
      return {
        text: [
          `❌ Order${label ? ` ${label}` : ''} Cancelled`,
          '',
          'This P2P trade order has been cancelled.',
        ].join('\n'),
        buttons,
      }
    case 'order_disputed':
      return {
        text: [
          `⚠️ Dispute Opened${label ? ` on Order ${label}` : ''}`,
          '',
          'Please open the order room to submit your dispute statement and evidence for the arbiter.',
        ].join('\n'),
        buttons,
      }
    case 'dispute_filed':
      return {
        text: [
          `📄 Dispute Evidence Submitted${label ? ` (Order ${label})` : ''}`,
          '',
          'A dispute statement was filed. Open the order room to review.',
        ].join('\n'),
        buttons,
      }
    case 'case_taken':
      return {
        text: [
          `⚖️ Arbiter Reviewing${label ? ` Order ${label}` : ' Your Dispute'}`,
          '',
          'An OnPeer arbiter has started reviewing the case.',
        ].join('\n'),
        buttons,
      }
    case 'dispute_resolved':
      return {
        text: [
          `🏛️ Dispute Ruling Issued${label ? ` (Order ${label})` : ''}`,
          '',
          'The arbiter has issued an onchain ruling on this order.',
        ].join('\n'),
        buttons,
      }
    case 'order_chat':
      return {
        text: [
          `💬 New Encrypted Message${label ? ` in Order ${label}` : ''}`,
          '',
          'Your counterparty sent a message in the encrypted order chat.',
        ].join('\n'),
        buttons,
      }
    case 'kyc_approved':
      return {
        text: '🛡️ Your OnPeer identity verification was approved!',
        buttons,
      }
    case 'kyc_declined':
      return {
        text: '🛡️ Your OnPeer identity verification could not be approved. Open the app to retry.',
        buttons,
      }
    case 'kyc_expired':
      return {
        text: '🛡️ Your OnPeer identity verification has expired. Renew in the app to keep higher tier limits.',
        buttons,
      }
    default:
      return {
        text: `🔔 You have a new notification on OnPeer.`,
        buttons,
      }
  }
}

interface AccountTelegramRow {
  telegram_chat_id_enc: string | null
  telegram_username_enc: string | null
  telegram_linked_at: string | Date | null
  telegram_opt_in: boolean
  deleted_at: string | Date | null
}

async function loadTelegramAccountRow(
  db: Queryable,
  wallet: `0x${string}`,
): Promise<AccountTelegramRow | undefined> {
  const res = await db.query<AccountTelegramRow>(
    `SELECT telegram_chat_id_enc, telegram_username_enc, telegram_linked_at, telegram_opt_in, deleted_at
       FROM public.accounts
      WHERE wallet = $1
      LIMIT 1`,
    [wallet],
  )
  return res.rows[0]
}

async function saveTelegramLink(
  env: Env,
  db: Queryable,
  wallet: `0x${string}`,
  chatId: string,
  username: string | null,
): Promise<void> {
  const [chatEnc, userEnc, idHash] = await Promise.all([
    sealText(env, chatId, tgChatAad(wallet)),
    username ? sealText(env, username, tgUserAad(wallet)) : Promise.resolve(null),
    computeTelegramIdHash(env, chatId),
  ])

  // Atomic transaction so one Telegram chat is linked to at most one active wallet (H-05)
  await withTx(db, async (tx) => {
    await tx.query(
      `UPDATE public.accounts
          SET telegram_chat_id_enc = NULL,
              telegram_username_enc = NULL,
              telegram_id_hash = NULL,
              telegram_linked_at = NULL,
              telegram_opt_in = false
        WHERE telegram_id_hash = $1 AND wallet <> $2`,
      [idHash, wallet],
    )

    await tx.query(
      `INSERT INTO public.accounts (
         wallet, telegram_chat_id_enc, telegram_username_enc, telegram_id_hash,
         telegram_linked_at, telegram_opt_in, consent_at, deleted_at
       )
       VALUES ($1, $2, $3, $4, now(), true, now(), NULL)
       ON CONFLICT (wallet) DO UPDATE
         SET telegram_chat_id_enc = EXCLUDED.telegram_chat_id_enc,
             telegram_username_enc = EXCLUDED.telegram_username_enc,
             telegram_id_hash = EXCLUDED.telegram_id_hash,
             telegram_linked_at = now(),
             telegram_opt_in = true,
             consent_at = COALESCE(public.accounts.consent_at, now()),
             deleted_at = NULL`,
      [wallet, chatEnc, userEnc, idHash],
    )
  })
}

export interface TelegramRouteOptions {
  fetchImpl?: typeof globalThis.fetch
  nowMs?: number
}

interface TelegramWebhookUpdate {
  update_id?: number
  message?: {
    message_id?: number
    text?: string
    chat?: { id?: number | string; type?: string }
    from?: { id?: number | string; username?: string; first_name?: string }
  }
}

/**
 * Handle `/api/telegram/*`:
 * - `POST   /api/telegram/webhook`       (Telegram Bot webhook, verified with `X-Telegram-Bot-Api-Secret-Token`)
 * - `GET    /api/telegram/status`        (Wallet-authenticated status)
 * - `POST   /api/telegram/link-miniapp`  (Wallet-authenticated 1-tap link via `Telegram.WebApp.initData`)
 * - `POST   /api/telegram/link-token`    (Wallet-authenticated 15m deep-link token for web browsers)
 * - `PUT    /api/telegram/preferences`   (Wallet-authenticated opt-in / mute toggle)
 * - `POST   /api/telegram/test`          (Wallet-authenticated instant test alert)
 * - `DELETE /api/telegram/link`          (Wallet-authenticated unlink)
 */
export async function handleTelegramRoutes(
  req: Request,
  env: Env,
  db: Queryable,
  subpath: string,
  opts?: TelegramRouteOptions,
): Promise<Response | null> {
  const nowMs = opts?.nowMs ?? Date.now()
  const ip = clientIp(req)
  const reqUrl = new URL(req.url)
  const appOrigin = publicAppOrigin(env, reqUrl)
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? ''
  const botUsername = configuredBotUsername(env)

  // ---- 1. Public Telegram Bot Webhook ----
  if (subpath === '/telegram/webhook') {
    if (req.method !== 'POST') {
      return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' })
    }
    const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? ''
    if (!botToken || !webhookSecret) {
      return json(503, { error: 'telegram_not_configured' })
    }

    const headerSecret = req.headers.get('x-telegram-bot-api-secret-token')?.trim() ?? ''
    if (!headerSecret) {
      return json(401, { error: 'unauthorized' })
    }
    const enc = new TextEncoder()
    if (!timingSafeEqualBytes(enc.encode(headerSecret), enc.encode(webhookSecret))) {
      return json(401, { error: 'unauthorized' })
    }

    if (!(await checkRateLimit(db, `rl:tg:wh:${ip}`, 120, 60))) {
      return json(429, { error: 'rate_limited' })
    }

    const update = (await readJsonBody(req, 32_768)) as TelegramWebhookUpdate | null
    if (!update) return json(400, { error: 'bad_request' })

    const msg = update.message
    const chatType = msg?.chat?.type ?? ''
    const rawChatId = msg?.chat?.id !== undefined ? String(msg.chat.id) : ''
    const text = typeof msg?.text === 'string' ? msg.text.trim() : ''

    // Only respond to private 1:1 chats so sensitive trade alerts never go to group chats
    if (!rawChatId || chatType !== 'private' || !text.startsWith('/')) {
      return json(200, { ok: true })
    }

    const [rawCmd = '', arg = ''] = text.split(/\s+/, 2)
    const cmd = rawCmd.toLowerCase().split('@')[0] ?? ''
    const cleanUsername =
      typeof msg?.from?.username === 'string'
        ? msg.from.username.replace(TG_USERNAME_CLEAN_RE, '').slice(0, 32) || null
        : null

    const launchButtons: TelegramInlineButton[][] = [
      [{ text: '🚀 Launch OnPeer Mini App', web_app: { url: `${appOrigin}/p2p` } }],
      [
        { text: '💱 Swap', web_app: { url: `${appOrigin}/swap` } },
        { text: '🌉 Bridge', web_app: { url: `${appOrigin}/bridge` } },
      ],
    ]

    if (cmd === '/start') {
      if (arg.startsWith('link_')) {
        const rawToken = arg.slice(5).trim()
        const verified = await verifyHmacToken(env, rawToken, nowMs)
        const wallet = verified ? normalizeWallet(verified.sub) : null
        if (!verified || verified.kind !== 'tg_link' || !wallet) {
          await sendTelegramBotMessage(env, {
            chatId: rawChatId,
            text: '⚠️ This link token has expired or is invalid.\n\nPlease generate a fresh Telegram link from OnPeer → User Center → Notifications.',
            buttons: launchButtons,
            fetchImpl: opts?.fetchImpl,
          })
          return json(200, { ok: true })
        }

        // H-05: Refuse linking to an explicitly deleted account
        const acctRow = await loadTelegramAccountRow(db, wallet).catch(() => undefined)
        if (acctRow?.deleted_at) {
          await sendTelegramBotMessage(env, {
            chatId: rawChatId,
            text: '⚠️ This OnPeer account has been deleted. Re-activate your account inside the app first.',
            buttons: launchButtons,
            fetchImpl: opts?.fetchImpl,
          })
          return json(200, { ok: true })
        }

        // H-05: Atomically consume single-use `tg_link` token so leaked deep links cannot be replayed
        const tokenJti =
          typeof verified.jti === 'string' && verified.jti.length >= 8
            ? verified.jti
            : (await sha256Hex(rawToken)).slice(0, 36)
        const ttlSec = Math.max(60, Math.ceil((Number(verified.exp) - nowMs) / 1000))
        const consumed = await db.query(
          `INSERT INTO public.rate_limits (bucket, count, reset_at)
           VALUES ($1, 1, now() + make_interval(secs => $2))
           ON CONFLICT (bucket) DO NOTHING`,
          [`tg_link_used:${tokenJti}`, ttlSec],
        )
        if ((consumed.rowCount ?? 0) === 0) {
          await sendTelegramBotMessage(env, {
            chatId: rawChatId,
            text: '⚠️ This Telegram link has already been used.\n\nGenerate a fresh link from OnPeer → User Center → Notifications if needed.',
            buttons: launchButtons,
            fetchImpl: opts?.fetchImpl,
          })
          return json(200, { ok: true })
        }

        await saveTelegramLink(env, db, wallet, rawChatId, cleanUsername)
        await writeAudit(db, wallet, 'telegram.linked_bot', null)

        await sendTelegramBotMessage(env, {
          chatId: rawChatId,
          text: [
            `✅ Connected to OnPeer (${shortWalletLabel(wallet)})!`,
            '',
            'You will now receive instant alerts here whenever:',
            '• Someone opens an order on your P2P ad',
            '• A buyer marks fiat payment as Paid',
            '• Crypto is released or an order is cancelled',
            '• A new encrypted chat message or dispute arrives',
            '',
            'Commands: /status • /mute • /unmute • /unlink',
          ].join('\n'),
          buttons: launchButtons,
          fetchImpl: opts?.fetchImpl,
        })
        return json(200, { ok: true })
      }

      // General /start welcome card
      await sendTelegramBotMessage(env, {
        chatId: rawChatId,
        text: [
          '👋 Welcome to OnPeer — Non-Custodial P2P Crypto, Swap & Bridge for South Asia on Arc!',
          '',
          '• Trade USDC & EURC with BDT, INR, PKR, LKR & NPR at 0% trade fee',
          '• Instant swaps & Circle CCTP/CCTPx bridging',
          '• Link your wallet inside User Center → Notifications to get live trade alerts here',
        ].join('\n'),
        buttons: launchButtons,
        fetchImpl: opts?.fetchImpl,
      })
      return json(200, { ok: true })
    }

    const idHash = await computeTelegramIdHash(env, rawChatId)

    if (cmd === '/status') {
      const found = await db.query<{ wallet: string; telegram_opt_in: boolean }>(
        `SELECT wallet, telegram_opt_in
           FROM public.accounts
          WHERE telegram_id_hash = $1 AND deleted_at IS NULL
          LIMIT 1`,
        [idHash],
      )
      const row = found.rows[0]
      const statusText = row
        ? `🔗 Linked wallet: ${shortWalletLabel(row.wallet)}\n🔔 Trade alerts: ${row.telegram_opt_in ? 'Active' : 'Muted (/unmute to resume)'}`
        : 'ℹ️ No OnPeer wallet is linked to this Telegram chat yet.\n\nOpen OnPeer → User Center → Notifications to connect your wallet.'
      await sendTelegramBotMessage(env, {
        chatId: rawChatId,
        text: statusText,
        buttons: launchButtons,
        fetchImpl: opts?.fetchImpl,
      })
      return json(200, { ok: true })
    }

    if (cmd === '/mute' || cmd === '/stop') {
      const res = await db.query<{ wallet: string }>(
        `UPDATE public.accounts
            SET telegram_opt_in = false
          WHERE telegram_id_hash = $1 AND deleted_at IS NULL
          RETURNING wallet`,
        [idHash],
      )
      const updated = (res.rowCount ?? res.rows.length) > 0
      await sendTelegramBotMessage(env, {
        chatId: rawChatId,
        text: updated
          ? '🔕 OnPeer Telegram alerts paused. Send /unmute anytime to resume.'
          : 'ℹ️ No linked OnPeer wallet found for this chat.',
        fetchImpl: opts?.fetchImpl,
      })
      return json(200, { ok: true })
    }

    if (cmd === '/unmute') {
      const res = await db.query<{ wallet: string }>(
        `UPDATE public.accounts
            SET telegram_opt_in = true
          WHERE telegram_id_hash = $1 AND deleted_at IS NULL
          RETURNING wallet`,
        [idHash],
      )
      const updated = (res.rowCount ?? res.rows.length) > 0
      await sendTelegramBotMessage(env, {
        chatId: rawChatId,
        text: updated
          ? '🔔 OnPeer Telegram alerts resumed!'
          : 'ℹ️ No linked OnPeer wallet found. Connect via User Center → Notifications.',
        buttons: updated ? launchButtons : undefined,
        fetchImpl: opts?.fetchImpl,
      })
      return json(200, { ok: true })
    }

    if (cmd === '/unlink') {
      const res = await db.query<{ wallet: string }>(
        `UPDATE public.accounts
            SET telegram_chat_id_enc = NULL,
                telegram_username_enc = NULL,
                telegram_id_hash = NULL,
                telegram_linked_at = NULL,
                telegram_opt_in = false
          WHERE telegram_id_hash = $1
          RETURNING wallet`,
        [idHash],
      )
      for (const r of res.rows) {
        await writeAudit(db, r.wallet, 'telegram.unlinked_bot', null)
      }
      await sendTelegramBotMessage(env, {
        chatId: rawChatId,
        text:
          res.rows.length > 0
            ? '🔓 Your OnPeer wallet has been unlinked from this Telegram chat.'
            : 'ℹ️ No linked OnPeer wallet found.',
        fetchImpl: opts?.fetchImpl,
      })
      return json(200, { ok: true })
    }

    // /help or any other slash command
    await sendTelegramBotMessage(env, {
      chatId: rawChatId,
      text: [
        '🤖 OnPeer Bot Commands:',
        '/start — Launch OnPeer Mini App',
        '/status — Check linked wallet & alert status',
        '/mute — Pause Telegram trade alerts',
        '/unmute — Resume Telegram trade alerts',
        '/unlink — Disconnect your wallet from Telegram',
        '',
        'Support: support@onpeer.xyz',
      ].join('\n'),
      buttons: launchButtons,
      fetchImpl: opts?.fetchImpl,
    })
    return json(200, { ok: true })
  }

  // ---- 2. Wallet-Authenticated `/api/telegram/*` Routes ----
  if (!subpath.startsWith('/telegram/')) return null

  const auth = await requireSession(req, db)
  if (!auth.ok) return auth.response
  const wallet = auth.session.wallet

  if (req.method === 'GET' && subpath === '/telegram/status') {
    if (!(await checkRateLimit(db, `rl:tg:status:${wallet}`, 60, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    let row: AccountTelegramRow | undefined
    try {
      row = await loadTelegramAccountRow(db, wallet)
    } catch {
      // Graceful fallback if migration 0006 has not been applied yet
      return json(200, {
        configured: !!botToken,
        botUsername,
        linked: false,
        username: null,
        optIn: false,
        linkedAt: null,
      })
    }

    if (!row || row.deleted_at || !row.telegram_chat_id_enc) {
      return json(200, {
        configured: !!botToken,
        botUsername,
        linked: false,
        username: null,
        optIn: false,
        linkedAt: null,
      })
    }

    let username: string | null = null
    if (row.telegram_username_enc) {
      try {
        username = await openText(env, row.telegram_username_enc, tgUserAad(wallet))
      } catch {
        username = null
      }
    }
    const linkedAt = row.telegram_linked_at
      ? row.telegram_linked_at instanceof Date
        ? row.telegram_linked_at.toISOString()
        : new Date(row.telegram_linked_at).toISOString()
      : null

    return json(200, {
      configured: !!botToken,
      botUsername,
      linked: true,
      username,
      optIn: !!row.telegram_opt_in,
      linkedAt,
    })
  }

  if (req.method === 'POST' && subpath === '/telegram/link-miniapp') {
    if (!(await checkRateLimit(db, `rl:tg:linkma:${wallet}`, 10, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    if (!botToken) {
      return json(503, { error: 'telegram_not_configured' })
    }
    const body = await readJsonBody(req, 16_384)
    const initData = body ? textField(body.initData, 8_192) : undefined
    if (!initData) return json(400, { error: 'bad_request' })

    const verifiedUser = await verifyTelegramInitData(initData, botToken, Math.floor(nowMs / 1000))
    if (!verifiedUser) {
      return json(401, { error: 'invalid_telegram_init_data' })
    }

    await saveTelegramLink(env, db, wallet, verifiedUser.id, verifiedUser.username)
    await writeAudit(db, wallet, 'telegram.linked_miniapp', null)

    if (verifiedUser.allowsWriteToPm) {
      await sendTelegramBotMessage(env, {
        chatId: verifiedUser.id,
        text: `✅ Connected to OnPeer (${shortWalletLabel(wallet)}) via Mini App! Instant P2P trade & dispute alerts are now active.`,
        buttons: [[{ text: '🚀 Open OnPeer P2P', web_app: { url: `${appOrigin}/p2p` } }]],
        fetchImpl: opts?.fetchImpl,
      })
    }

    return json(200, {
      ok: true,
      linked: true,
      username: verifiedUser.username,
      optIn: true,
      allowsWriteToPm: verifiedUser.allowsWriteToPm,
    })
  }

  if (req.method === 'POST' && subpath === '/telegram/link-token') {
    if (!(await checkRateLimit(db, `rl:tg:token:${wallet}`, 10, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    if (!botToken || !botUsername) {
      return json(503, { error: 'telegram_not_configured' })
    }
    const existingAcct = await loadTelegramAccountRow(db, wallet).catch(() => undefined)
    if (existingAcct?.deleted_at) {
      return json(403, { error: 'account_deleted' })
    }
    const token = await signHmacToken(env, {
      kind: 'tg_link',
      sub: wallet,
      jti: crypto.randomUUID(),
      exp: nowMs + TELEGRAM_LINK_TTL_MS,
    })
    const deepLink = `https://t.me/${botUsername}?start=link_${encodeURIComponent(token)}`
    return json(200, {
      botUsername,
      deepLink,
      expiresInSeconds: Math.floor(TELEGRAM_LINK_TTL_MS / 1000),
    })
  }

  if (req.method === 'PUT' && subpath === '/telegram/preferences') {
    if (!(await checkRateLimit(db, `rl:tg:pref:${wallet}`, 20, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const body = await readJsonBody(req, 1_024)
    if (!body || typeof body.optIn !== 'boolean') {
      return json(400, { error: 'bad_request' })
    }
    const row = await loadTelegramAccountRow(db, wallet)
    if (!row || row.deleted_at || !row.telegram_chat_id_enc) {
      return json(400, { error: 'telegram_not_linked' })
    }
    await db.query(
      `UPDATE public.accounts
          SET telegram_opt_in = $1
        WHERE wallet = $2 AND deleted_at IS NULL`,
      [body.optIn, wallet],
    )
    await writeAudit(db, wallet, 'telegram.preferences', body.optIn ? 'opt_in' : 'opt_out')
    return json(200, { ok: true, optIn: body.optIn })
  }

  if (req.method === 'POST' && subpath === '/telegram/test') {
    if (!(await checkRateLimit(db, `rl:tg:test:${wallet}`, 3, 300))) {
      return json(429, { error: 'rate_limited' })
    }
    if (!botToken) {
      return json(503, { error: 'telegram_not_configured' })
    }
    const row = await loadTelegramAccountRow(db, wallet)
    if (!row || row.deleted_at || !row.telegram_chat_id_enc) {
      return json(400, { error: 'telegram_not_linked' })
    }
    let chatId: string
    try {
      chatId = await openText(env, row.telegram_chat_id_enc, tgChatAad(wallet))
    } catch {
      return json(500, { error: 'decrypt_failed' })
    }
    const sent = await sendTelegramBotMessage(env, {
      chatId,
      text: `🔔 OnPeer Test Alert — Your wallet (${shortWalletLabel(wallet)}) is connected and ready for instant P2P order notifications!`,
      buttons: [[{ text: '🚀 Open OnPeer P2P', web_app: { url: `${appOrigin}/p2p` } }]],
      fetchImpl: opts?.fetchImpl,
    })
    if (!sent) {
      return json(502, { error: 'telegram_send_failed' })
    }
    return json(200, { ok: true })
  }

  if (req.method === 'DELETE' && subpath === '/telegram/link') {
    if (!(await checkRateLimit(db, `rl:tg:del:${wallet}`, 10, 300))) {
      return json(429, { error: 'rate_limited' })
    }
    await db.query(
      `UPDATE public.accounts
          SET telegram_chat_id_enc = NULL,
              telegram_username_enc = NULL,
              telegram_id_hash = NULL,
              telegram_linked_at = NULL,
              telegram_opt_in = false
        WHERE wallet = $1`,
      [wallet],
    )
    await writeAudit(db, wallet, 'telegram.unlinked', null)
    return json(200, { ok: true })
  }

  return json(404, { error: 'not_found' })
}

/**
 * One-click Admin helper (`POST /api/admin/telegram/setup`) to register:
 *  1. `setWebhook` (`https://<appOrigin>/api/telegram/webhook` + `secret_token`)
 *  2. `setMyCommands` (`/start`, `/status`, `/mute`, `/unmute`, `/unlink`)
 *  3. `setChatMenuButton` (`web_app` -> `https://<appOrigin>/p2p`)
 */
export async function setupTelegramBotWebhook(
  env: Env,
  reqUrl?: URL,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ ok: boolean; error?: string; webhookUrl?: string }> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim()
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim()
  if (!token || !secret) {
    return { ok: false, error: 'telegram_not_configured' }
  }
  const appOrigin = publicAppOrigin(env, reqUrl)
  const webhookUrl = `${appOrigin}/api/telegram/webhook`
  const apiBase = `https://api.telegram.org/bot${token}`

  try {
    const whRes = await fetchImpl(`${apiBase}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ['message'],
        drop_pending_updates: false,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!whRes.ok) return { ok: false, error: 'telegram_webhook_failed' }

    await Promise.all([
      fetchImpl(`${apiBase}/setMyCommands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          commands: [
            { command: 'start', description: 'Launch OnPeer Mini App' },
            { command: 'status', description: 'Check linked wallet & alert status' },
            { command: 'mute', description: 'Pause live P2P trade alerts' },
            { command: 'unmute', description: 'Resume live P2P trade alerts' },
            { command: 'unlink', description: 'Disconnect wallet from Telegram' },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined),
      fetchImpl(`${apiBase}/setChatMenuButton`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          menu_button: {
            type: 'web_app',
            text: 'Open OnPeer',
            web_app: { url: `${appOrigin}/p2p` },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined),
    ])

    return { ok: true, webhookUrl }
  } catch {
    return { ok: false, error: 'telegram_webhook_failed' }
  }
}
