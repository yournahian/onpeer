import { sealText } from './crypto'
import { checkRateLimit, type Queryable } from './db'
import { clientIp, json, normalizeWallet, readJsonBody, textField, type Env } from './env'

const VALID_KINDS = new Set(['p2p', 'swap', 'bridge'])
const VALID_STATUSES = new Set(['success', 'failed'])
const VALID_ROUTES = new Set(['home', 'p2p', 'swap', 'bridge', 'buy', 'assistant', 'docs', 'admin', 'privacy', 'brand-kit'])
const COUNTRY_RE = /^[A-Z]{2}$/
const TX_HASH_RE = /^0x[0-9a-f]{64}$/

function extractCountry(req: Request, bodyCountry?: unknown): string {
  const cf = (req as Request & { cf?: { country?: string } }).cf
  const fromCf = typeof cf?.country === 'string' ? cf.country.trim().toUpperCase() : ''
  if (COUNTRY_RE.test(fromCf) && fromCf !== 'T1') return fromCf
  const fromHeader = (req.headers.get('cf-ipcountry') ?? '').trim().toUpperCase()
  if (COUNTRY_RE.test(fromHeader) && fromHeader !== 'T1') return fromHeader
  const fromBody = typeof bodyCountry === 'string' ? bodyCountry.trim().toUpperCase() : ''
  if (COUNTRY_RE.test(fromBody)) return fromBody
  return 'XX'
}

function parseNonNegNumber(v: unknown, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, max)
}

function isUndefinedTableError(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  const msg = err instanceof Error ? err.message : ''
  return code === '42P01' || msg.includes('analytics_txs') || msg.includes('analytics_daily_visits')
}

export async function handlePublicAnalyticsRoutes(
  req: Request,
  env: Env,
  db: Queryable,
  path: string,
): Promise<Response | null> {
  if (path !== '/analytics/visit' && path !== '/analytics/tx') return null
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' })

  const ip = clientIp(req)
  const body = (await readJsonBody(req, 4_096)) ?? {}
  const country = extractCountry(req, body.country)

  if (path === '/analytics/visit') {
    const allowed = await checkRateLimit(db, `rl:an:visit:${ip}`, 30, 60)
    if (!allowed) return json(200, { ok: true }) // never break UX on visit ping

    const rawRoute = textField(body.route, 24)?.toLowerCase() ?? 'home'
    const route = VALID_ROUTES.has(rawRoute) ? rawRoute : 'home'
    const isUnique = body.isUnique === true ? 1 : 0

    try {
      await db.query(
        `INSERT INTO public.analytics_daily_visits (day, country, route, visits, unique_visitors)
         VALUES (CURRENT_DATE, $1, $2, 1, $3)
         ON CONFLICT (day, country, route) DO UPDATE
           SET visits = public.analytics_daily_visits.visits + 1,
               unique_visitors = public.analytics_daily_visits.unique_visitors + EXCLUDED.unique_visitors`,
        [country, route, isUnique],
      )
    } catch (err) {
      if (!isUndefinedTableError(err)) {
        console.error('[analytics/visit] insert error', err instanceof Error ? err.message : String(err))
      }
    }
    return json(200, { ok: true })
  }

  // POST /api/analytics/tx
  const allowed = await checkRateLimit(db, `rl:an:tx:${ip}`, 40, 60)
  if (!allowed) return json(429, { error: 'rate_limited' })

  const kind = textField(body.kind, 16)?.toLowerCase() ?? ''
  const action = textField(body.action, 48) ?? ''
  const wallet = normalizeWallet(body.wallet)
  const chain = textField(body.chain, 32) ?? 'Arc'
  const token = textField(body.token, 16)?.toUpperCase() ?? 'USDC'
  const status = textField(body.status, 16)?.toLowerCase() ?? ''
  const rawHash = textField(body.txHash, 80)?.toLowerCase()
  const txHash = rawHash && TX_HASH_RE.test(rawHash) ? rawHash : null
  const amountUsd = parseNonNegNumber(body.amountUsd, 100_000_000)
  const networkFeeUsd = parseNonNegNumber(body.networkFeeUsd, 10_000)
  const note = textField(body.note, 200)

  if (!VALID_KINDS.has(kind) || !action || !wallet || !VALID_STATUSES.has(status)) {
    return json(400, { error: 'bad_request' })
  }

  let metaEnc: string | null = null
  if (note) {
    try {
      metaEnc = await sealText(env, JSON.stringify({ note }), `analytics:tx:${wallet}`)
    } catch {
      metaEnc = null
    }
  }

  try {
    await db.query(
      `INSERT INTO public.analytics_txs
         (tx_hash, kind, action, wallet, chain, token, amount_usd, network_fee_usd, status, country, meta_enc)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (tx_hash) WHERE tx_hash IS NOT NULL DO NOTHING`,
      [txHash, kind, action, wallet, chain, token, amountUsd, networkFeeUsd, status, country, metaEnc],
    )
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      console.error('[analytics/tx] insert error', err instanceof Error ? err.message : String(err))
    }
  }

  return json(200, { ok: true })
}

