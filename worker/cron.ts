/**
 * worker/cron.ts — Scheduled maintenance & chain event scanner jobs (runs every minute via Cloudflare cron)
 *
 * Jobs:
 *  1. sweepExpiredRows     — DELETE rows past their delete_after/reset_at timestamp using each table's real PK,
 *                            isolated per table so one error never blocks other sweeps.
 *  2. sweepExpiredSessions — DELETE revoked/expired sessions (> 1 day old).
 *  3. checkKycExpiry       — Find approved KYC rows past kyc_expires_at, mark 'expired', queue revoke + email.
 *  4. scanChainEvents      — Scan P2PEscrow logs from `chain_cursor` for OrderOpened, OrderPaid, OrderReleased,
 *                            OrderDisputed and enqueue deduplicated notifications to the right party.
 *  5. recordCronHealth     — Record last run / error code (no PII) in `public.cron_health` for Admin panel.
 */
import { type AbiEvent } from 'viem'
import { p2pEscrowAbi } from '../src/abi/p2pEscrow'
import { createArcPublicClient, requireEscrowAddress, type ChainReader } from './chain'
import { writeAudit, type Queryable } from './db'
import type { Env } from './env'
import { queueNotification } from './notify'

const SWEEP_BATCH = 500
const SCAN_WINDOW_BLOCKS = 2_000n
const SCAN_MAX_WINDOWS_PER_TICK = 10
const SCAN_TIME_BUDGET_MS = 12_000
const CHAIN_CURSOR_NAME = 'escrow_events'

function requireAbiEvent(name: string): AbiEvent {
  const item = p2pEscrowAbi.find((e) => e.type === 'event' && e.name === name)
  if (!item || item.type !== 'event') throw new Error(`missing_abi_event:${name}`)
  return item as AbiEvent
}

export const SCANNED_EVENTS = {
  OrderOpened: requireAbiEvent('OrderOpened'),
  OrderPaid: requireAbiEvent('OrderPaid'),
  OrderReleased: requireAbiEvent('OrderReleased'),
  OrderCancelled: requireAbiEvent('OrderCancelled'),
  OrderDisputed: requireAbiEvent('OrderDisputed'),
  CaseTaken: requireAbiEvent('CaseTaken'),
  DisputeResolved: requireAbiEvent('DisputeResolved'),
} as const

export type SweepResult = Partial<Record<string, number>> & { errors?: string[] }

function shortErrorCode(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : ''
  const code = (err as { code?: string })?.code
  if (typeof code === 'string' && /^[A-Za-z0-9_]{2,24}$/.test(code)) return `${fallback}:${code}`
  if (msg.includes('timeout')) return `${fallback}:timeout`
  if (msg.includes('does not exist')) return `${fallback}:schema_err`
  return fallback
}

/** Upsert a short non-PII job status row in `public.cron_health`. */
export async function recordCronHealth(
  db: Queryable,
  jobName: string,
  errorCode: string | null,
): Promise<void> {
  if (errorCode) {
    console.error('cron_job_err', jobName, errorCode)
    await db
      .query(
        `INSERT INTO public.cron_health (job_name, last_run_at, last_error, last_error_at)
         VALUES ($1, now(), $2, now())
         ON CONFLICT (job_name) DO UPDATE
           SET last_run_at = now(),
               last_error = $2,
               last_error_at = now()`,
        [jobName.slice(0, 64), errorCode.slice(0, 120)],
      )
      .catch(() => undefined)
  } else {
    await db
      .query(
        `INSERT INTO public.cron_health (job_name, last_run_at, last_ok_at, last_error)
         VALUES ($1, now(), now(), NULL)
         ON CONFLICT (job_name) DO UPDATE
           SET last_run_at = now(),
               last_ok_at = now(),
               last_error = NULL`,
        [jobName.slice(0, 64)],
      )
      .catch(() => undefined)
  }
}

/**
 * H3: DELETE expired rows from every table using each table's REAL primary key.
 * Each table sweep runs independently so one error never stops the remaining sweeps.
 */
