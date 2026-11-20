import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import type { Queryable } from '../db'
import { sweepExpiredRows, sweepExpiredSessions, checkKycExpiry } from '../cron'

class CronMemoryDb implements Queryable {
  vaultBlobs: Array<{ id: string; delete_after: string | null }> = []
  chatMessages: Array<{ id: string; delete_after: string | null }> = []
  webhookEvents: Array<{ id: string; delete_after: string | null }> = []
  disputeFilings: Array<{ id: string; delete_after: string | null }> = []
  sessions: Array<{ token_hash: string; expires_at: string; revoked_at: string | null }> = []
  accounts: Array<{ wallet: string; kyc_status: string; kyc_expires_at: string | null; kyc_level: number }> = []
  onchainJobs: Array<{ kind: string; payload: string; status: string }> = []
  outboxRows: Array<{ wallet: string; event: string; dedupe_key: string | null }> = []
  audits: Array<{ actor: string; action: string; subject: string | null }> = []

  past(daysAgo: number): string {
    return new Date(Date.now() - daysAgo * 86400_000).toISOString()
  }
  future(daysFromNow: number): string {
    return new Date(Date.now() + daysFromNow * 86400_000).toISOString()
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: R[]; rowCount: number | null }> {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n === 'BEGIN' || n === 'COMMIT' || n === 'ROLLBACK') return { rows: [], rowCount: 0 }

    // sweepExpiredRows: DELETE from vault_blobs
    if (n.startsWith('DELETE FROM public.vault_blobs')) {
      const before = this.vaultBlobs.length
      this.vaultBlobs = this.vaultBlobs.filter((r) => !r.delete_after || new Date(r.delete_after) >= new Date())
      return { rows: [], rowCount: before - this.vaultBlobs.length }
    }

    // sweepExpiredRows: DELETE from chat_messages
    if (n.startsWith('DELETE FROM public.chat_messages')) {
      const before = this.chatMessages.length
      this.chatMessages = this.chatMessages.filter((r) => !r.delete_after || new Date(r.delete_after) >= new Date())
      return { rows: [], rowCount: before - this.chatMessages.length }
    }

    // sweepExpiredRows: DELETE from dispute_filings
    if (n.startsWith('DELETE FROM public.dispute_filings')) {
      const before = this.disputeFilings.length
      this.disputeFilings = this.disputeFilings.filter((r) => !r.delete_after || new Date(r.delete_after) >= new Date())
      return { rows: [], rowCount: before - this.disputeFilings.length }
    }

    // sweepExpiredRows: DELETE from webhook_events
    if (n.startsWith('DELETE FROM public.webhook_events')) {
      const before = this.webhookEvents.length
      this.webhookEvents = this.webhookEvents.filter((r) => !r.delete_after || new Date(r.delete_after) >= new Date())
      return { rows: [], rowCount: before - this.webhookEvents.length }
    }

    // sweepExpiredRows: DELETE from notifications_outbox
    if (n.startsWith('DELETE FROM public.notifications_outbox')) {
      return { rows: [], rowCount: 0 }
    }

    // sweepExpiredRows: DELETE from rate_limits
    if (n.startsWith('DELETE FROM public.rate_limits')) {
      return { rows: [], rowCount: 0 }
    }

    // sweepExpiredSessions
    if (n.startsWith('DELETE FROM public.sessions')) {
      const before = this.sessions.length
      this.sessions = this.sessions.filter((s) => {
        const expired = new Date(s.expires_at) < new Date()
        const revoked = s.revoked_at !== null && new Date(s.revoked_at) < new Date()
        return !expired && !revoked
      })
      return { rows: [], rowCount: before - this.sessions.length }
    }

    // checkKycExpiry: UPDATE accounts SET kyc_status = 'expired' RETURNING wallet
    if (n.startsWith('UPDATE public.accounts') && n.includes("kyc_status = 'expired'") && n.includes('RETURNING wallet')) {
      const expired = this.accounts.filter(
        (a) => a.kyc_status === 'approved' && a.kyc_expires_at && new Date(a.kyc_expires_at) <= new Date(),
      )
      for (const a of expired) {
        a.kyc_status = 'expired'
        a.kyc_level = 0
      }
      return { rows: expired as unknown as R[], rowCount: expired.length }
    }

    // checkKycExpiry: INSERT onchain_jobs
    if (n.startsWith('INSERT INTO public.onchain_jobs')) {
      this.onchainJobs.push({ kind: 'revoke_verification', payload: String(values[0]), status: 'pending' })
      return { rows: [], rowCount: 1 }
    }