export async function handleAdminAnalyticsQuery(
  req: Request,
  db: Queryable,
): Promise<Response> {
  const url = new URL(req.url)
  const rawRange = (url.searchParams.get('range') ?? '30d').toLowerCase()
  const rawCountry = (url.searchParams.get('country') ?? 'ALL').trim().toUpperCase()
  const countryFilter = rawCountry !== 'ALL' && COUNTRY_RE.test(rawCountry) ? rawCountry : null

  const days =
    rawRange === '7d' ? 7 : rawRange === '90d' ? 90 : rawRange === 'all' ? 3650 : 30
  const seriesDays = Math.min(days, 90)

  try {
    const [
      txCurrRes,
      txPrevRes,
      chainRes,
      kindRes,
      countryTxRes,
      countryVisitRes,
      countryKycRes,
      dailyTxRes,
      dailyVisitRes,
      dailyKycRes,
      dailyEmailRes,
      kycCurrRes,
      kycPrevRes,
      emailCurrRes,
      emailPrevRes,
      visitCurrRes,
      visitPrevRes,
      customerRes,
      historyRes,
    ] = await Promise.all([
      // 1. Current period Tx KPIs
      db.query<{
        total_volume: string
        total_txns: string
        success_txns: string
        failed_txns: string
        highest_amount: string
        lowest_amount: string
        avg_fee: string
        total_fee: string
      }>(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'success' THEN amount_usd ELSE 0 END), 0)::text AS total_volume,
           COUNT(*)::text AS total_txns,
           COUNT(*) FILTER (WHERE status = 'success')::text AS success_txns,
           COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_txns,
           COALESCE(MAX(CASE WHEN status = 'success' AND amount_usd > 0 THEN amount_usd END), 0)::text AS highest_amount,
           COALESCE(MIN(CASE WHEN status = 'success' AND amount_usd > 0 THEN amount_usd END), 0)::text AS lowest_amount,
           COALESCE(AVG(network_fee_usd) FILTER (WHERE network_fee_usd > 0), 0)::text AS avg_fee,
           COALESCE(SUM(network_fee_usd), 0)::text AS total_fee
         FROM public.analytics_txs
         WHERE created_at >= now() - make_interval(days => $1)
           AND ($2::text IS NULL OR country = $2)`,
        [days, countryFilter],
      ),
      // 2. Previous period Tx KPIs (for Difference / Growth chart)
      db.query<{ total_volume: string; total_txns: string; success_txns: string }>(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'success' THEN amount_usd ELSE 0 END), 0)::text AS total_volume,
           COUNT(*)::text AS total_txns,
           COUNT(*) FILTER (WHERE status = 'success')::text AS success_txns
         FROM public.analytics_txs
         WHERE created_at >= now() - make_interval(days => $1)
           AND created_at <  now() - make_interval(days => $2)
           AND ($3::text IS NULL OR country = $3)`,
        [days * 2, days, countryFilter],
      ),
      // 3. Chain usage breakdown
      db.query<{ chain: string; txns: string; volume: string; success_txns: string; avg_fee: string }>(
        `SELECT
           chain,
           COUNT(*)::text AS txns,
           COALESCE(SUM(CASE WHEN status = 'success' THEN amount_usd ELSE 0 END), 0)::text AS volume,
           COUNT(*) FILTER (WHERE status = 'success')::text AS success_txns,
           COALESCE(AVG(network_fee_usd) FILTER (WHERE network_fee_usd > 0), 0)::text AS avg_fee
         FROM public.analytics_txs
         WHERE created_at >= now() - make_interval(days => $1)
           AND ($2::text IS NULL OR country = $2)
         GROUP BY chain
         ORDER BY SUM(CASE WHEN status = 'success' THEN amount_usd ELSE 0 END) DESC, COUNT(*) DESC`,
        [days, countryFilter],
      ),
      // 4. Kind breakdown (P2P / Swap / Bridge)
      db.query<{ kind: string; txns: string; volume: string }>(
        `SELECT
           kind,
           COUNT(*)::text AS txns,
           COALESCE(SUM(CASE WHEN status = 'success' THEN amount_usd ELSE 0 END), 0)::text AS volume
         FROM public.analytics_txs
         WHERE created_at >= now() - make_interval(days => $1)
           AND ($2::text IS NULL OR country = $2)
         GROUP BY kind
         ORDER BY volume DESC`,
        [days, countryFilter],
      ),
      // 5. Country breakdown — Txs (always global so country switcher & comparison work)
      db.query<{ country: string; txns: string; volume: string; success_txns: string }>(
        `SELECT
           country,
           COUNT(*)::text AS txns,
           COALESCE(SUM(CASE WHEN status = 'success' THEN amount_usd ELSE 0 END), 0)::text AS volume,
           COUNT(*) FILTER (WHERE status = 'success')::text AS success_txns
         FROM public.analytics_txs
         WHERE created_at >= now() - make_interval(days => $1)
         GROUP BY country`,
        [days],
      ),
      // 6. Country breakdown — Visits
      db.query<{ country: string; visits: string; unique_visitors: string }>(
        `SELECT
           country,
           COALESCE(SUM(visits), 0)::text AS visits,
           COALESCE(SUM(unique_visitors), 0)::text AS unique_visitors
         FROM public.analytics_daily_visits
         WHERE day >= CURRENT_DATE - ($1::int)
         GROUP BY country`,
        [days],
      ),
      // 7. Country breakdown — Accounts & KYC
      db.query<{ country: string; accounts: string; kyc_approved: string; email_verified: string }>(
        `SELECT
           COALESCE(NULLIF(UPPER(country), ''), 'XX') AS country,
           COUNT(*)::text AS accounts,
           COUNT(*) FILTER (WHERE kyc_status = 'approved')::text AS kyc_approved,
           COUNT(*) FILTER (WHERE email_verified_at IS NOT NULL)::text AS email_verified
         FROM public.accounts
         WHERE deleted_at IS NULL
         GROUP BY COALESCE(NULLIF(UPPER(country), ''), 'XX')`,
      ),
      // 8. Daily Tx series
      db.query<{ day: string; volume: string; txns: string; success_txns: string; failed_txns: string }>(
        `SELECT
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           COALESCE(SUM(CASE WHEN status = 'success' THEN amount_usd ELSE 0 END), 0)::text AS volume,
           COUNT(*)::text AS txns,
           COUNT(*) FILTER (WHERE status = 'success')::text AS success_txns,
           COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_txns
         FROM public.analytics_txs
         WHERE created_at >= now() - make_interval(days => $1)
           AND ($2::text IS NULL OR country = $2)
         GROUP BY 1
         ORDER BY 1 ASC`,
        [seriesDays, countryFilter],
      ),
      // 9. Daily Visits series
      db.query<{ day: string; visits: string; unique_visitors: string }>(
        `SELECT
           to_char(day, 'YYYY-MM-DD') AS day,
           COALESCE(SUM(visits), 0)::text AS visits,
           COALESCE(SUM(unique_visitors), 0)::text AS unique_visitors
         FROM public.analytics_daily_visits
         WHERE day >= CURRENT_DATE - ($1::int)
           AND ($2::text IS NULL OR country = $2)
         GROUP BY 1
         ORDER BY 1 ASC`,
        [seriesDays, countryFilter],
      ),
      // 10. Daily KYC series
      db.query<{ day: string; started: string; approved: string }>(
        `SELECT
           to_char(k.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           COUNT(*)::text AS started,
           COUNT(*) FILTER (WHERE LOWER(k.status) = 'approved')::text AS approved
         FROM public.kyc_sessions k
         LEFT JOIN public.accounts a ON a.wallet = k.wallet
         WHERE k.created_at >= now() - make_interval(days => $1)
           AND ($2::text IS NULL OR COALESCE(NULLIF(UPPER(a.country), ''), 'XX') = $2)
         GROUP BY 1
         ORDER BY 1 ASC`,
        [seriesDays, countryFilter],
      ),
      // 11. Daily Email notifications series
      db.query<{ day: string; total: string; sent: string }>(
        `SELECT
           to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE n.status = 'sent')::text AS sent
         FROM public.notifications_outbox n
         LEFT JOIN public.accounts a ON a.wallet = n.recipient_wallet
         WHERE n.created_at >= now() - make_interval(days => $1)
           AND ($2::text IS NULL OR COALESCE(NULLIF(UPPER(a.country), ''), 'XX') = $2)
         GROUP BY 1
         ORDER BY 1 ASC`,
        [seriesDays, countryFilter],
      ),
      // 12. Current period KYC totals
      db.query<{ started: string; approved: string; declined: string; pending: string }>(
        `SELECT
           COUNT(*)::text AS started,
           COUNT(*) FILTER (WHERE LOWER(k.status) = 'approved')::text AS approved,
           COUNT(*) FILTER (WHERE LOWER(k.status) IN ('declined', 'rejected'))::text AS declined,
           COUNT(*) FILTER (WHERE LOWER(k.status) NOT IN ('approved', 'declined', 'rejected'))::text AS pending
         FROM public.kyc_sessions k
         LEFT JOIN public.accounts a ON a.wallet = k.wallet
         WHERE k.created_at >= now() - make_interval(days => $1)
           AND ($2::text IS NULL OR COALESCE(NULLIF(UPPER(a.country), ''), 'XX') = $2)`,
        [days, countryFilter],
      ),
      // 13. Previous period KYC totals
      db.query<{ started: string }>(
        `SELECT COUNT(*)::text AS started
         FROM public.kyc_sessions k
         LEFT JOIN public.accounts a ON a.wallet = k.wallet
         WHERE k.created_at >= now() - make_interval(days => $1)
           AND k.created_at <  now() - make_interval(days => $2)
           AND ($3::text IS NULL OR COALESCE(NULLIF(UPPER(a.country), ''), 'XX') = $3)`,
        [days * 2, days, countryFilter],
      ),
      // 14. Current period Email totals
      db.query<{ total: string; sent: string; failed: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE n.status = 'sent')::text AS sent,
           COUNT(*) FILTER (WHERE n.status = 'failed')::text AS failed
         FROM public.notifications_outbox n
         LEFT JOIN public.accounts a ON a.wallet = n.recipient_wallet
         WHERE n.created_at >= now() - make_interval(days => $1)
           AND ($2::text IS NULL OR COALESCE(NULLIF(UPPER(a.country), ''), 'XX') = $2)`,
        [days, countryFilter],
      ),
      // 15. Previous period Email totals
      db.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM public.notifications_outbox n
         LEFT JOIN public.accounts a ON a.wallet = n.recipient_wallet
         WHERE n.created_at >= now() - make_interval(days => $1)
           AND n.created_at <  now() - make_interval(days => $2)
           AND ($3::text IS NULL OR COALESCE(NULLIF(UPPER(a.country), ''), 'XX') = $3)`,
        [days * 2, days, countryFilter],
      ),
      // 16. Current period Visits
      db.query<{ visits: string; unique_visitors: string }>(
        `SELECT
           COALESCE(SUM(visits), 0)::text AS visits,
           COALESCE(SUM(unique_visitors), 0)::text AS unique_visitors
         FROM public.analytics_daily_visits
         WHERE day >= CURRENT_DATE - ($1::int)
           AND ($2::text IS NULL OR country = $2)`,
        [days, countryFilter],
      ),
      // 17. Previous period Visits
      db.query<{ visits: string; unique_visitors: string }>(
        `SELECT
           COALESCE(SUM(visits), 0)::text AS visits,
           COALESCE(SUM(unique_visitors), 0)::text AS unique_visitors
         FROM public.analytics_daily_visits
         WHERE day >= CURRENT_DATE - ($1::int)
           AND day <  CURRENT_DATE - ($2::int)
           AND ($3::text IS NULL OR country = $3)`,
        [days * 2, days, countryFilter],
      ),
      // 18. Customer-wise leaderboard
      db.query<{
        wallet: string
        display_name: string | null
        kyc_status: string | null
        country: string
        total_volume: string
        total_txns: string
        success_txns: string
        highest_amount: string
        lowest_amount: string
        avg_fee: string
        chains: string[]
        last_tx_at: string | Date
      }>(
        `SELECT
           t.wallet,
           MAX(a.display_name) AS display_name,
           MAX(a.kyc_status) AS kyc_status,
           COALESCE(NULLIF(MAX(t.country), 'XX'), COALESCE(NULLIF(UPPER(MAX(a.country)), ''), 'XX')) AS country,
           COALESCE(SUM(CASE WHEN t.status = 'success' THEN t.amount_usd ELSE 0 END), 0)::text AS total_volume,
           COUNT(*)::text AS total_txns,
           COUNT(*) FILTER (WHERE t.status = 'success')::text AS success_txns,
           COALESCE(MAX(CASE WHEN t.status = 'success' AND t.amount_usd > 0 THEN t.amount_usd END), 0)::text AS highest_amount,
           COALESCE(MIN(CASE WHEN t.status = 'success' AND t.amount_usd > 0 THEN t.amount_usd END), 0)::text AS lowest_amount,
           COALESCE(AVG(t.network_fee_usd) FILTER (WHERE t.network_fee_usd > 0), 0)::text AS avg_fee,
           ARRAY_AGG(DISTINCT t.chain) AS chains,
           MAX(t.created_at) AS last_tx_at
         FROM public.analytics_txs t
         LEFT JOIN public.accounts a ON a.wallet = t.wallet
         WHERE t.created_at >= now() - make_interval(days => $1)
           AND ($2::text IS NULL OR t.country = $2)
         GROUP BY t.wallet
         ORDER BY SUM(CASE WHEN t.status = 'success' THEN t.amount_usd ELSE 0 END) DESC, COUNT(*) DESC
         LIMIT 100`,
        [days, countryFilter],
      ),
      // 19. Full historical transactions (latest 250)
      db.query<{
        id: string | number
        tx_hash: string | null
        kind: string
        action: string
        wallet: string
        display_name: string | null
        chain: string
        token: string
        amount_usd: string
        network_fee_usd: string
        status: string
        country: string
        created_at: string | Date
      }>(
        `SELECT
           t.id, t.tx_hash, t.kind, t.action, t.wallet, a.display_name,
           t.chain, t.token, t.amount_usd::text, t.network_fee_usd::text,
           t.status, t.country, t.created_at
         FROM public.analytics_txs t
         LEFT JOIN public.accounts a ON a.wallet = t.wallet
         WHERE t.created_at >= now() - make_interval(days => $1)
           AND ($2::text IS NULL OR t.country = $2)
         ORDER BY t.created_at DESC
         LIMIT 250`,
        [days, countryFilter],
      ),
    ])

    const currTx = txCurrRes.rows[0]
    const prevTx = txPrevRes.rows[0]
    const totalTxns = Number(currTx?.total_txns ?? 0)
    const successTxns = Number(currTx?.success_txns ?? 0)
    const failedTxns = Number(currTx?.failed_txns ?? 0)
    const totalVolume = Number(currTx?.total_volume ?? 0)

    // Merge country metrics
    const countryMap = new Map<
      string,
      {
        country: string
        txns: number
        volume: number
        successRate: number
        visits: number
        uniqueVisitors: number
        accounts: number
        kycApproved: number
        emailVerified: number
      }
    >()
    const ensureCountry = (code: string) => {
      let c = countryMap.get(code)
      if (!c) {
        c = {
          country: code,
          txns: 0,
          volume: 0,
          successRate: 0,
          visits: 0,
          uniqueVisitors: 0,
          accounts: 0,
          kycApproved: 0,
          emailVerified: 0,
        }
        countryMap.set(code, c)
      }
      return c
    }
    for (const r of countryTxRes.rows) {
      const c = ensureCountry(r.country)
      c.txns = Number(r.txns)
      c.volume = Number(r.volume)
      c.successRate = c.txns > 0 ? (Number(r.success_txns) / c.txns) * 100 : 0
    }
    for (const r of countryVisitRes.rows) {
      const c = ensureCountry(r.country)
      c.visits = Number(r.visits)
      c.uniqueVisitors = Number(r.unique_visitors)
    }
    for (const r of countryKycRes.rows) {
      const c = ensureCountry(r.country)
      c.accounts = Number(r.accounts)
      c.kycApproved = Number(r.kyc_approved)
      c.emailVerified = Number(r.email_verified)
    }

    // Build unified daily time-series (filled for every day in window)
    const dailyMap = new Map<
      string,
      {
        day: string
        volume: number
        txns: number
        successTxns: number
        failedTxns: number
        visits: number
        uniqueVisitors: number
        kycStarted: number
        kycApproved: number
        emailsTotal: number
        emailsSent: number
      }
    >()
    const todayUtc = new Date()
    const fillDays = Math.min(seriesDays, 30)
    for (let i = fillDays - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate() - i))
      const iso = d.toISOString().slice(0, 10)
      dailyMap.set(iso, {
        day: iso,
        volume: 0,
        txns: 0,
        successTxns: 0,
        failedTxns: 0,
        visits: 0,
        uniqueVisitors: 0,
        kycStarted: 0,
        kycApproved: 0,
        emailsTotal: 0,
        emailsSent: 0,
      })
    }
    const ensureDay = (day: string) => {
      let row = dailyMap.get(day)
      if (!row) {
        row = {
          day,
          volume: 0,
          txns: 0,
          successTxns: 0,
          failedTxns: 0,
          visits: 0,
          uniqueVisitors: 0,
          kycStarted: 0,
          kycApproved: 0,
          emailsTotal: 0,
          emailsSent: 0,
        }
        dailyMap.set(day, row)
      }
      return row
    }
    for (const r of dailyTxRes.rows) {
      const d = ensureDay(r.day)
      d.volume = Number(r.volume)
      d.txns = Number(r.txns)
      d.successTxns = Number(r.success_txns)
      d.failedTxns = Number(r.failed_txns)
    }
    for (const r of dailyVisitRes.rows) {
      const d = ensureDay(r.day)
      d.visits = Number(r.visits)
      d.uniqueVisitors = Number(r.unique_visitors)
    }
    for (const r of dailyKycRes.rows) {
      const d = ensureDay(r.day)
      d.kycStarted = Number(r.started)
      d.kycApproved = Number(r.approved)
    }
    for (const r of dailyEmailRes.rows) {
      const d = ensureDay(r.day)
      d.emailsTotal = Number(r.total)
      d.emailsSent = Number(r.sent)
    }

    const dailySeries = Array.from(dailyMap.values()).sort((a, b) => a.day.localeCompare(b.day))
    const byCountry = Array.from(countryMap.values()).sort(
      (a, b) => b.volume - a.volume || b.visits - a.visits || b.accounts - a.accounts,
    )

    return json(200, {
      migrationRequired: false,
      range: rawRange,
      country: countryFilter ?? 'ALL',
      summary: {
        totalVolume,
        totalTxns,
        successTxns,
        failedTxns,
        successRate: totalTxns > 0 ? (successTxns / totalTxns) * 100 : 100,
        highestAmount: Number(currTx?.highest_amount ?? 0),
        lowestAmount: Number(currTx?.lowest_amount ?? 0),
        avgNetworkFee: Number(currTx?.avg_fee ?? 0),
        totalNetworkFee: Number(currTx?.total_fee ?? 0),
        visits: Number(visitCurrRes.rows[0]?.visits ?? 0),
        uniqueVisitors: Number(visitCurrRes.rows[0]?.unique_visitors ?? 0),
        kycStarted: Number(kycCurrRes.rows[0]?.started ?? 0),
        kycApproved: Number(kycCurrRes.rows[0]?.approved ?? 0),
        kycDeclined: Number(kycCurrRes.rows[0]?.declined ?? 0),
        kycPending: Number(kycCurrRes.rows[0]?.pending ?? 0),
        emailsTotal: Number(emailCurrRes.rows[0]?.total ?? 0),
        emailsSent: Number(emailCurrRes.rows[0]?.sent ?? 0),
        emailsFailed: Number(emailCurrRes.rows[0]?.failed ?? 0),
      },
      previous: {
        totalVolume: Number(prevTx?.total_volume ?? 0),
        totalTxns: Number(prevTx?.total_txns ?? 0),
        successRate:
          Number(prevTx?.total_txns ?? 0) > 0
            ? (Number(prevTx?.success_txns ?? 0) / Number(prevTx?.total_txns ?? 0)) * 100
            : 100,
        visits: Number(visitPrevRes.rows[0]?.visits ?? 0),
        uniqueVisitors: Number(visitPrevRes.rows[0]?.unique_visitors ?? 0),
        kycStarted: Number(kycPrevRes.rows[0]?.started ?? 0),
        emailsTotal: Number(emailPrevRes.rows[0]?.total ?? 0),
      },
      byChain: chainRes.rows.map((r) => {
        const n = Number(r.txns)
        return {
          chain: r.chain,
          txns: n,
          volume: Number(r.volume),
          successRate: n > 0 ? (Number(r.success_txns) / n) * 100 : 100,
          avgFee: Number(r.avg_fee),
        }
      }),
      byKind: kindRes.rows.map((r) => ({
        kind: r.kind,
        txns: Number(r.txns),
        volume: Number(r.volume),
      })),
      byCountry,
      dailySeries,
      customers: customerRes.rows.map((r) => {
        const n = Number(r.total_txns)
        return {
          wallet: r.wallet,
          displayName: r.display_name,
          kycStatus: r.kyc_status ?? 'none',
          country: r.country,
          totalVolume: Number(r.total_volume),
          totalTxns: n,
          successRate: n > 0 ? (Number(r.success_txns) / n) * 100 : 100,
          highestAmount: Number(r.highest_amount),
          lowestAmount: Number(r.lowest_amount),
          avgNetworkFee: Number(r.avg_fee),
          chains: Array.isArray(r.chains) ? r.chains : [],
          lastTxAt: r.last_tx_at instanceof Date ? r.last_tx_at.toISOString() : new Date(r.last_tx_at).toISOString(),
        }
      }),
      history: historyRes.rows.map((r) => ({
        id: String(r.id),
        txHash: r.tx_hash,
        kind: r.kind,
        action: r.action,
        wallet: r.wallet,
        displayName: r.display_name,
        chain: r.chain,
        token: r.token,
        amountUsd: Number(r.amount_usd),
        networkFeeUsd: Number(r.network_fee_usd),
        status: r.status,
        country: r.country,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
      })),
    })
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return json(200, {
        migrationRequired: true,
        range: rawRange,
        country: countryFilter ?? 'ALL',
        summary: null,
        previous: null,
        byChain: [],
        byKind: [],
        byCountry: [],
        dailySeries: [],
        customers: [],
        history: [],
      })
    }
    throw err
  }
}
