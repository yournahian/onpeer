import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import { sealText } from '../crypto'
import type { Queryable } from '../db'
import type { Env, HyperdriveBinding } from '../env'
import { processNotificationsOutbox, queueNotification } from '../notify'

const SESSION_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const VAULT_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const ESCROW_ADDR = '0xf719ebbc5080aee09e38909764b897e0bf01a9b0'
const WALLET = '0x1111111111111111111111111111111111111111' as `0x${string}`

function makeEnv(hasResend = true): Env {
  return {
    SESSION_SECRET,
    VAULT_MASTER_KEY,
    HYPERDRIVE: { connectionString: 'postgres://localhost/test' } as HyperdriveBinding,
    VITE_P2P_ESCROW_ADDRESS: ESCROW_ADDR,
    RESEND_API_KEY: hasResend ? 're_test_key' : '',
    EMAIL_FROM: 'OnPeer <noreply@onpeer.xyz>',
    PUBLIC_APP_URL: 'https://app.onpeer.xyz',
  } as unknown as Env
}

interface OutboxRow {
  id: string
  wallet: string
  event: string
  order_id: string | null
  dedupe_key: string | null
  status: string
  attempts: number
  last_error: string | null
  send_after: string
}

class NotifyMemoryDb implements Queryable {
  outbox: OutboxRow[] = []
  accounts: Array<{ wallet: string; email_enc: string | null; email_verified_at: string | null; email_opt_in: boolean }> = []
  sentEmails: Array<{ to: string; subject: string; body: string }> = []
  idCounter = 1
  resendOk = true // controls whether the mock fetch succeeds

  async seedAccount(env: Env, wallet: `0x${string}`, email: string, verified: boolean, optIn: boolean) {
    const emailEnc = await sealText(env, email, `account:email:${wallet}`)
    this.accounts.push({
      wallet,
      email_enc: emailEnc,
      email_verified_at: verified ? new Date().toISOString() : null,
      email_opt_in: optIn,
    })
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: R[]; rowCount: number | null }> {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n === 'BEGIN' || n === 'COMMIT' || n === 'ROLLBACK') return { rows: [], rowCount: 0 }

    // Queue notification INSERT
    if (n.startsWith('INSERT INTO public.notifications_outbox') && n.includes('ON CONFLICT (dedupe_key) DO NOTHING')) {
      const wallet = String(values[0])
      const event = String(values[1])
      const orderId = values[2] ? String(values[2]) : null
      const dedupeKey = values[3] ? String(values[3]) : null
      // Check dedupe
      if (dedupeKey && this.outbox.some((r) => r.dedupe_key === dedupeKey)) {
        return { rows: [], rowCount: 0 }
      }
      const id = String(this.idCounter++)
      this.outbox.push({ id, wallet, event, order_id: orderId, dedupe_key: dedupeKey, status: 'pending', attempts: 0, last_error: null, send_after: new Date().toISOString() })
      return { rows: [], rowCount: 1 }
    }

    // Outbox UPDATE claim (processing batch)
    if (n.startsWith('UPDATE public.notifications_outbox') && n.includes("status = 'processing'") && n.includes('RETURNING')) {
      const maxAttempts = Number(values[0])
      const limit = Number(values[1])
      const eligible = this.outbox
        .filter((r) => (r.status === 'pending' || r.status === 'processing') && r.attempts < maxAttempts)
        .slice(0, limit)
      for (const r of eligible) {
        r.attempts += 1
        r.status = 'processing'
      }
      return { rows: eligible as unknown as R[], rowCount: eligible.length }
    }

    // Outbox UPDATE: multi-param (status + last_error + id + backoffSec)
    if (n.startsWith('UPDATE public.notifications_outbox') && n.includes('SET status =') && n.includes('last_error') && values.length >= 3) {
      const row = this.outbox.find((r) => r.id === String(values[2]))
      if (row) { row.status = String(values[0]); row.last_error = String(values[1]) }
      return { rows: [], rowCount: 1 }
    }

    // Outbox UPDATE: single-param SET status = 'sent' WHERE id = $1
    if (n.startsWith('UPDATE public.notifications_outbox') && n.includes("SET status = 'sent'") && values.length === 1) {
      const row = this.outbox.find((r) => r.id === String(values[0]))
      if (row) row.status = 'sent'
      return { rows: [], rowCount: 1 }
    }

    // Account email query
    if (n.startsWith('SELECT email_enc, email_verified_at, email_opt_in FROM public.accounts')) {
      const wallet = String(values[0])
      const acc = this.accounts.find((a) => a.wallet === wallet)
      if (!acc) return { rows: [], rowCount: 0 }
      return { rows: [acc as unknown as R], rowCount: 1 }
    }

