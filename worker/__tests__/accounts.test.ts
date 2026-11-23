import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import { handleAccountRoutes, type AccountRow } from '../accounts'
import { sha256Hex } from '../auth'
import type { Queryable } from '../db'
import type { Env } from '../env'

const TEST_WALLET = '0x1111111111111111111111111111111111111111' as const
const TEST_TOKEN = 'a'.repeat(64)
const SESSION_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const VAULT_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

class AccountMemoryDb implements Queryable {
  nowMs = 1_795_000_000_000
  sessions = new Map<string, { wallet: string; expiresAtMs: number; revokedAtMs: number | null }>()
  accounts = new Map<string, AccountRow & { kyc_name_enc: string | null; payment_methods_enc?: string | null }>()
  outbox: Array<{ wallet: string; status: string }> = []
  jobs: Array<{ kind: string; payload: unknown }> = []
  rateLimits = new Map<string, { count: number; resetAtMs: number }>()

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

    if (n === 'BEGIN' || n === 'COMMIT' || n === 'ROLLBACK') {
      return { rows: [], rowCount: 0 }
    }

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

    if (n.startsWith('SELECT wallet, display_name')) {
      const acc = this.accounts.get(String(values[0]))
      return acc ? { rows: [acc as unknown as R], rowCount: 1 } : { rows: [], rowCount: 0 }
    }

    if (n.startsWith('SELECT payment_methods_enc, deleted_at FROM public.accounts')) {
      const acc = this.accounts.get(String(values[0]))
      return acc
        ? { rows: [{ payment_methods_enc: acc.payment_methods_enc ?? null, deleted_at: acc.deleted_at } as unknown as R], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }

    if (n.startsWith('INSERT INTO public.accounts (wallet, payment_methods_enc')) {
      const [wallet, pmEnc] = values as [string, string | null]
      const prev = this.accounts.get(wallet)
      const nowIso = new Date(this.nowMs).toISOString()
      const row = {
        wallet,
        display_name: prev && !prev.deleted_at ? prev.display_name : null,
        country: prev && !prev.deleted_at ? prev.country : null,
        email_enc: prev && !prev.deleted_at ? prev.email_enc : null,
        email_verified_at: prev && !prev.deleted_at ? prev.email_verified_at : null,
        email_opt_in: prev && !prev.deleted_at ? prev.email_opt_in : false,
        kyc_status: prev && !prev.deleted_at ? prev.kyc_status : 'none',
        kyc_level: prev && !prev.deleted_at ? prev.kyc_level : 0,
        kyc_expires_at: prev && !prev.deleted_at ? prev.kyc_expires_at : null,
        kyc_name_enc: prev && !prev.deleted_at ? prev.kyc_name_enc : null,
        payment_methods_enc: pmEnc,
        consent_at: prev?.consent_at ?? nowIso,
        created_at: prev?.created_at ?? nowIso,
        deleted_at: null,
      }
      this.accounts.set(wallet, row)
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.accounts')) {
      const [wallet, displayName, country, emailEnc, keepVerified, emailOptIn] = values as [
        string,
        string | null,
        string | null,
        string | null,
        boolean,
        boolean,
      ]
      const prev = this.accounts.get(wallet)
      const nowIso = new Date(this.nowMs).toISOString()
      const row: AccountRow & { kyc_name_enc: string | null } = {
        wallet,
        display_name: displayName,
        country,
        email_enc: emailEnc,
        email_verified_at: keepVerified ? (prev?.email_verified_at ?? nowIso) : null,
        email_opt_in: emailOptIn,
        kyc_status: prev && !prev.deleted_at ? prev.kyc_status : 'none',
        kyc_level: prev && !prev.deleted_at ? prev.kyc_level : 0,
        kyc_expires_at: prev && !prev.deleted_at ? prev.kyc_expires_at : null,
        kyc_name_enc: prev && !prev.deleted_at ? prev.kyc_name_enc : null,
        consent_at: prev?.consent_at ?? nowIso,
        created_at: prev?.created_at ?? nowIso,
        deleted_at: null,
      }
      this.accounts.set(wallet, row)
      return { rows: [row as unknown as R], rowCount: 1 }
    }

    if (n.startsWith('UPDATE public.accounts SET email_verified_at')) {
      const acc = this.accounts.get(String(values[0]))
      if (acc && !acc.deleted_at) {
        acc.email_verified_at = acc.email_verified_at ?? new Date(this.nowMs).toISOString()
        acc.email_opt_in = true
      }
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('UPDATE public.accounts SET email_opt_in = false')) {
      const acc = this.accounts.get(String(values[0]))
      if (acc) acc.email_opt_in = false
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('UPDATE public.notifications_outbox')) {
      const wallet = String(values[0])
      for (const item of this.outbox) {
        if (item.wallet === wallet && item.status === 'pending') item.status = 'skipped'
      }
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('UPDATE public.accounts SET display_name = NULL')) {
      const acc = this.accounts.get(String(values[0]))
      if (acc) {
        acc.display_name = null
        acc.country = null
        acc.email_enc = null
        acc.email_verified_at = null
        acc.email_opt_in = false
        acc.payment_methods_enc = null
        acc.kyc_status = acc.kyc_status === 'approved' ? 'revoked' : 'none'
        acc.kyc_level = 0
        acc.kyc_expires_at = null
        acc.kyc_name_enc = null
        acc.consent_at = null
        acc.deleted_at = new Date(this.nowMs).toISOString()
      }
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('UPDATE public.sessions SET revoked_at')) {
      const wallet = String(values[0])
      for (const s of this.sessions.values()) {
        if (s.wallet === wallet) s.revokedAtMs = this.nowMs
      }
      return { rows: [], rowCount: 1 }
    }

    if (
      n.startsWith('DELETE FROM public.p2p_relations') ||
      n.startsWith('UPDATE public.p2p_feedback') ||
      n.startsWith('DELETE FROM public.vault_blobs') ||
      n.startsWith('UPDATE public.vault_blobs') ||
      n.startsWith('UPDATE public.chat_messages') ||
      n.startsWith('UPDATE public.dispute_filings')
    ) {
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.onchain_jobs')) {
      this.jobs.push({ kind: 'revoke_verification', payload: JSON.parse(String(values[0])) })
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.audit_log')) {
      return { rows: [], rowCount: 1 }
    }

    throw new Error(`Unhandled SQL in AccountMemoryDb: ${n}`)
  }
}

