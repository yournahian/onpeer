import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import { sha256Hex } from '../auth'
import type { ChainReader } from '../chain'
import { canonicalizeDiditJson, computeHmacSha256Hex } from '../crypto'
import type { Queryable } from '../db'
import type { Env } from '../env'
import { handleKycRoutes, processOnchainJobsBatch, verifyCounterpartyName, type VerifierTxExecutor } from '../kyc'

const TEST_WALLET = '0x1111111111111111111111111111111111111111' as const
const TEST_TOKEN = 'b'.repeat(64)
const SESSION_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const VAULT_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const WEBHOOK_SECRET = 'whsec_didit_sandbox_unit_test_secret_key_999'

class KycMemoryDb implements Queryable {
  nowSec = 1_795_000_000
  sessions = new Map<string, { wallet: string; expiresAtSec: number }>()
  accounts = new Map<
    string,
    {
      wallet: string
      kyc_status: string
      kyc_level: number
      kyc_expires_at: string | null
      kyc_name_enc: string | null
      approved_session_id: string | null
      consent_at: string | null
      deleted_at: string | null
    }
  >()
  kycSessions = new Map<
    string,
    { wallet: string; didit_session_id: string; status: string; sandbox_scenario: string | null; created_at: string; decided_at: string | null }
  >()
  webhookEvents = new Set<string>()
  jobs: Array<{
    id: number
    kind: 'set_verification' | 'revoke_verification'
    payload: Record<string, unknown>
    status: string
    attempts: number
    tx_hash: string | null
    last_error: string | null
  }> = []
  outbox: Array<{ dedupe_key: string; wallet: string; event: string }> = []
  rateLimits = new Map<string, { count: number; resetAtSec: number }>()

  async seedSession(rawToken: string, wallet: string) {
    this.sessions.set(await sha256Hex(rawToken), { wallet, expiresAtSec: this.nowSec + 3600 })
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: R[]; rowCount: number | null }> {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n === 'BEGIN' || n === 'COMMIT' || n === 'ROLLBACK') return { rows: [], rowCount: 0 }

    if (n.startsWith('INSERT INTO public.rate_limits')) {
      const bucket = String(values[0])
      const win = Number(values[1])
      const cur = this.rateLimits.get(bucket)
      const count = cur && cur.resetAtSec > this.nowSec ? cur.count + 1 : 1
      const resetAtSec = cur && cur.resetAtSec > this.nowSec ? cur.resetAtSec : this.nowSec + win
      this.rateLimits.set(bucket, { count, resetAtSec })
      return { rows: [{ count } as unknown as R], rowCount: 1 }
    }

    if (n.startsWith('SELECT wallet FROM public.sessions')) {
      const s = this.sessions.get(String(values[0]))
      if (!s || s.expiresAtSec <= this.nowSec) return { rows: [], rowCount: 0 }
      return { rows: [{ wallet: s.wallet } as unknown as R], rowCount: 1 }
    }

    if (n.startsWith('SELECT consent_at, kyc_status FROM public.accounts')) {
      const a = this.accounts.get(String(values[0]))
      return a && !a.deleted_at ? { rows: [a as unknown as R], rowCount: 1 } : { rows: [], rowCount: 0 }
    }

    if (n.startsWith('SELECT kyc_status, kyc_level, kyc_expires_at, consent_at FROM public.accounts')) {
      const a = this.accounts.get(String(values[0]))
      return a && !a.deleted_at ? { rows: [a as unknown as R], rowCount: 1 } : { rows: [], rowCount: 0 }
    }

    if (n.startsWith('SELECT kyc_status, kyc_expires_at, kyc_name_enc FROM public.accounts')) {
      const a = this.accounts.get(String(values[0]))
      return a && !a.deleted_at ? { rows: [a as unknown as R], rowCount: 1 } : { rows: [], rowCount: 0 }
    }

    if (n.startsWith('SELECT kyc_status, kyc_level, approved_session_id FROM public.accounts')) {
      const a = this.accounts.get(String(values[0]))
      return a ? { rows: [a as unknown as R], rowCount: 1 } : { rows: [], rowCount: 0 }
    }

    if (n.startsWith('SELECT kyc_status, kyc_level FROM public.accounts')) {
      const a = this.accounts.get(String(values[0]))
      return a ? { rows: [a as unknown as R], rowCount: 1 } : { rows: [], rowCount: 0 }
    }