export async function sweepExpiredRows(db: Queryable): Promise<SweepResult> {
  const results: SweepResult = {}
  const errors: string[] = []

  const sweeps: Array<{ name: string; sql: string }> = [
    {
      name: 'vault_blobs',
      sql: `DELETE FROM public.vault_blobs
             WHERE id IN (
               SELECT id FROM public.vault_blobs
                WHERE delete_after IS NOT NULL AND delete_after < now()
                LIMIT ${SWEEP_BATCH}
             )`,
    },
    {
      name: 'chat_messages',
      sql: `DELETE FROM public.chat_messages
             WHERE id IN (
               SELECT id FROM public.chat_messages
                WHERE delete_after IS NOT NULL AND delete_after < now()
                LIMIT ${SWEEP_BATCH}
             )`,
    },
    {
      name: 'dispute_filings',
      sql: `DELETE FROM public.dispute_filings
             WHERE id IN (
               SELECT id FROM public.dispute_filings
                WHERE delete_after IS NOT NULL AND delete_after < now()
                LIMIT ${SWEEP_BATCH}
             )`,
    },
    {
      name: 'webhook_events',
      sql: `DELETE FROM public.webhook_events
             WHERE event_id IN (
               SELECT event_id FROM public.webhook_events
                WHERE delete_after IS NOT NULL AND delete_after < now()
                LIMIT ${SWEEP_BATCH}
             )`,
    },
    {
      name: 'notifications_outbox',
      sql: `DELETE FROM public.notifications_outbox
             WHERE id IN (
               SELECT id FROM public.notifications_outbox
                WHERE status IN ('sent', 'failed')
                  AND created_at < now() - interval '30 days'
                LIMIT ${SWEEP_BATCH}
             )`,
    },
    {
      name: 'rate_limits',
      sql: `DELETE FROM public.rate_limits
             WHERE bucket IN (
               SELECT bucket FROM public.rate_limits
                WHERE reset_at < now() - interval '7 days'
                LIMIT ${SWEEP_BATCH}
             )`,
    },
  ]

  for (const s of sweeps) {
    try {
      const res = await db.query(s.sql)
      const deleted = res.rowCount ?? 0
      if (deleted > 0) results[s.name] = deleted
    } catch (err) {
      const code = shortErrorCode(err, `sweep_${s.name}`)
      console.error('cron_sweep_err', code)
      errors.push(code)
    }
  }

  if (errors.length > 0) results.errors = errors
  return results
}

/** DELETE sessions that have been revoked or expired for more than 1 day. */
export async function sweepExpiredSessions(db: Queryable): Promise<number> {
  const res = await db.query(
    `DELETE FROM public.sessions
      WHERE token_hash IN (
        SELECT token_hash FROM public.sessions
         WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '1 day')
            OR (expires_at < now() - interval '1 day')
         LIMIT ${SWEEP_BATCH}
      )`,
  )
  return res.rowCount ?? 0
}

interface KycExpiryRow {
  wallet: string
}

/**
 * Find accounts with approved KYC whose `kyc_expires_at` has passed.
 * Marks them 'expired' in the DB, queues a revoke_verification onchain job,
 * and queues an email notification.
 */
export async function checkKycExpiry(db: Queryable): Promise<number> {
  const res = await db.query<KycExpiryRow>(
    `UPDATE public.accounts
        SET kyc_status = 'expired',
            kyc_level  = 0,
            approved_session_id = NULL
      WHERE wallet IN (
        SELECT wallet FROM public.accounts
         WHERE kyc_status = 'approved'
           AND kyc_expires_at IS NOT NULL
           AND kyc_expires_at <= now()
           AND deleted_at IS NULL
         LIMIT 50
      )
      RETURNING wallet`,
  )

  for (const row of res.rows) {
    const wallet = row.wallet as `0x${string}`

    await db
      .query(
        `INSERT INTO public.onchain_jobs (kind, payload, status, run_after)
         VALUES ('revoke_verification', $1::jsonb, 'pending', now())`,
        [JSON.stringify({ wallet, reason: 'kyc_expired' })],
      )
      .catch(() => undefined)

    await queueNotification(db, wallet, 'kyc_expired').catch(() => undefined)
    await writeAudit(db, 'cron', 'kyc.expired', wallet).catch(() => undefined)
  }

  return res.rows.length
}

/**
 * H5: Scan P2PEscrow logs using `public.chain_cursor` and enqueue deduplicated emails:
 * - OrderOpened   -> maker (the counterparty of order.taker)
 * - OrderPaid     -> seller
 * - OrderReleased -> buyer + seller
 * - OrderDisputed -> buyer + seller + arbiter
 */
export interface ChainLogClient {
  getBlockNumber(): Promise<bigint>
  getLogs(params: {
    address: `0x${string}`
    events: AbiEvent[]
    fromBlock: bigint
    toBlock: bigint
  }): Promise<Array<{ eventName?: string; args?: unknown }>>
}