    return { rows: [], rowCount: 0 }
  }
}

// Patch global fetch for email sending tests
function patchFetch(db: NotifyMemoryDb) {
  const original = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url === 'https://api.resend.com/emails') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { to: string[]; subject: string; text: string }
      db.sentEmails.push({ to: body.to[0] ?? '', subject: body.subject, body: body.text })
      return new Response(JSON.stringify({ id: 'test-id' }), { status: db.resendOk ? 200 : 500 })
    }
    return original(input, init)
  }
  return () => { globalThis.fetch = original }
}

// =========================================================================
describe('notify — queueNotification', () => {
  it('inserts a pending row into the outbox', async () => {
    const db = new NotifyMemoryDb()
    await queueNotification(db, WALLET, 'order_opened', 42n)
    expect(db.outbox).toHaveLength(1)
    expect(db.outbox[0]!.event).toBe('order_opened')
    expect(db.outbox[0]!.order_id).toBe('42')
    expect(db.outbox[0]!.status).toBe('pending')
  })

  it('deduplicates the same event+wallet+orderId', async () => {
    const db = new NotifyMemoryDb()
    await queueNotification(db, WALLET, 'order_paid', 1n)
    await queueNotification(db, WALLET, 'order_paid', 1n)
    expect(db.outbox).toHaveLength(1)
  })
})

// =========================================================================
describe('notify — processNotificationsOutbox', () => {
  it('sends email and marks row sent', async () => {
    const db = new NotifyMemoryDb()
    const env = makeEnv()
    await db.seedAccount(env, WALLET, 'alice@example.com', true, true)
    await queueNotification(db, WALLET, 'order_paid', 5n)

    const restore = patchFetch(db)
    try {
      await processNotificationsOutbox(env, db)
    } finally {
      restore()
    }

    expect(db.sentEmails).toHaveLength(1)
    expect(db.sentEmails[0]!.subject).toContain('paid')
    expect(db.outbox[0]!.status).toBe('sent')
    // Email body must contain order link but NOT the email address itself (privacy)
    expect(db.sentEmails[0]!.body).toContain('order=5')
    expect(db.sentEmails[0]!.body).not.toContain('alice@example.com')
  })

  it('skips wallet with no verified email', async () => {
    const db = new NotifyMemoryDb()
    const env = makeEnv()
    // No account seeded → missing
    await queueNotification(db, WALLET, 'kyc_approved', null)

    const restore = patchFetch(db)
    try {
      await processNotificationsOutbox(env, db)
    } finally {
      restore()
    }

    expect(db.sentEmails).toHaveLength(0)
    expect(db.outbox[0]!.status).toBe('skipped')
  })

  it('skips wallet with email_opt_in=false', async () => {
    const db = new NotifyMemoryDb()
    const env = makeEnv()
    await db.seedAccount(env, WALLET, 'bob@example.com', true, false)
    await queueNotification(db, WALLET, 'order_disputed', 7n)

    const restore = patchFetch(db)
    try {
      await processNotificationsOutbox(env, db)
    } finally {
      restore()
    }

    expect(db.sentEmails).toHaveLength(0)
    expect(db.outbox[0]!.status).toBe('skipped')
  })

  it('retries on send failure (marks pending, increments attempts)', async () => {
    const db = new NotifyMemoryDb()
    db.resendOk = false
    const env = makeEnv()
    await db.seedAccount(env, WALLET, 'charlie@example.com', true, true)
    await queueNotification(db, WALLET, 'kyc_approved', null)

    const restore = patchFetch(db)
    try {
      await processNotificationsOutbox(env, db)
    } finally {
      restore()
    }

    expect(db.sentEmails).toHaveLength(1) // attempted
    expect(db.outbox[0]!.status).toBe('pending') // back to pending for retry
    expect(db.outbox[0]!.attempts).toBe(1)
  })

  it('no-ops when RESEND_API_KEY is missing', async () => {
    const db = new NotifyMemoryDb()
    const env = makeEnv(false) // no Resend key
    await db.seedAccount(env, WALLET, 'dave@example.com', true, true)
    await queueNotification(db, WALLET, 'order_completed', 9n)

    const restore = patchFetch(db)
    try {
      await processNotificationsOutbox(env, db)
    } finally {
      restore()
    }

    expect(db.sentEmails).toHaveLength(0)
    // Skipped because sendEmail returns false when no key
    expect(db.outbox[0]!.status).toBe('pending')
  })
})