    if (n.startsWith('SELECT didit_session_id, status')) {
      const list = [...this.kycSessions.values()].filter((x) => x.wallet === String(values[0]))
      const latest = list[list.length - 1]
      return latest ? { rows: [latest as unknown as R], rowCount: 1 } : { rows: [], rowCount: 0 }
    }

    if (n.startsWith('SELECT kind, status, attempts')) {
      const wallet = String(values[0])
      const list = this.jobs.filter((j) => j.payload.wallet === wallet)
      const latest = list[list.length - 1]
      return latest ? { rows: [latest as unknown as R], rowCount: 1 } : { rows: [], rowCount: 0 }
    }

    if (n.startsWith("INSERT INTO public.accounts (wallet, kyc_status, consent_at)")) {
      const wallet = String(values[0])
      const prev = this.accounts.get(wallet)
      const nowIso = new Date(this.nowSec * 1000).toISOString()
      this.accounts.set(wallet, {
        wallet,
        kyc_status: prev?.kyc_status === 'approved' ? 'approved' : 'pending',
        kyc_level: prev?.kyc_level ?? 0,
        kyc_expires_at: prev?.kyc_expires_at ?? null,
        kyc_name_enc: prev?.kyc_name_enc ?? null,
        approved_session_id: prev?.approved_session_id ?? null,
        consent_at: prev?.consent_at ?? nowIso,
        deleted_at: null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.kyc_sessions')) {
      const [wallet, sid, status, scenario] = values as [string, string, string, string | null]
      const nowIso = new Date(this.nowSec * 1000).toISOString()
      this.kycSessions.set(sid, {
        wallet,
        didit_session_id: sid,
        status,
        sandbox_scenario: scenario,
        created_at: nowIso,
        decided_at: null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.webhook_events')) {
      const eventId = String(values[0])
      if (this.webhookEvents.has(eventId)) return { rows: [], rowCount: 0 }
      this.webhookEvents.add(eventId)
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('SELECT wallet, sandbox_scenario FROM public.kyc_sessions')) {
      const s = this.kycSessions.get(String(values[0]))
      return s ? { rows: [s as unknown as R], rowCount: 1 } : { rows: [], rowCount: 0 }
    }

    if (n.startsWith("INSERT INTO public.accounts (wallet, kyc_status, kyc_level, kyc_expires_at, kyc_name_enc")) {
      const [wallet, expiryIso, nameEnc, approvedSessionId] = values as [string, string, string | null, string]
      const prev = this.accounts.get(wallet)
      this.accounts.set(wallet, {
        wallet,
        kyc_status: 'approved',
        kyc_level: 1,
        kyc_expires_at: expiryIso,
        kyc_name_enc: nameEnc ?? prev?.kyc_name_enc ?? null,
        approved_session_id: approvedSessionId ?? null,
        consent_at: prev?.consent_at ?? new Date(this.nowSec * 1000).toISOString(),
        deleted_at: null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.accounts (wallet, kyc_status, kyc_level, kyc_expires_at, approved_session_id)')) {
      const [wallet, nextStatus] = values as [string, string]
      const prev = this.accounts.get(wallet)
      this.accounts.set(wallet, {
        wallet,
        kyc_status: nextStatus,
        kyc_level: 0,
        kyc_expires_at: null,
        kyc_name_enc: prev?.kyc_name_enc ?? null,
        approved_session_id: null,
        consent_at: prev?.consent_at ?? null,
        deleted_at: null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('UPDATE public.kyc_sessions')) {
      const [sid, status] = values as [string, string]
      const row = this.kycSessions.get(sid)
      if (row) {
        row.status = status
        if (n.includes('decided_at')) row.decided_at = new Date(this.nowSec * 1000).toISOString()
      }
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.onchain_jobs')) {
      const kind = n.includes("'set_verification'") ? 'set_verification' : 'revoke_verification'
      this.jobs.push({
        id: this.jobs.length + 1,
        kind,
        payload: JSON.parse(String(values[0])) as Record<string, unknown>,
        status: 'pending',
        attempts: 0,
        tx_hash: null,
        last_error: null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.notifications_outbox')) {
      const [dedupe_key, wallet] = values as [string, string]
      const event = n.includes("'kyc_approved'") ? 'kyc_approved' : 'kyc_declined'
      if (!this.outbox.some((o) => o.dedupe_key === dedupe_key)) {
        this.outbox.push({ dedupe_key, wallet, event })
      }
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith("UPDATE public.onchain_jobs SET status = 'pending'") && n.includes('interval')) {
      return { rows: [], rowCount: 0 }
    }

    if (n.startsWith("UPDATE public.onchain_jobs SET status = 'processing'")) {
      const due = this.jobs.filter((j) => j.status === 'pending' && j.attempts < 10).slice(0, 5)
      for (const j of due) j.status = 'processing'
      return { rows: due as unknown as R[], rowCount: due.length }
    }

    if (n.startsWith("UPDATE public.onchain_jobs SET status = 'done'")) {
      const id = Number(values[0])
      const job = this.jobs.find((j) => j.id === id)
      if (job) {
        job.status = 'done'
        if (values.length > 1) {
          job.tx_hash = String(values[1])
          job.last_error = null
        } else {
          job.last_error = 'already_unverified'
        }
      }
      return { rows: [], rowCount: 1 }
    }

    if (n.startsWith('INSERT INTO public.audit_log')) {
      return { rows: [], rowCount: 1 }
    }

    throw new Error(`Unhandled SQL in KycMemoryDb: ${n}`)
  }
}

function makeEnv(mode: 'sandbox' | 'live' = 'sandbox'): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') },
    SESSION_SECRET,
    VAULT_MASTER_KEY,
    DIDIT_API_KEY: 'didit_test_api_key',
    DIDIT_WORKFLOW_ID: '11111111-2222-3333-4444-555555555555',
    DIDIT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    DIDIT_MODE: mode,
    PUBLIC_APP_URL: 'https://app.onpeer.xyz',
  }
}

function makeChain(verifiedSet: Set<string>): ChainReader {
  return {
    getRoles: async () => ({
      owner: '0x54190a788eef66d9abddcf7d135b09b4d2b72f3a',
      arbiter: '0x54190a788eef66d9abddcf7d135b09b4d2b72f3a',
      backupArbiter: '0x54190a788eef66d9abddcf7d135b09b4d2b72f3a',
      verifier: '0xeebd29441af1a931c4a6eec2265b0757fd992f5e',
      kycRequired: false,
      sealedEnabled: false,
      payerProofRequired: false,
    }),
    getOrder: async () => null,
    getAd: async () => null,
    isVerified: async (w) => verifiedSet.has(w.toLowerCase()),
  }
}

describe('Step 6: Didit Sandbox KYC, X-Signature-V2 Webhooks, Relayer & Name Matching', () => {
  it('gates sandbox_scenario strictly behind DIDIT_MODE=sandbox and starts Didit v3 sessions', async () => {
    const db = new KycMemoryDb()
    await db.seedSession(TEST_TOKEN, TEST_WALLET)
    const chain = makeChain(new Set())

    // Live mode rejects sandboxScenario
    const liveRes = await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({ consent: true, sandboxScenario: 'approve' }),
      }),
      makeEnv('live'),
      { waitUntil: () => undefined },
      db,
      chain,
      '/kyc/start',
      { nowSec: db.nowSec },
    )
    expect(liveRes?.status).toBe(400)
    expect(await liveRes!.json()).toEqual({ error: 'sandbox_disabled' })

    // Sandbox mode forwards sandboxScenario and vendor_data = lowercase wallet
    let capturedScenario: string | undefined
    const startRes = await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify({ consent: true, sandboxScenario: 'approve' }),
      }),
      makeEnv('sandbox'),
      { waitUntil: () => undefined },
      db,
      chain,
      '/kyc/start',
      {
        nowSec: db.nowSec,
        createDiditSession: async (p) => {
          expect(p.wallet).toBe(TEST_WALLET)
          capturedScenario = p.sandboxScenario
          return {
            sessionId: 'sess-approve-001',
            url: 'https://verify.didit.me/session/tok123',
            status: 'Not Started',
          }
        },
      },
    )
    expect(startRes?.status).toBe(200)
    expect(capturedScenario).toBe('approve')
  })

  it('rejects stale timestamps, missing/bad signatures, and X-Signature-Simple-only webhooks', async () => {
    const db = new KycMemoryDb()
    db.kycSessions.set('sess-100', {
      wallet: TEST_WALLET,
      didit_session_id: 'sess-100',
      status: 'Not Started',
      sandbox_scenario: 'approve',
      created_at: new Date().toISOString(),
      decided_at: null,
    })
    const env = makeEnv('sandbox')
    const chain = makeChain(new Set())

    const payload = {
      event_id: 'evt-sec-1',
      webhook_type: 'status.updated',
      timestamp: db.nowSec,
      session_id: 'sess-sec-1',
      status: 'Approved',
      vendor_data: TEST_WALLET,
    }
    const rawBody = JSON.stringify(payload)
    const validSigV2 = await computeHmacSha256Hex(WEBHOOK_SECRET, canonicalizeDiditJson(payload))

    // 1. Stale timestamp (> 300s old) rejected
    const staleRes = await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-timestamp': String(db.nowSec - 301),
          'x-signature-v2': validSigV2,
        },
        body: rawBody,
      }),
      env,
      { waitUntil: () => undefined },
      db,
      chain,
      '/kyc/webhook',
      { nowSec: db.nowSec },
    )
    expect(staleRes?.status).toBe(401)
    expect(await staleRes!.json()).toEqual({ error: 'invalid_timestamp' })