    // checkKycExpiry: INSERT notifications_outbox (via queueNotification)
    if (n.startsWith('INSERT INTO public.notifications_outbox') && n.includes('ON CONFLICT (dedupe_key) DO NOTHING')) {
      this.outboxRows.push({ wallet: String(values[0]), event: String(values[1]), dedupe_key: values[3] ? String(values[3]) : null })
      return { rows: [], rowCount: 1 }
    }

    // audit_log
    if (n.startsWith('INSERT INTO public.audit_log')) {
      this.audits.push({ actor: String(values[0]), action: String(values[1]), subject: values[2] ? String(values[2]) : null })
      return { rows: [], rowCount: 1 }
    }

    return { rows: [], rowCount: 0 }
  }
}

// =========================================================================
describe('cron — sweepExpiredRows', () => {
  it('deletes expired vault_blobs and chat_messages, keeps non-expired', async () => {
    const db = new CronMemoryDb()
    db.vaultBlobs = [
      { id: '1', delete_after: db.past(1) },   // expired → delete
      { id: '2', delete_after: db.future(1) },  // future → keep
      { id: '3', delete_after: null },           // no expiry → keep
    ]
    db.chatMessages = [
      { id: '10', delete_after: db.past(2) },   // expired → delete
      { id: '11', delete_after: db.future(10) }, // future → keep
    ]
    db.webhookEvents = []
    db.disputeFilings = []

    const result = await sweepExpiredRows(db)

    expect(db.vaultBlobs).toHaveLength(2) // 1 deleted
    expect(db.vaultBlobs.map((r) => r.id)).not.toContain('1')
    expect(db.chatMessages).toHaveLength(1) // 1 deleted
    expect(result.vault_blobs).toBe(1)
    expect(result.chat_messages).toBe(1)
  })

  it('no-ops when nothing is expired', async () => {
    const db = new CronMemoryDb()
    db.vaultBlobs = [{ id: '1', delete_after: db.future(5) }]
    db.chatMessages = []
    db.webhookEvents = []
    db.disputeFilings = []

    const result = await sweepExpiredRows(db)

    expect(db.vaultBlobs).toHaveLength(1)
    expect(result.vault_blobs).toBeUndefined()
  })
})

// =========================================================================
describe('cron — sweepExpiredSessions', () => {
  it('deletes expired and revoked sessions', async () => {
    const db = new CronMemoryDb()
    db.sessions = [
      { token_hash: 'aaa', expires_at: db.past(2), revoked_at: null },        // expired → delete
      { token_hash: 'bbb', expires_at: db.future(1), revoked_at: db.past(1) }, // revoked → delete
      { token_hash: 'ccc', expires_at: db.future(1), revoked_at: null },       // valid → keep
    ]

    const deleted = await sweepExpiredSessions(db)

    expect(deleted).toBe(2)
    expect(db.sessions).toHaveLength(1)
    expect(db.sessions[0]!.token_hash).toBe('ccc')
  })
})

// =========================================================================
describe('cron — checkKycExpiry', () => {
  it('marks expired KYC accounts and queues revoke + notification', async () => {
    const db = new CronMemoryDb()
    db.accounts = [
      { wallet: '0x1111111111111111111111111111111111111111', kyc_status: 'approved', kyc_expires_at: db.past(1), kyc_level: 1 },
      { wallet: '0x2222222222222222222222222222222222222222', kyc_status: 'approved', kyc_expires_at: db.future(30), kyc_level: 1 }, // not expired
      { wallet: '0x3333333333333333333333333333333333333333', kyc_status: 'declined', kyc_expires_at: db.past(1), kyc_level: 0 }, // wrong status
    ]

    const count = await checkKycExpiry(db)

    expect(count).toBe(1)
    expect(db.accounts[0]!.kyc_status).toBe('expired')
    expect(db.accounts[0]!.kyc_level).toBe(0)
    expect(db.accounts[1]!.kyc_status).toBe('approved') // unchanged
    expect(db.accounts[2]!.kyc_status).toBe('declined') // unchanged

    // Onchain job queued
    expect(db.onchainJobs).toHaveLength(1)
    expect(db.onchainJobs[0]!.kind).toBe('revoke_verification')

    // Email notification queued
    expect(db.outboxRows).toHaveLength(1)
    expect(db.outboxRows[0]!.event).toBe('kyc_expired')

    // Audit written
    expect(db.audits.some((a) => a.action === 'kyc.expired')).toBe(true)
  })

  it('no-ops when no accounts are expired', async () => {
    const db = new CronMemoryDb()
    db.accounts = [
      { wallet: '0x1111111111111111111111111111111111111111', kyc_status: 'approved', kyc_expires_at: db.future(30), kyc_level: 1 },
    ]

    const count = await checkKycExpiry(db)

    expect(count).toBe(0)
    expect(db.onchainJobs).toHaveLength(0)
    expect(db.outboxRows).toHaveLength(0)
  })
})
