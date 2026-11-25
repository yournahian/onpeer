import { describe, expect, it } from 'vitest'
import { decodeEventLog, encodeAbiParameters, encodeEventTopics, toEventSelector, type AbiEvent } from 'viem'
import type { QueryResultRow } from 'pg'
import { p2pEscrowAbi } from '../../src/abi/p2pEscrow'
import type { Queryable } from '../db'
import { SCANNED_EVENTS, scanChainEvents, sweepExpiredRows, sweepExpiredSessions, checkKycExpiry } from '../cron'
import type { ChainReader } from '../chain'
import type { Env } from '../env'

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
  cursors = new Map<string, string>()

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

    // chain_cursor
    if (n.startsWith('SELECT last_block FROM public.chain_cursor')) {
      const lb = this.cursors.get(String(values[0]))
      return lb ? { rows: [{ last_block: lb } as unknown as R], rowCount: 1 } : { rows: [], rowCount: 0 }
    }
    if (n.startsWith('INSERT INTO public.chain_cursor')) {
      this.cursors.set(String(values[0]), String(values[1]))
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

// =========================================================================
describe('cron — SCANNED_EVENTS match deployed P2PEscrow ABI & decode real logs', () => {
  it('matches all 7 event selectors in p2pEscrowAbi and decodes encoded OrderOpened, OrderPaid, OrderReleased, OrderCancelled, OrderDisputed, CaseTaken, and DisputeResolved logs', () => {
    const names = [
      'OrderOpened',
      'OrderPaid',
      'OrderReleased',
      'OrderCancelled',
      'OrderDisputed',
      'CaseTaken',
      'DisputeResolved',
    ] as const

    for (const name of names) {
      const abiEvent = p2pEscrowAbi.find((e) => e.type === 'event' && e.name === name) as AbiEvent
      expect(abiEvent).toBeDefined()
      expect(toEventSelector(SCANNED_EVENTS[name])).toBe(toEventSelector(abiEvent))
    }

    const buyer = '0x1111111111111111111111111111111111111111' as const
    const seller = '0x2222222222222222222222222222222222222222' as const
    const arbiter = '0x3333333333333333333333333333333333333333' as const

    // 1. OrderOpened(uint256 indexed orderId, uint256 indexed adId, address indexed buyer, address seller, uint128 amount)
    const openedTopics = encodeEventTopics({
      abi: [SCANNED_EVENTS.OrderOpened],
      eventName: 'OrderOpened',
      args: { orderId: 42n, adId: 7n, buyer },
    })
    const openedData = encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint128' }],
      [seller, 50_000000n],
    )
    const opened = decodeEventLog({
      abi: [SCANNED_EVENTS.OrderOpened],
      topics: openedTopics as [`0x${string}`, ...`0x${string}`[]],
      data: openedData,
    })
    expect(opened.eventName).toBe('OrderOpened')
    expect((opened.args as { orderId: bigint; seller: string; amount: bigint }).orderId).toBe(42n)
    expect((opened.args as { seller: string }).seller.toLowerCase()).toBe(seller)

    // 2. OrderPaid(uint256 indexed orderId, uint64 paidAt)
    const paidTopics = encodeEventTopics({
      abi: [SCANNED_EVENTS.OrderPaid],
      eventName: 'OrderPaid',
      args: { orderId: 42n },
    })
    const paidData = encodeAbiParameters([{ type: 'uint64' }], [1_795_001_000n])
    const paid = decodeEventLog({
      abi: [SCANNED_EVENTS.OrderPaid],
      topics: paidTopics as [`0x${string}`, ...`0x${string}`[]],
      data: paidData,
    })
    expect(paid.eventName).toBe('OrderPaid')
    expect((paid.args as { orderId: bigint }).orderId).toBe(42n)

    // 3. OrderReleased(uint256 indexed orderId, address indexed buyer, uint128 amount)
    const relTopics = encodeEventTopics({
      abi: [SCANNED_EVENTS.OrderReleased],
      eventName: 'OrderReleased',
      args: { orderId: 42n, buyer },
    })
    const relData = encodeAbiParameters([{ type: 'uint128' }], [50_000000n])
    const rel = decodeEventLog({
      abi: [SCANNED_EVENTS.OrderReleased],
      topics: relTopics as [`0x${string}`, ...`0x${string}`[]],
      data: relData,
    })
    expect(rel.eventName).toBe('OrderReleased')
    expect((rel.args as { orderId: bigint }).orderId).toBe(42n)

    // 4. OrderDisputed(uint256 indexed orderId, address indexed caller, uint64 disputedAt)
    const dispTopics = encodeEventTopics({
      abi: [SCANNED_EVENTS.OrderDisputed],
      eventName: 'OrderDisputed',
      args: { orderId: 42n, caller: buyer },
    })
    const dispData = encodeAbiParameters([{ type: 'uint64' }], [1_795_002_000n])
    const disp = decodeEventLog({
      abi: [SCANNED_EVENTS.OrderDisputed],
      topics: dispTopics as [`0x${string}`, ...`0x${string}`[]],
      data: dispData,
    })
    expect(disp.eventName).toBe('OrderDisputed')
    expect((disp.args as { orderId: bigint }).orderId).toBe(42n)

    // 5. CaseTaken(uint256 indexed orderId, address indexed arbiter, uint64 reviewStartedAt)
    const takenTopics = encodeEventTopics({
      abi: [SCANNED_EVENTS.CaseTaken],
      eventName: 'CaseTaken',
      args: { orderId: 42n, arbiter },
    })
    const takenData = encodeAbiParameters([{ type: 'uint64' }], [1_795_003_000n])
    const taken = decodeEventLog({
      abi: [SCANNED_EVENTS.CaseTaken],
      topics: takenTopics as [`0x${string}`, ...`0x${string}`[]],
      data: takenData,
    })
    expect(taken.eventName).toBe('CaseTaken')
    expect((taken.args as { orderId: bigint }).orderId).toBe(42n)

    // 6. DisputeResolved(uint256 indexed orderId, bool toBuyer, address indexed recipient, uint128 amount)
    const resTopics = encodeEventTopics({
      abi: [SCANNED_EVENTS.DisputeResolved],
      eventName: 'DisputeResolved',
      args: { orderId: 42n, recipient: buyer },
    })
    const resData = encodeAbiParameters([{ type: 'bool' }, { type: 'uint128' }], [true, 50_000000n])
    const resolved = decodeEventLog({
      abi: [SCANNED_EVENTS.DisputeResolved],
      topics: resTopics as [`0x${string}`, ...`0x${string}`[]],
      data: resData,
    })
    expect(resolved.eventName).toBe('DisputeResolved')
    expect((resolved.args as { orderId: bigint; toBuyer: boolean }).toBuyer).toBe(true)
  })

  it('retries the window without advancing chain_cursor when chain.getOrder throws a transient RPC error', async () => {
    const db = new CronMemoryDb()
    db.cursors.set('escrow_events', '100')

    const buyer = '0x1111111111111111111111111111111111111111' as const
    const seller = '0x2222222222222222222222222222222222222222' as const
    let failNextOrderRead = true

    const chain: ChainReader = {
      getRoles: async () => ({
        owner: buyer,
        arbiter: buyer,
        backupArbiter: buyer,
        verifier: buyer,
        kycRequired: false,
        sealedEnabled: false,
        payerProofRequired: false,
      }),
      getAd: async () => null,
      isVerified: async () => false,
      getOpenOrderCount: async () => 0n,
      getUserAdIds: async () => [],
      getOrder: async (orderId: bigint) => {
        if (failNextOrderRead) {
          throw new Error('rpc_timeout')
        }
        return {
          id: orderId,
          adId: 1n,
          buyer,
          seller,
          taker: buyer,
          status: 2,
          createdAt: 1000n,
          deadline: 2000n,
          paidAt: 1100n,
          disputedAt: 0n,
          reviewStartedAt: 0n,
          amount: 10_000000n,
          detailsReady: true,
          detailsHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
          payerProof: ('0x' + '00'.repeat(32)) as `0x${string}`,
          paidLate: false,
        }
      },
    }

    const rpcClient = {
      getBlockNumber: async () => 150n,
      getLogs: async () => [{ eventName: 'OrderPaid', args: { orderId: 7n } }],
    }

    const env = {
      VITE_P2P_ESCROW_ADDRESS: '0xf719ebbc5080aee09e38909764b897e0bf01a9b0',
    } as unknown as Env

    // Tick 1: transient RPC error aborts scan before advancing chain_cursor
    await expect(scanChainEvents(env, db, chain, rpcClient)).rejects.toThrow('rpc_timeout')
    expect(db.cursors.get('escrow_events')).toBe('100')
    expect(db.outboxRows).toHaveLength(0)

    // Tick 2: RPC recovers -> same window is re-scanned and OrderPaid email is queued
    failNextOrderRead = false
    const res = await scanChainEvents(env, db, chain, rpcClient)
    expect(res.fromBlock).toBe(101n)
    expect(res.toBlock).toBe(150n)
    expect(res.queued).toBe(1)
    expect(db.cursors.get('escrow_events')).toBe('150')
    expect(db.outboxRows).toHaveLength(1)
    expect(db.outboxRows[0]).toEqual({
      wallet: seller,
      event: 'order_paid',
      dedupe_key: `order_paid:${seller}:7`,
    })
  })

  it('scans secondary asset escrows (EURC) with per-asset cursors and queues scoped order IDs (H-01)', async () => {
    const db = new CronMemoryDb()
    db.cursors.set('escrow_events', '73721910')
    db.cursors.set('escrow_events:EURC', '73721900')
    db.cursors.set('escrow_events:cirBTC', '73734225')
    db.cursors.set('escrow_events:WETH', '73734238')

    const buyer = '0x1111111111111111111111111111111111111111' as const
    const seller = '0x2222222222222222222222222222222222222222' as const

    const chain: ChainReader = {
      getRoles: async () => ({
        owner: buyer,
        arbiter: buyer,
        backupArbiter: buyer,
        verifier: buyer,
        kycRequired: false,
        sealedEnabled: false,
        payerProofRequired: false,
      }),
      getAd: async () => null,
      isVerified: async () => false,
      getOpenOrderCount: async () => 0n,
      getUserAdIds: async () => [],
      getOrder: async (scopedId: bigint) => ({
        id: scopedId,
        adId: 1_000_000_000_001n,
        buyer,
        seller,
        taker: buyer,
        status: 2,
        createdAt: 1000n,
        deadline: 2000n,
        paidAt: 1100n,
        disputedAt: 0n,
        reviewStartedAt: 0n,
        amount: 25_000000n,
        detailsReady: true,
        detailsHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
        payerProof: ('0x' + '00'.repeat(32)) as `0x${string}`,
        paidLate: false,
      }),
    }

    const eurcEscrow = '0x0db2fbf8357617172a3b852bc2ac3054dba1d402'
    const rpcClient = {
      getBlockNumber: async () => 73721910n,
      getLogs: async (params: { address: `0x${string}` }) =>
        params.address.toLowerCase() === eurcEscrow
          ? [{ eventName: 'OrderPaid', args: { orderId: 5n } }]
          : [],
    }

    const env = {
      VITE_P2P_ESCROW_ADDRESS: '0xf719ebbc5080aee09e38909764b897e0bf01a9b0',
      VITE_P2P_EURC_ESCROW_ADDRESS: eurcEscrow,
    } as unknown as Env

    const res = await scanChainEvents(env, db, chain, rpcClient)
    expect(res.queued).toBe(1)
    expect(db.cursors.get('escrow_events:EURC')).toBe('73721910')
    expect(db.outboxRows).toHaveLength(1)
    expect(db.outboxRows[0]).toEqual({
      wallet: seller,
      event: 'order_paid',
      dedupe_key: `order_paid:${seller}:1000000000005`,
    })
  })
})
