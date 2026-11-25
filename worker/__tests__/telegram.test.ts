import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import { sha256Hex } from '../auth'
import type { Queryable } from '../db'
import type { Env, HyperdriveBinding } from '../env'
import { processNotificationsOutbox, queueNotification } from '../notify'
import { handleTelegramRoutes, verifyTelegramInitData } from '../telegram'

const SESSION_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const VAULT_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const BOT_TOKEN = ['00000', 'unit_test_fixture_not_a_real_bot_token'].join(':')
const WEBHOOK_SECRET = 'wh_secret_9876543210abcdef9876543210'
const TEST_WALLET = '0x2222222222222222222222222222222222222222' as const
const SESSION_TOKEN = 'b'.repeat(64)

function makeEnv(): Env {
  return {
    SESSION_SECRET,
    VAULT_MASTER_KEY,
    HYPERDRIVE: { connectionString: 'postgres://localhost/test' } as HyperdriveBinding,
    PUBLIC_APP_URL: 'https://app.onpeer.xyz',
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_BOT_USERNAME: 'onpeer_bot',
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
  } as unknown as Env
}

async function buildSignedInitData(
  botToken: string,
  fields: Record<string, string>,
): Promise<string> {
  const enc = new TextEncoder()
  const pairs = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
  const checkString = pairs.join('\n')

  const k1 = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const secretBytes = new Uint8Array(await crypto.subtle.sign('HMAC', k1, enc.encode(botToken)))

  const k2 = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sigBytes = new Uint8Array(await crypto.subtle.sign('HMAC', k2, enc.encode(checkString)))
  const hashHex = Array.from(sigBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const params = new URLSearchParams(fields)
  params.set('hash', hashHex)
  return params.toString()
}

interface StoredAccount {
  wallet: string
  email_enc: string | null
  email_verified_at: string | null
  email_opt_in: boolean
  telegram_chat_id_enc: string | null
  telegram_username_enc: string | null
  telegram_id_hash: string | null
  telegram_linked_at: string | null
  telegram_opt_in: boolean
  deleted_at: string | null
}

class TelegramMemoryDb implements Queryable {
  nowMs = 1_795_500_000_000
  sessions = new Map<string, { wallet: string; expiresAtMs: number; revokedAtMs: number | null }>()
  accounts = new Map<string, StoredAccount>()
  rateLimits = new Map<string, { count: number; resetAtMs: number }>()
  outbox: Array<{
    id: string
    wallet: string
    event: string
    order_id: string | null
    dedupe_key: string | null
    status: string
    attempts: number
    last_error: string | null
  }> = []
  idSeq = 1

  async seedSession(rawToken: string, wallet: string) {
    this.sessions.set(await sha256Hex(rawToken), {
      wallet,
      expiresAtMs: this.nowMs + 3_600_000,
      revokedAtMs: null,
    })
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: R[]; rowCount: number | null }> {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n.startsWith('INSERT INTO public.rate_limits')) {
      const bucket = String(values[0])
      const windowSec = Number(values[1])
      const cur = this.rateLimits.get(bucket)
      const count = cur && cur.resetAtMs > this.nowMs ? cur.count + 1 : 1
      const resetAtMs = cur && cur.resetAtMs > this.nowMs ? cur.resetAtMs : this.nowMs + windowSec * 1000
      this.rateLimits.set(bucket, { count, resetAtMs })
      return { rows: [{ count } as unknown as R], rowCount: 1 }
    }

    if (n.startsWith('SELECT wallet FROM public.sessions')) {
      const row = this.sessions.get(String(values[0]))
      if (!row || row.revokedAtMs !== null || row.expiresAtMs <= this.nowMs) return { rows: [], rowCount: 0 }
      return { rows: [{ wallet: row.wallet } as unknown as R], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.audit_log')) {
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('SELECT telegram_chat_id_enc, telegram_username_enc, telegram_linked_at, telegram_opt_in, deleted_at FROM public.accounts')) {
      const acc = this.accounts.get(String(values[0]))
      return acc ? { rows: [acc as unknown as R], rowCount: 1 } : { rows: [], rowCount: 0 }
    }

    if (n.startsWith('SELECT telegram_chat_id_enc, telegram_opt_in FROM public.accounts')) {
      const acc = this.accounts.get(String(values[0]))
      if (!acc || acc.deleted_at) return { rows: [], rowCount: 0 }
      return {
        rows: [{ telegram_chat_id_enc: acc.telegram_chat_id_enc, telegram_opt_in: acc.telegram_opt_in } as unknown as R],
        rowCount: 1,
      }
    }

    if (n.startsWith('SELECT email_enc, email_verified_at, email_opt_in FROM public.accounts')) {
      const acc = this.accounts.get(String(values[0]))
      if (!acc || acc.deleted_at) return { rows: [], rowCount: 0 }
      return {
        rows: [
          {
            email_enc: acc.email_enc,
            email_verified_at: acc.email_verified_at,
            email_opt_in: acc.email_opt_in,
          } as unknown as R,
        ],
        rowCount: 1,
      }
    }

    if (n.startsWith('UPDATE public.accounts SET telegram_chat_id_enc = NULL') && n.includes('WHERE telegram_id_hash = $1 AND wallet <> $2')) {
      const [idHash, keepWallet] = values as [string, string]
      for (const acc of this.accounts.values()) {
        if (acc.telegram_id_hash === idHash && acc.wallet !== keepWallet) {
          acc.telegram_chat_id_enc = null
          acc.telegram_username_enc = null
          acc.telegram_id_hash = null
          acc.telegram_linked_at = null
          acc.telegram_opt_in = false
        }
      }
      return { rows: [], rowCount: 0 }
    }

    if (n.startsWith('INSERT INTO public.accounts ( wallet, telegram_chat_id_enc')) {
      const [wallet, chatEnc, userEnc, idHash] = values as [string, string, string | null, string]
      const prev = this.accounts.get(wallet)
      const nowIso = new Date(this.nowMs).toISOString()
      this.accounts.set(wallet, {
        wallet,
        email_enc: prev?.email_enc ?? null,
        email_verified_at: prev?.email_verified_at ?? null,
        email_opt_in: prev?.email_opt_in ?? false,
        telegram_chat_id_enc: chatEnc,
        telegram_username_enc: userEnc,
        telegram_id_hash: idHash,
        telegram_linked_at: nowIso,
        telegram_opt_in: true,
        deleted_at: null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('SELECT wallet, telegram_opt_in FROM public.accounts WHERE telegram_id_hash = $1')) {
      const idHash = String(values[0])
      for (const acc of this.accounts.values()) {
        if (acc.telegram_id_hash === idHash && !acc.deleted_at) {
          return { rows: [{ wallet: acc.wallet, telegram_opt_in: acc.telegram_opt_in } as unknown as R], rowCount: 1 }
        }
      }
      return { rows: [], rowCount: 0 }
    }

    if (n.startsWith('UPDATE public.accounts SET telegram_opt_in = false WHERE telegram_id_hash = $1')) {
      const idHash = String(values[0])
      const updated: Array<{ wallet: string }> = []
      for (const acc of this.accounts.values()) {
        if (acc.telegram_id_hash === idHash && !acc.deleted_at) {
          acc.telegram_opt_in = false
          updated.push({ wallet: acc.wallet })
        }
      }
      return { rows: updated as unknown as R[], rowCount: updated.length }
    }

    if (n.startsWith('UPDATE public.accounts SET telegram_opt_in = true WHERE telegram_id_hash = $1')) {
      const idHash = String(values[0])
      const updated: Array<{ wallet: string }> = []
      for (const acc of this.accounts.values()) {
        if (acc.telegram_id_hash === idHash && !acc.deleted_at) {
          acc.telegram_opt_in = true
          updated.push({ wallet: acc.wallet })
        }
      }
      return { rows: updated as unknown as R[], rowCount: updated.length }
    }

    if (n.startsWith('UPDATE public.accounts SET telegram_chat_id_enc = NULL') && n.includes('WHERE telegram_id_hash = $1 RETURNING wallet')) {
      const idHash = String(values[0])
      const updated: Array<{ wallet: string }> = []
      for (const acc of this.accounts.values()) {
        if (acc.telegram_id_hash === idHash) {
          acc.telegram_chat_id_enc = null
          acc.telegram_username_enc = null
          acc.telegram_id_hash = null
          acc.telegram_linked_at = null
          acc.telegram_opt_in = false
          updated.push({ wallet: acc.wallet })
        }
      }
      return { rows: updated as unknown as R[], rowCount: updated.length }
    }

    if (n.startsWith('UPDATE public.accounts SET telegram_opt_in = $1 WHERE wallet = $2')) {
      const [optIn, wallet] = values as [boolean, string]
      const acc = this.accounts.get(wallet)
      if (acc && !acc.deleted_at) acc.telegram_opt_in = optIn
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('UPDATE public.accounts SET telegram_chat_id_enc = NULL') && n.includes('WHERE wallet = $1')) {
      const acc = this.accounts.get(String(values[0]))
      if (acc) {
        acc.telegram_chat_id_enc = null
        acc.telegram_username_enc = null
        acc.telegram_id_hash = null
        acc.telegram_linked_at = null
        acc.telegram_opt_in = false
      }
      return { rows: [], rowCount: 1 }
    }

    // Outbox queries
    if (n.startsWith('INSERT INTO public.notifications_outbox')) {
      const [wallet, event, orderId, dedupeKey] = values as [string, string, string | null, string]
      if (this.outbox.some((o) => o.dedupe_key === dedupeKey)) return { rows: [], rowCount: 0 }
      this.outbox.push({
        id: String(this.idSeq++),
        wallet,
        event,
        order_id: orderId,
        dedupe_key: dedupeKey,
        status: 'pending',
        attempts: 0,
        last_error: null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('UPDATE public.notifications_outbox') && n.includes("SET status = 'processing'")) {
      const eligible = this.outbox.filter((o) => o.status === 'pending')
      for (const o of eligible) {
        o.status = 'processing'
        o.attempts += 1
      }
      return { rows: eligible as unknown as R[], rowCount: eligible.length }
    }

    if (n.startsWith("UPDATE public.notifications_outbox SET status = 'sent'")) {
      const item = this.outbox.find((o) => o.id === String(values[0]))
      if (item) item.status = 'sent'
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('UPDATE public.notifications_outbox SET status = $1')) {
      const item = this.outbox.find((o) => o.id === String(values[2]))
      if (item) {
        item.status = String(values[0])
        item.last_error = String(values[1])
      }
      return { rows: [], rowCount: 1 }
    }

    return { rows: [], rowCount: 0 }
  }
}

describe('Telegram Mini App & Live Order Notification Bot', () => {
  it('verifies valid Telegram WebApp initData and rejects tampered or expired payloads', async () => {
    const nowSec = 1_795_500_000
    const userJson = JSON.stringify({
      id: 77889900,
      username: 'dhaka_trader',
      first_name: 'Rahim',
      allows_write_to_pm: true,
    })
    const valid = await buildSignedInitData(BOT_TOKEN, {
      auth_date: String(nowSec - 30),
      query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
      start_param: 'order_42',
      user: userJson,
    })

    const verified = await verifyTelegramInitData(valid, BOT_TOKEN, nowSec)
    expect(verified).not.toBeNull()
    expect(verified?.id).toBe('77889900')
    expect(verified?.username).toBe('dhaka_trader')
    expect(verified?.startParam).toBe('order_42')

    // Tampered user ID must fail HMAC verification
    const tampered = valid.replace('77889900', '77889901')
    expect(await verifyTelegramInitData(tampered, BOT_TOKEN, nowSec)).toBeNull()

    // Expired (> 24h) auth_date must fail
    expect(await verifyTelegramInitData(valid, BOT_TOKEN, nowSec + 90_000)).toBeNull()
  })

  it('links Mini App in 1-tap, seals chat_id at rest, and delivers outbox order alerts to Telegram', async () => {
    const db = new TelegramMemoryDb()
    await db.seedSession(SESSION_TOKEN, TEST_WALLET)
    const env = makeEnv()
    const nowSec = Math.floor(db.nowMs / 1000)

    const sentTelegramMessages: Array<{ chat_id: string; text: string; reply_markup?: unknown }> = []
    const mockFetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('api.telegram.org')) {
        sentTelegramMessages.push(JSON.parse(String(init?.body ?? '{}')))
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }

    const initData = await buildSignedInitData(BOT_TOKEN, {
      auth_date: String(nowSec - 10),
      user: JSON.stringify({ id: 99112233, username: 'nahian_arc', allows_write_to_pm: true }),
    })

    const linkRes = await handleTelegramRoutes(
      new Request('https://app.onpeer.xyz/api/telegram/link-miniapp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${SESSION_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ initData }),
      }),
      env,
      db,
      '/telegram/link-miniapp',
      { fetchImpl: mockFetch, nowMs: db.nowMs },
    )
    expect(linkRes?.status).toBe(200)
    expect(sentTelegramMessages).toHaveLength(1)
    expect(sentTelegramMessages[0]!.chat_id).toBe('99112233')

    // Stored chat ID must be AES-256-GCM encrypted, never plaintext '99112233'
    const stored = db.accounts.get(TEST_WALLET)!
    expect(stored.telegram_chat_id_enc).toBeTruthy()
    expect(stored.telegram_chat_id_enc).not.toContain('99112233')
    expect(stored.telegram_id_hash).toHaveLength(64)

    // Enqueue a live `order_paid` event (wallet has NO email, only Telegram!) and process outbox
    await queueNotification(db, TEST_WALLET, 'order_paid', 108n)
    const origFetch = globalThis.fetch
    globalThis.fetch = mockFetch
    try {
      await processNotificationsOutbox(env, db)
    } finally {
      globalThis.fetch = origFetch
    }

    expect(db.outbox[0]!.status).toBe('sent')
    expect(sentTelegramMessages).toHaveLength(2)
    expect(sentTelegramMessages[1]!.text).toContain('Order #108 Marked as Paid')
    expect(JSON.stringify(sentTelegramMessages[1]!.reply_markup)).toContain(
      'https://app.onpeer.xyz/p2p?order=108',
    )
  })

  it('links via browser deep-link token + Bot /start webhook, enforces webhook secret, and supports /mute & /unlink', async () => {
    const db = new TelegramMemoryDb()
    await db.seedSession(SESSION_TOKEN, TEST_WALLET)
    const env = makeEnv()

    const sentBotMsgs: Array<{ chat_id: string; text: string }> = []
    const mockFetch: typeof globalThis.fetch = async (_input, init) => {
      sentBotMsgs.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    // 1. Reject webhook without valid X-Telegram-Bot-Api-Secret-Token
    const unauthWh = await handleTelegramRoutes(
      new Request('https://app.onpeer.xyz/api/telegram/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'wrong_secret', 'content-type': 'application/json' },
        body: JSON.stringify({ message: { text: '/start', chat: { id: 554433, type: 'private' } } }),
      }),
      env,
      db,
      '/telegram/webhook',
      { fetchImpl: mockFetch, nowMs: db.nowMs },
    )
    expect(unauthWh?.status).toBe(401)

    // 2. Mint browser deep-link token
    const tokenRes = await handleTelegramRoutes(
      new Request('https://app.onpeer.xyz/api/telegram/link-token', {
        method: 'POST',
        headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      }),
      env,
      db,
      '/telegram/link-token',
      { fetchImpl: mockFetch, nowMs: db.nowMs },
    )
    expect(tokenRes?.status).toBe(200)
    const { deepLink } = (await tokenRes!.json()) as { deepLink: string }
    const startArg = new URL(deepLink).searchParams.get('start')!
    expect(startArg.startsWith('link_')).toBe(true)

    // 3. Simulate user clicking Start in Telegram -> webhook receives `/start link_<token>`
    const startWh = await handleTelegramRoutes(
      new Request('https://app.onpeer.xyz/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            text: `/start ${startArg}`,
            chat: { id: 55443322, type: 'private' },
            from: { id: 55443322, username: 'karim_p2p' },
          },
        }),
      }),
      env,
      db,
      '/telegram/webhook',
      { fetchImpl: mockFetch, nowMs: db.nowMs },
    )
    expect(startWh?.status).toBe(200)
    expect(db.accounts.get(TEST_WALLET)?.telegram_opt_in).toBe(true)
    expect(sentBotMsgs[sentBotMsgs.length - 1]?.text).toContain('Connected to OnPeer')

    // 4. Test /mute command
    await handleTelegramRoutes(
      new Request('https://app.onpeer.xyz/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: { text: '/mute', chat: { id: 55443322, type: 'private' } },
        }),
      }),
      env,
      db,
      '/telegram/webhook',
      { fetchImpl: mockFetch, nowMs: db.nowMs },
    )
    expect(db.accounts.get(TEST_WALLET)?.telegram_opt_in).toBe(false)

    // 5. Test /unlink command
    await handleTelegramRoutes(
      new Request('https://app.onpeer.xyz/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: { text: '/unlink', chat: { id: 55443322, type: 'private' } },
        }),
      }),
      env,
      db,
      '/telegram/webhook',
      { fetchImpl: mockFetch, nowMs: db.nowMs },
    )
    expect(db.accounts.get(TEST_WALLET)?.telegram_chat_id_enc).toBeNull()
    expect(db.accounts.get(TEST_WALLET)?.telegram_id_hash).toBeNull()
  })
})