    // 2. X-Signature-Simple alone (without X-Signature-V2 or X-Signature) is ALWAYS rejected
    const simpleOnlyRes = await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-timestamp': String(db.nowSec),
          'x-signature-simple': validSigV2,
        },
        body: rawBody,
      }),
      env,
      { waitUntil: () => undefined },
      db,
      chain,
      '/kyc/webhook',
      { nowSec: db.nowSec },
    )
    expect(simpleOnlyRes?.status).toBe(401)
    expect(await simpleOnlyRes!.json()).toEqual({ error: 'invalid_signature' })

    // 3. Tampered JSON body with old signature is rejected
    const tamperedRes = await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-timestamp': String(db.nowSec),
          'x-signature-v2': validSigV2,
        },
        body: JSON.stringify({ ...payload, status: 'Declined' }),
      }),
      env,
      { waitUntil: () => undefined },
      db,
      chain,
      '/kyc/webhook',
      { nowSec: db.nowSec },
    )
    expect(tamperedRes?.status).toBe(401)
  })

  it('processes Approved & Declined webhooks idempotently, executes onchain verifier jobs, and matches/masks names', async () => {
    const db = new KycMemoryDb()
    db.kycSessions.set('sess-100', {
      wallet: TEST_WALLET,
      didit_session_id: 'sess-100',
      status: 'Not Started',
      sandbox_scenario: 'approve',
      created_at: new Date().toISOString(),
      decided_at: null,
    })
    const env = makeEnv('sandbox')
    const verifiedOnchain = new Set<string>()
    const chain = makeChain(verifiedOnchain)
    const waitUntilPromises: Promise<unknown>[] = []

    const executor: VerifierTxExecutor = {
      async setVerification(wallet) {
        verifiedOnchain.add(wallet.toLowerCase())
        return ('0x' + 'aa'.repeat(32)) as `0x${string}`
      },
      async revokeVerification(wallet) {
        verifiedOnchain.delete(wallet.toLowerCase())
        return ('0x' + 'bb'.repeat(32)) as `0x${string}`
      },
    }

    // Pretty-printed JSON with unsorted keys, non-ASCII UTF-8 name, and whole float `100.0`
    const approvePayloadText = `{
      "webhook_type": "status.updated",
      "vendor_data": "${TEST_WALLET}",
      "status": "Approved",
      "session_id": "sess-100",
      "event_id": "evt-approve-100",
      "timestamp": ${db.nowSec},
      "sandbox_scenario": "approve",
      "decision": {
        "score": 100.0,
        "id_verification": {
          "first_name": "Tariq",
          "last_name": "Rahman"
        }
      }
    }`
    const parsedApprove = JSON.parse(approvePayloadText) as unknown
    const sigApprove = await computeHmacSha256Hex(WEBHOOK_SECRET, canonicalizeDiditJson(parsedApprove))

    const whRes = await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-timestamp': String(db.nowSec),
          'x-signature-v2': sigApprove,
        },
        body: approvePayloadText,
      }),
      env,
      { waitUntil: (p) => waitUntilPromises.push(p) },
      db,
      chain,
      '/kyc/webhook',
      {
        nowSec: db.nowSec,
        runJobsInBackground: () => processOnchainJobsBatch(env, db, chain, executor, db.nowSec),
      },
    )
    expect(whRes?.status).toBe(200)
    await Promise.all(waitUntilPromises)

    expect(verifiedOnchain.has(TEST_WALLET)).toBe(true)
    expect(db.jobs).toHaveLength(1)
    expect(db.jobs[0].status).toBe('done')
    expect(db.jobs[0].tx_hash).toBe('0x' + 'aa'.repeat(32))

    // Replay of the exact same `event_id` is ignored idempotently without queuing a second job
    const replayRes = await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-timestamp': String(db.nowSec + 5),
          'x-signature-v2': sigApprove,
        },
        body: approvePayloadText,
      }),
      env,
      { waitUntil: () => undefined },
      db,
      chain,
      '/kyc/webhook',
      { nowSec: db.nowSec + 5 },
    )
    expect(replayRes?.status).toBe(200)
    expect(await replayRes!.json()).toEqual({ ok: true, duplicate: true })
    expect(db.jobs).toHaveLength(1)

    // Counterparty name check: matches normalized name & returns masked initials ONLY
    const matchRes = await verifyCounterpartyName(env, db, TEST_WALLET, 'Mr. tariq rahman')
    expect(matchRes).toEqual({ status: 'match', maskedInitials: 'T*** R***' })

    const mismatchRes = await verifyCounterpartyName(env, db, TEST_WALLET, 'Someone Else')
    expect(mismatchRes).toEqual({ status: 'mismatch', maskedInitials: 'T*** R***' })

    // Subsequent Declined / Expired webhook for the approving session queues `revoke_verification` and revokes onchain
    const declinePayload = {
      event_id: 'evt-decline-100',
      webhook_type: 'status.updated',
      timestamp: db.nowSec + 20,
      session_id: 'sess-100',
      status: 'Declined',
      vendor_data: TEST_WALLET,
      sandbox_scenario: 'decline_document_expired',
    }
    const sigDecline = await computeHmacSha256Hex(WEBHOOK_SECRET, canonicalizeDiditJson(declinePayload))
    const waitDecline: Promise<unknown>[] = []
    const decRes = await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-timestamp': String(db.nowSec + 20),
          'x-signature-v2': sigDecline,
        },
        body: JSON.stringify(declinePayload),
      }),
      env,
      { waitUntil: (p) => waitDecline.push(p) },
      db,
      chain,
      '/kyc/webhook',
      {
        nowSec: db.nowSec + 20,
        runJobsInBackground: () => processOnchainJobsBatch(env, db, chain, executor, db.nowSec + 20),
      },
    )
    expect(decRes?.status).toBe(200)
    await Promise.all(waitDecline)

    expect(verifiedOnchain.has(TEST_WALLET)).toBe(false)
    expect(db.accounts.get(TEST_WALLET)?.kyc_status).toBe('declined')
    expect(db.jobs).toHaveLength(2)
    expect(db.jobs[1].kind).toBe('revoke_verification')
    expect(db.jobs[1].status).toBe('done')
  })

  it('M1/M2/M3: ignores unknown sessions, blocks unrelated-session & abandoned revokes, and rejects short look-alike names', async () => {
    const db = new KycMemoryDb()
    db.kycSessions.set('sess-100', {
      wallet: TEST_WALLET,
      didit_session_id: 'sess-100',
      status: 'Not Started',
      sandbox_scenario: 'approve',
      created_at: new Date().toISOString(),
      decided_at: null,
    })
    const env = makeEnv('sandbox')
    const chain = makeChain(new Set())

    // M2: Unknown session_id (not in kyc_sessions) is ignored
    const unknownPayload = {
      event_id: 'evt-unknown-1',
      webhook_type: 'status.updated',
      timestamp: db.nowSec,
      session_id: 'sess-never-created',
      status: 'Approved',
      vendor_data: TEST_WALLET,
    }
    const sigUnknown = await computeHmacSha256Hex(WEBHOOK_SECRET, canonicalizeDiditJson(unknownPayload))
    const unknownRes = await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-timestamp': String(db.nowSec),
          'x-signature-v2': sigUnknown,
        },
        body: JSON.stringify(unknownPayload),
      }),
      env,
      { waitUntil: () => undefined },
      db,
      chain,
      '/kyc/webhook',
      { nowSec: db.nowSec },
    )
    expect(unknownRes?.status).toBe(200)
    expect(await unknownRes!.json()).toEqual({ ok: true, ignored: true })
    expect(db.accounts.get(TEST_WALLET)).toBeUndefined()

    // Seed two sessions for the same wallet: sess-a (will be approved) and sess-b (unrelated)
    db.kycSessions.set('sess-a', {
      wallet: TEST_WALLET,
      didit_session_id: 'sess-a',
      status: 'Not Started',
      sandbox_scenario: 'approve',
      created_at: new Date().toISOString(),
      decided_at: null,
    })
    db.kycSessions.set('sess-b', {
      wallet: TEST_WALLET,
      didit_session_id: 'sess-b',
      status: 'Not Started',
      sandbox_scenario: 'decline_document_expired',
      created_at: new Date().toISOString(),
      decided_at: null,
    })

    // Approve sess-a with name "Md Rahim"
    const approveA = {
      event_id: 'evt-approve-a',
      webhook_type: 'status.updated',
      timestamp: db.nowSec,
      session_id: 'sess-a',
      status: 'Approved',
      vendor_data: TEST_WALLET,
      decision: { id_verification: { full_name: 'Md Rahim' } },
    }
    const sigA = await computeHmacSha256Hex(WEBHOOK_SECRET, canonicalizeDiditJson(approveA))
    await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-timestamp': String(db.nowSec), 'x-signature-v2': sigA },
        body: JSON.stringify(approveA),
      }),
      env,
      { waitUntil: () => undefined },
      db,
      chain,
      '/kyc/webhook',
      { nowSec: db.nowSec },
    )
    expect(db.accounts.get(TEST_WALLET)?.kyc_status).toBe('approved')
    expect(db.accounts.get(TEST_WALLET)?.approved_session_id).toBe('sess-a')

    // M3: Look-alike short names MUST mismatch ("Md Rahim" vs "Md Karim", "Md Rohim", single token "Rahim")
    expect(await verifyCounterpartyName(env, db, TEST_WALLET, 'Md Rahim')).toEqual({
      status: 'match',
      maskedInitials: 'M*** R***',
    })
    expect(await verifyCounterpartyName(env, db, TEST_WALLET, 'Md Karim')).toEqual({
      status: 'mismatch',
      maskedInitials: 'M*** R***',
    })
    expect(await verifyCounterpartyName(env, db, TEST_WALLET, 'Md Rohim')).toEqual({
      status: 'mismatch',
      maskedInitials: 'M*** R***',
    })
    expect(await verifyCounterpartyName(env, db, TEST_WALLET, 'Rahim')).toEqual({
      status: 'mismatch',
      maskedInitials: 'M*** R***',
    })

    // M1: Unrelated session sess-b Declined MUST NOT revoke sess-a's approval
    const declineB = {
      event_id: 'evt-decline-b',
      webhook_type: 'status.updated',
      timestamp: db.nowSec + 10,
      session_id: 'sess-b',
      status: 'Declined',
      vendor_data: TEST_WALLET,
    }
    const sigB = await computeHmacSha256Hex(WEBHOOK_SECRET, canonicalizeDiditJson(declineB))
    await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-timestamp': String(db.nowSec + 10), 'x-signature-v2': sigB },
        body: JSON.stringify(declineB),
      }),
      env,
      { waitUntil: () => undefined },
      db,
      chain,
      '/kyc/webhook',
      { nowSec: db.nowSec + 10 },
    )
    expect(db.accounts.get(TEST_WALLET)?.kyc_status).toBe('approved')
    expect(db.jobs.filter((j) => j.kind === 'revoke_verification')).toHaveLength(0)

    // M1: Abandoned on sess-a MUST NOT revoke approval
    const abandonA = {
      event_id: 'evt-abandon-a',
      webhook_type: 'status.updated',
      timestamp: db.nowSec + 20,
      session_id: 'sess-a',
      status: 'Abandoned',
      vendor_data: TEST_WALLET,
    }
    const sigAbandon = await computeHmacSha256Hex(WEBHOOK_SECRET, canonicalizeDiditJson(abandonA))
    await handleKycRoutes(
      new Request('https://app.onpeer.xyz/api/kyc/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-timestamp': String(db.nowSec + 20), 'x-signature-v2': sigAbandon },
        body: JSON.stringify(abandonA),
      }),
      env,
      { waitUntil: () => undefined },
      db,
      chain,
      '/kyc/webhook',
      { nowSec: db.nowSec + 20 },
    )
    expect(db.accounts.get(TEST_WALLET)?.kyc_status).toBe('approved')
    expect(db.jobs.filter((j) => j.kind === 'revoke_verification')).toHaveLength(0)
  })
})
