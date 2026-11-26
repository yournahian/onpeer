import { Client, type QueryResultRow } from 'pg'
import type { Env } from './env'

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>
}

export class DbUnavailableError extends Error {
  constructor() {
    super('database_unavailable')
  }
}

function resolveConnectionString(env: Env): string {
  const cs = env.HYPERDRIVE?.connectionString?.trim()
  if (!cs) throw new DbUnavailableError()
  return cs
}

/**
 * Open a short-lived node-postgres Client bound to Cloudflare Hyperdrive for a single
 * Worker invocation and guarantee cleanup before the turn ends.
 */
export async function withDb<T>(env: Env, fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: resolveConnectionString(env),
    statement_timeout: 10_000,
    query_timeout: 10_000,
    connectionTimeoutMillis: 10_000,
  })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => undefined)
  }
}

/** Run `fn` inside a SERIALIZABLE / READ COMMITTED SQL transaction on the given client. */
export async function withTx<T>(db: Queryable, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  await db.query('BEGIN')
  try {
    const out = await fn(db)
    await db.query('COMMIT')
    return out
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  }
}

/**
 * Shared Postgres-backed fixed-window rate limiter safe across stateless Worker isolates.
 * Returns `true` when the request is allowed, `false` when the bucket exceeded `limit`.
 */
export async function checkRateLimit(
  db: Queryable,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const res = await db.query<{ count: number }>(
    `INSERT INTO public.rate_limits (bucket, count, reset_at)
     VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (bucket) DO UPDATE
       SET count = CASE
             WHEN public.rate_limits.reset_at <= now() THEN 1
             ELSE public.rate_limits.count + 1
           END,
           reset_at = CASE
             WHEN public.rate_limits.reset_at <= now() THEN now() + make_interval(secs => $2)
             ELSE public.rate_limits.reset_at
           END
     RETURNING count`,
    [bucket.slice(0, 160), windowSeconds],
  )
  const count = res.rows[0]?.count ?? 1
  return count <= limit
}

/** Append a non-PII audit log entry (never pass names, emails, or payment details). */
export async function writeAudit(
  db: Queryable,
  actor: string,
  action: string,
  subject?: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO public.audit_log (actor, action, subject) VALUES ($1, $2, $3)`,
    [actor.slice(0, 80), action.slice(0, 80), subject ? subject.slice(0, 120) : null],
  )
}