export async function scanChainEvents(
  env: Env,
  db: Queryable,
  chain: ChainReader,
  rpcClient?: ChainLogClient,
): Promise<{
  fromBlock: bigint
  toBlock: bigint
  latestBlock: bigint
  lag: bigint
  windows: number
  queued: number
}> {
  const escrow = requireEscrowAddress(env)
  const client: ChainLogClient = rpcClient ?? createArcPublicClient()
  const latestBlock = await client.getBlockNumber()

  const curRes = await db.query<{ last_block: string | number }>(
    `SELECT last_block FROM public.chain_cursor WHERE name = $1 LIMIT 1`,
    [CHAIN_CURSOR_NAME],
  )

  let startBlock: bigint
  if (curRes.rows[0]) {
    startBlock = BigInt(curRes.rows[0].last_block) + 1n
  } else {
    const deployBlock = env.VITE_P2P_DEPLOY_BLOCK ? BigInt(env.VITE_P2P_DEPLOY_BLOCK) : 0n
    const recentFloor = latestBlock > 200n ? latestBlock - 200n : 0n
    startBlock = deployBlock > recentFloor ? deployBlock : recentFloor
  }

  if (startBlock > latestBlock) {
    return {
      fromBlock: startBlock,
      toBlock: latestBlock,
      latestBlock,
      lag: 0n,
      windows: 0,
      queued: 0,
    }
  }

  const startedAt = Date.now()
  let windowStart = startBlock
  let lastScanned = startBlock - 1n
  let windows = 0
  let queued = 0
  let rolesCache: Awaited<ReturnType<ChainReader['getRoles']>> | null = null

  while (
    windowStart <= latestBlock &&
    windows < SCAN_MAX_WINDOWS_PER_TICK &&
    Date.now() - startedAt < SCAN_TIME_BUDGET_MS
  ) {
    const windowEnd =
      latestBlock - windowStart + 1n > SCAN_WINDOW_BLOCKS
        ? windowStart + SCAN_WINDOW_BLOCKS - 1n
        : latestBlock

    // Single eth_getLogs call per window (Arc Testnet RPC accepts up to 5,000 blocks)
    const logs = await client.getLogs({
      address: escrow,
      events: Object.values(SCANNED_EVENTS),
      fromBlock: windowStart,
      toBlock: windowEnd,
    })

    for (const log of logs) {
      const orderId = (log.args as { orderId?: bigint } | undefined)?.orderId
      if (!orderId) continue
      const order = await chain.getOrder(orderId)
      if (!order) continue

      switch (log.eventName) {
        case 'OrderOpened': {
          const maker = order.taker === order.buyer ? order.seller : order.buyer
          await queueNotification(db, maker, 'order_opened', orderId)
          queued++
          break
        }
        case 'OrderPaid': {
          await queueNotification(db, order.seller, 'order_paid', orderId)
          queued++
          break
        }
        case 'OrderReleased': {
          await queueNotification(db, order.buyer, 'order_completed', orderId)
          await queueNotification(db, order.seller, 'order_completed', orderId)
          queued += 2
          break
        }
        case 'OrderCancelled': {
          await queueNotification(db, order.buyer, 'order_cancelled', orderId)
          await queueNotification(db, order.seller, 'order_cancelled', orderId)
          queued += 2
          break
        }
        case 'OrderDisputed': {
          if (!rolesCache) rolesCache = await chain.getRoles()
          const recipients = Array.from(new Set([order.buyer, order.seller, rolesCache.arbiter]))
          for (const r of recipients) {
            await queueNotification(db, r, 'order_disputed', orderId)
            queued++
          }
          break
        }
        case 'CaseTaken': {
          await queueNotification(db, order.buyer, 'case_taken', orderId)
          await queueNotification(db, order.seller, 'case_taken', orderId)
          queued += 2
          break
        }
        case 'DisputeResolved': {
          await queueNotification(db, order.buyer, 'dispute_resolved', orderId)
          await queueNotification(db, order.seller, 'dispute_resolved', orderId)
          queued += 2
          break
        }
      }
    }

    await db.query(
      `INSERT INTO public.chain_cursor (name, last_block, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (name) DO UPDATE
         SET last_block = EXCLUDED.last_block,
             updated_at = now()`,
      [CHAIN_CURSOR_NAME, windowEnd.toString()],
    )

    lastScanned = windowEnd
    windowStart = windowEnd + 1n
    windows++
  }

  return {
    fromBlock: startBlock,
    toBlock: lastScanned,
    latestBlock,
    lag: latestBlock > lastScanned ? latestBlock - lastScanned : 0n,
    windows,
    queued,
  }
}

/** Run all maintenance jobs in one cron tick. Errors are isolated and logged as short codes. */
export async function runAllCronJobs(db: Queryable): Promise<void> {
  try {
    const res = await sweepExpiredRows(db)
    await recordCronHealth(db, 'sweep_expired_rows', res.errors?.length ? res.errors.join(',') : null)
  } catch (err) {
    await recordCronHealth(db, 'sweep_expired_rows', shortErrorCode(err, 'sweep_err'))
  }

  try {
    await sweepExpiredSessions(db)
    await recordCronHealth(db, 'sweep_expired_sessions', null)
  } catch (err) {
    await recordCronHealth(db, 'sweep_expired_sessions', shortErrorCode(err, 'sessions_err'))
  }

  try {
    await checkKycExpiry(db)
    await recordCronHealth(db, 'check_kyc_expiry', null)
  } catch (err) {
    await recordCronHealth(db, 'check_kyc_expiry', shortErrorCode(err, 'kyc_expiry_err'))
  }
}