function makeEnv(mode: 'sandbox' | 'live' = 'sandbox'): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') },
    SESSION_SECRET,
    VAULT_MASTER_KEY,
    DIDIT_MODE: mode,
    PUBLIC_APP_URL: 'https://app.onpeer.xyz',
  }
}

describe('Step 5: P2P Accounts, Consent Gate, Email Double Opt-In & PII Deletion', () => {
  it('enforces consent, encrypts email at rest, completes double opt-in via #fragment token, and supports one-click unsubscribe', async () => {
    const db = new AccountMemoryDb()
    await db.seedSession(TEST_TOKEN, TEST_WALLET)
    const env = makeEnv('sandbox')

    // 1. Rejects first save without consent
    const noConsentRes = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/account', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({ displayName: 'DhakaDesk', country: 'BD' }),
      }),
      env,
      db,
      '/account',
      { nowMs: db.nowMs },
    )
    expect(noConsentRes?.status).toBe(400)
    expect(await noConsentRes!.json()).toEqual({ error: 'consent_required' })

    // 2. Saves encrypted email and captures verification + unsubscribe links (both using #fragment, zero email in URL)
    let capturedVerifyUrl = ''
    let capturedUnsubUrl = ''
    const saveRes = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/account', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({
          displayName: 'DhakaDesk',
          country: 'bd',
          email: 'Trader@Example.com',
          emailOptIn: true,
          consent: true,
        }),
      }),
      env,
      db,
      '/account',
      {
        nowMs: db.nowMs,
        sendVerifyEmail: async ({ toEmail, verifyUrl, unsubscribeUrl }) => {
          expect(toEmail).toBe('trader@example.com')
          capturedVerifyUrl = verifyUrl
          capturedUnsubUrl = unsubscribeUrl
          return { queued: true }
        },
      },
    )
    expect(saveRes?.status).toBe(200)
    const saved = (await saveRes!.json()) as {
      exists: boolean
      displayName: string
      country: string
      emailMasked: string
      emailVerified: boolean
      diditMode: string
    }
    expect(saved.exists).toBe(true)
    expect(saved.displayName).toBe('DhakaDesk')
    expect(saved.country).toBe('BD')
    expect(saved.emailMasked).toBe('t***r@example.com')
    expect(saved.emailVerified).toBe(false)
    expect(saved.diditMode).toBe('sandbox')

    // Raw email never appears in SQL row or verification URL
    const rawRow = db.accounts.get(TEST_WALLET)!
    expect(rawRow.email_enc).not.toContain('trader@example.com')
    expect(capturedVerifyUrl).toContain('https://app.onpeer.xyz/p2p#verify_email=')
    expect(capturedVerifyUrl).not.toContain('trader')

    // 3. Extract #verify_email token and complete double opt-in
    const verifyTok = decodeURIComponent(capturedVerifyUrl.split('#verify_email=')[1])
    const verifyRes = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/email/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: verifyTok }),
      }),
      env,
      db,
      '/email/verify',
      { nowMs: db.nowMs + 10_000 },
    )
    expect(verifyRes?.status).toBe(200)

    const getRes = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/account', {
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      }),
      env,
      db,
      '/account',
      { nowMs: db.nowMs + 10_000 },
    )
    const afterVerify = (await getRes!.json()) as { emailVerified: boolean; emailOptIn: boolean }
    expect(afterVerify).toEqual(expect.objectContaining({ emailVerified: true, emailOptIn: true }))

    // 3b. Once verified, changing or removing email is blocked with 403 email_locked
    const changeVerifiedRes = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/account', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({ email: 'other@example.com', consent: true }),
      }),
      env,
      db,
      '/account',
      { nowMs: db.nowMs + 12_000 },
    )
    expect(changeVerifiedRes?.status).toBe(403)
    expect(await changeVerifiedRes!.json()).toEqual({ error: 'email_locked' })

    const clearVerifiedRes = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/account', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({ email: '', consent: true }),
      }),
      env,
      db,
      '/account',
      { nowMs: db.nowMs + 13_000 },
    )
    expect(clearVerifiedRes?.status).toBe(403)
    expect(await clearVerifiedRes!.json()).toEqual({ error: 'email_locked' })

    // 4. One-click unsubscribe disables opt-in and skips pending outbox rows
    db.outbox.push({ wallet: TEST_WALLET, status: 'pending' })
    const unsubTok = decodeURIComponent(capturedUnsubUrl.split('#unsubscribe=')[1])
    const unsubRes = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/email/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: unsubTok }),
      }),
      env,
      db,
      '/email/unsubscribe',
      { nowMs: db.nowMs + 20_000 },
    )
    expect(unsubRes?.status).toBe(200)
    expect(db.accounts.get(TEST_WALLET)!.email_opt_in).toBe(false)
    expect(db.outbox[0].status).toBe('skipped')
  })

  it('scrubs PII, revokes active sessions, and queues revoke_verification when deleting a verified account', async () => {
    const db = new AccountMemoryDb()
    await db.seedSession(TEST_TOKEN, TEST_WALLET)
    const env = makeEnv('sandbox')

    await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/account', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({ displayName: 'Ayesha', country: 'PK', email: 'ayesha@test.io', consent: true }),
      }),
      env,
      db,
      '/account',
      { nowMs: db.nowMs },
    )

    // Simulate an approved KYC state on the account
    const row = db.accounts.get(TEST_WALLET)!
    row.kyc_status = 'approved'
    row.kyc_level = 1
    row.kyc_name_enc = 'encrypted_name_blob'

    const delRes = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/account', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      }),
      env,
      db,
      '/account',
      { nowMs: db.nowMs + 5_000 },
    )
    expect(delRes?.status).toBe(200)

    const scrubbed = db.accounts.get(TEST_WALLET)!
    expect(scrubbed.display_name).toBeNull()
    expect(scrubbed.country).toBeNull()
    expect(scrubbed.email_enc).toBeNull()
    expect(scrubbed.kyc_name_enc).toBeNull()
    expect(scrubbed.kyc_status).toBe('revoked')
    expect(scrubbed.deleted_at).not.toBeNull()
    expect(db.jobs).toEqual([
      { kind: 'revoke_verification', payload: { wallet: TEST_WALLET, reason: 'account_deleted' } },
    ])

    // Session was revoked by account deletion
    const afterDelGet = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/account', {
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      }),
      env,
      db,
      '/account',
      { nowMs: db.nowMs + 6_000 },
    )
    expect(afterDelGet?.status).toBe(401)
  })

  it('blocks account deletion with 409 active_ads_remain via chain.getUserAdIds + getAd (even without vault blobs)', async () => {
    const db = new AccountMemoryDb()
    await db.seedSession(TEST_TOKEN, TEST_WALLET)
    const env = makeEnv('sandbox')

    const chain = {
      getRoles: async () => ({
        owner: TEST_WALLET,
        arbiter: TEST_WALLET,
        backupArbiter: TEST_WALLET,
        verifier: TEST_WALLET,
        kycRequired: false,
        sealedEnabled: false,
        payerProofRequired: false,
      }),
      getOrder: async () => null,
      isVerified: async () => false,
      getOpenOrderCount: async () => 0n,
      getUserAdIds: async () => [5n],
      getAd: async (id: bigint) => ({
        id,
        maker: TEST_WALLET,
        side: 0,
        paused: false,
        closed: false,
        expiresAt: BigInt(Math.floor(db.nowMs / 1000) + 3600),
        detailsMode: 0,
        detailsHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
      }),
    }

    const delRes = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/account', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      }),
      env,
      db,
      '/account',
      { nowMs: db.nowMs, chain },
    )
    expect(delRes?.status).toBe(409)
    expect(await delRes!.json()).toEqual({ error: 'active_ads_remain' })
  })

  it('saves, encrypts at rest, retrieves, and scrubs saved P2P payment methods', async () => {
    const db = new AccountMemoryDb()
    await db.seedSession(TEST_TOKEN, TEST_WALLET)
    const env = makeEnv('sandbox')

    const putRes = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/account/payment-methods', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({
          paymentMethods: [
            {
              id: 'pm_bkash_1',
              methodBit: 7,
              methodName: 'bKash',
              holderName: 'Rahim Uddin',
              accountNumber: '01711223344',
              bankOrBranch: 'Personal',
              notes: 'Send money only',
            },
          ],
        }),
      }),
      env,
      db,
      '/account/payment-methods',
      { nowMs: db.nowMs },
    )
    expect(putRes?.status).toBe(200)
    const rawEnc = db.accounts.get(TEST_WALLET)?.payment_methods_enc ?? ''
    expect(rawEnc).toBeTruthy()
    expect(rawEnc).not.toContain('01711223344')
    expect(rawEnc).not.toContain('Rahim Uddin')

    const getRes = await handleAccountRoutes(
      new Request('https://app.onpeer.xyz/api/account/payment-methods', {
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      }),
      env,
      db,
      '/account/payment-methods',
      { nowMs: db.nowMs + 1_000 },
    )
    expect(getRes?.status).toBe(200)
    const loaded = (await getRes!.json()) as { paymentMethods: Array<{ methodName: string; accountNumber: string }> }
    expect(loaded.paymentMethods).toHaveLength(1)
    expect(loaded.paymentMethods[0]?.methodName).toBe('bKash')
    expect(loaded.paymentMethods[0]?.accountNumber).toBe('01711223344')
  })
})
