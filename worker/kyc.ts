import { p2pEscrowAbi } from '../src/abi/p2pEscrow'
import { requireSession } from './auth'
import { createChainReader, createVerifierClients, type ChainReader } from './chain'
import { canonicalizeDiditJson, openText, sealText, verifyHmacSha256Hex } from './crypto'
import { checkRateLimit, withDb, withTx, writeAudit, type Queryable } from './db'
import {
  clientIp,
  isDiditSandbox,
  json,
  normalizeWallet,
  publicAppOrigin,
  readJsonBody,
  textField,
  type Env,
  type WorkerExecutionContext,
} from './env'

export const WEBHOOK_MAX_SKEW_SECONDS = 300 // 5 minutes
export const KYC_VALIDITY_SECONDS = 365 * 24 * 60 * 60 // 12 months
const DIDIT_SESSION_URL = 'https://verification.didit.me/v3/session/'

export const SANDBOX_SCENARIOS = [
  { slug: 'approve', label: 'Approve — Happy path (all checks pass)' },
  { slug: 'decline_document_expired', label: 'Decline — Expired ID document' },
  { slug: 'decline_face_match_low_similarity', label: 'Decline — Face match below threshold' },
  { slug: 'decline_aml_hit', label: 'Decline — AML screening hit' },
  { slug: 'review_aml_possible_match', label: 'In Review — Manual review required' },
] as const

const ALLOWED_SCENARIO_RE = /^[a-z0-9_]{3,64}$/

export interface DiditSessionCreator {
  (params: {
    apiKey: string
    workflowId: string
    wallet: `0x${string}`
    callbackUrl: string
    sandboxScenario?: string
  }): Promise<{ sessionId: string; url: string; status: string }>
}

export interface VerifierTxExecutor {
  setVerification(wallet: `0x${string}`, level: number, expiry: bigint): Promise<`0x${string}`>
  revokeVerification(wallet: `0x${string}`): Promise<`0x${string}`>
}

export type NameMatchResult = {
  status: 'match' | 'mismatch' | 'unverified'
  maskedInitials: string | null
}

function kycNameAad(wallet: `0x${string}`): string {
  return `account:kyc_name:${wallet}`
}

export function maskPersonName(name: string): string | null {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0)
  if (parts.length === 0) return null
  return parts
    .slice(0, 4)
    .map((p) => {
      const first = Array.from(p)[0] ?? '*'
      return `${first.toUpperCase()}***`
    })
    .join(' ')
}

function normalizeNameForComparison(raw: string): string[] {
  const cleaned = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return []
  const honorifics = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'shri', 'smt'])
  const tokens = cleaned.split(' ').filter((t) => t.length > 0 && !honorifics.has(t))
  return tokens.length > 0 ? tokens : cleaned.split(' ')
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const prev = new Array<number>(b.length + 1)
  const curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

/**
 * Strict token-based name match:
 * - When the KYC name has 2+ tokens, the submitted name must also have 2+ tokens.
 * - Every token in the KYC name must match a distinct submitted token either:
 *   (a) exactly, or
 *   (b) within Levenshtein edit distance 1 ONLY when both tokens have length >= 6.
 * This prevents short look-alike names (e.g. "Md Rahim" vs "Md Karim") from matching.
 */
export function tokensMatchKycName(kycTokens: string[], submittedTokens: string[]): boolean {
  if (kycTokens.length === 0 || submittedTokens.length === 0) return false
  if (kycTokens.length >= 2 && submittedTokens.length < 2) return false

  const used = new Array<boolean>(submittedTokens.length).fill(false)

  // First pass: exact token matches
  const remainingKyc: string[] = []
  for (const kTok of kycTokens) {
    const exactIdx = submittedTokens.findIndex((sTok, idx) => !used[idx] && sTok === kTok)
    if (exactIdx !== -1) {
      used[exactIdx] = true
    } else {
      remainingKyc.push(kTok)
    }
  }

  // Second pass: edit distance <= 1 ONLY for tokens of length >= 6
  for (const kTok of remainingKyc) {
    if (kTok.length < 6) return false
    const fuzzyIdx = submittedTokens.findIndex(
      (sTok, idx) => !used[idx] && sTok.length >= 6 && levenshteinDistance(kTok, sTok) <= 1,
    )
    if (fuzzyIdx === -1) return false
    used[fuzzyIdx] = true
  }

  return true
}

/**
 * Compare a submitted payment/sender name against the encrypted KYC name for `wallet`.
 * Returns ONLY `'match' | 'mismatch' | 'unverified'` and masked initials (`"T*** R***"`), never the full name.
 */
export async function verifyCounterpartyName(
  env: Env,
  db: Queryable,
  wallet: `0x${string}`,
  submittedName: string | null | undefined,
): Promise<NameMatchResult> {
  const res = await db.query<{ kyc_status: string; kyc_expires_at: string | Date | null; kyc_name_enc: string | null }>(
    `SELECT kyc_status, kyc_expires_at, kyc_name_enc
       FROM public.accounts
      WHERE wallet = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [wallet],
  )
  const row = res.rows[0]
  if (!row || row.kyc_status !== 'approved' || !row.kyc_name_enc) {
    return { status: 'unverified', maskedInitials: null }
  }
  if (row.kyc_expires_at && new Date(row.kyc_expires_at).getTime() <= Date.now()) {
    return { status: 'unverified', maskedInitials: null }
  }

  let verifiedName: string
  try {
    verifiedName = await openText(env, row.kyc_name_enc, kycNameAad(wallet))
  } catch {
    return { status: 'unverified', maskedInitials: null }
  }

  const maskedInitials = maskPersonName(verifiedName)
  if (!submittedName || !submittedName.trim()) {
    return { status: 'mismatch', maskedInitials }
  }

  const matched = tokensMatchKycName(
    normalizeNameForComparison(verifiedName),
    normalizeNameForComparison(submittedName),
  )
  return {
    status: matched ? 'match' : 'mismatch',
    maskedInitials,
  }
}

function extractDecisionName(payload: Record<string, unknown>): string | null {
  const decision = payload.decision
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return null
  const dec = decision as Record<string, unknown>

  const candidates: unknown[] = [dec.full_name]
  for (const subKey of ['id_verification', 'id_document', 'kyc', 'user', 'ocr']) {
    const sub = dec[subKey]
    if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
      const s = sub as Record<string, unknown>
      candidates.push(s.full_name)
      const fn = typeof s.first_name === 'string' ? s.first_name.trim() : ''
      const ln = typeof s.last_name === 'string' ? s.last_name.trim() : ''
      if (fn || ln) candidates.push(`${fn} ${ln}`.trim())
    }
  }
  // Didit v3 id_verifications array support
  if (Array.isArray(dec.id_verifications) && dec.id_verifications[0] && typeof dec.id_verifications[0] === 'object') {
    const idv = dec.id_verifications[0] as Record<string, unknown>
    candidates.push(idv.full_name)
    const fn = typeof idv.first_name === 'string' ? idv.first_name.trim() : ''
    const ln = typeof idv.last_name === 'string' ? idv.last_name.trim() : ''
    if (fn || ln) candidates.push(`${fn} ${ln}`.trim())
  }

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length >= 2) {
      return c.trim().slice(0, 120)
    }
  }
  return null
}

const defaultDiditSessionCreator: DiditSessionCreator = async ({
  apiKey,
  workflowId,
  wallet,
  callbackUrl,
  sandboxScenario,
}) => {
  const res = await fetch(DIDIT_SESSION_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      workflow_id: workflowId,
      vendor_data: wallet,
      callback: callbackUrl,
      ...(sandboxScenario ? { sandbox_scenario: sandboxScenario } : {}),
    }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) {
    throw new Error(`didit_session_http_${res.status}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  const sessionId = typeof data.session_id === 'string' ? data.session_id.trim() : ''
  const url =
    typeof data.url === 'string'
      ? data.url.trim()
      : typeof data.verification_url === 'string'
        ? data.verification_url.trim()
        : ''
  const status = typeof data.status === 'string' ? data.status.trim() : 'Not Started'
  if (!sessionId || !url.startsWith('https://')) {
    throw new Error('didit_session_malformed_response')
  }
  return { sessionId, url, status }
}

function sanitizeJobError(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'relayer_error'
  if (msg.includes('verifier_not_appointed_onchain')) return 'verifier_not_appointed_onchain'
  if (msg.includes('verifier_key_must_be_separate_from_governance')) return 'verifier_key_governance_conflict'
  if (msg.includes('verifier_key_not_configured')) return 'verifier_key_not_configured'
  if (msg.toLowerCase().includes('insufficient funds')) return 'verifier_insufficient_gas'
  return 'onchain_tx_failed'
}

/**
 * Claim and execute due `onchain_jobs` (`set_verification` / `revoke_verification`) sequentially
 * so the verifier EOA nonces never collide across concurrent workers.
 */
export async function processOnchainJobsBatch(
  env: Env,
  db: Queryable,
  chain: ChainReader,
  customExecutor?: VerifierTxExecutor,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{ processed: number; succeeded: number; failed: number }> {
  // Recover any stale `processing` jobs older than 5 minutes
  await db.query(
    `UPDATE public.onchain_jobs
        SET status = 'pending', updated_at = now()
      WHERE status = 'processing' AND updated_at < now() - interval '5 minutes'`,
  )

  const claimed = await withTx(db, async (tx) => {
    const res = await tx.query<{
      id: string | number
      kind: 'set_verification' | 'revoke_verification'
      payload: Record<string, unknown> | string
      attempts: number
    }>(
      `UPDATE public.onchain_jobs
          SET status = 'processing', updated_at = now()
        WHERE id IN (
          SELECT id
            FROM public.onchain_jobs
           WHERE status = 'pending'
             AND run_after <= now()
             AND attempts < 10
           ORDER BY id ASC
           LIMIT 5
           FOR UPDATE SKIP LOCKED
        )
       RETURNING id, kind, payload, attempts`,
    )
    return res.rows
  })

  if (claimed.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 }
  }

  let executor = customExecutor
  let initError: unknown = null
  if (!executor) {
    try {
      const roles = await chain.getRoles()
      const clients = await createVerifierClients(env, roles)
      executor = {
        async setVerification(wallet, level, expiry) {
          const hash = await clients.walletClient.writeContract({
            address: clients.escrow,
            abi: p2pEscrowAbi,
            functionName: 'setVerification',
            args: [wallet, level, expiry],
          })
          const receipt = await clients.publicClient.waitForTransactionReceipt({ hash })
          if (receipt.status !== 'success') throw new Error('tx_reverted')
          return hash
        },
        async revokeVerification(wallet) {
          const hash = await clients.walletClient.writeContract({
            address: clients.escrow,
            abi: p2pEscrowAbi,
            functionName: 'revokeVerification',
            args: [wallet],
          })
          const receipt = await clients.publicClient.waitForTransactionReceipt({ hash })
          if (receipt.status !== 'success') throw new Error('tx_reverted')
          return hash
        },
      }
    } catch (err) {
      initError = err
    }
  }

  let succeeded = 0
  let failed = 0

  for (const job of claimed) {
    const jobId = Number(job.id)
    const payload =
      typeof job.payload === 'string' ? (JSON.parse(job.payload) as Record<string, unknown>) : job.payload
    const wallet = normalizeWallet(payload?.wallet)

    if (!wallet) {
      await db.query(
        `UPDATE public.onchain_jobs SET status = 'failed', last_error = 'invalid_wallet', updated_at = now() WHERE id = $1`,
        [jobId],
      )
      failed++
      continue
    }

    if (initError || !executor) {
      const nextAttempts = Number(job.attempts) + 1
      const delaySec = Math.min(3600, 30 * 2 ** Math.min(nextAttempts, 7))
      await db.query(
        `UPDATE public.onchain_jobs
            SET status = CASE WHEN $2 >= 10 THEN 'failed' ELSE 'pending' END,
                attempts = $2,
                last_error = $3,
                run_after = now() + make_interval(secs => $4),
                updated_at = now()
          WHERE id = $1`,
        [jobId, nextAttempts, sanitizeJobError(initError), delaySec],
      )
      failed++
      continue
    }

    try {
      if (job.kind === 'set_verification') {
        const level = Number(payload.level ?? 1)
        const expiry = BigInt(Math.trunc(Number(payload.expiry ?? 0)))
        if (level < 1 || level > 2 || expiry <= BigInt(nowSec + 30)) {
          await db.query(
            `UPDATE public.onchain_jobs SET status = 'failed', last_error = 'expired_target', updated_at = now() WHERE id = $1`,
            [jobId],
          )
          failed++
          continue
        }
        const txHash = await executor.setVerification(wallet, level, expiry)
        await db.query(
          `UPDATE public.onchain_jobs
              SET status = 'done', tx_hash = $2, last_error = NULL, updated_at = now()
            WHERE id = $1`,
          [jobId, txHash],
        )
        await writeAudit(db, 'verifier_relayer', 'verifier.set_verification', wallet)
        succeeded++
      } else {
        const currentlyVerified = await chain.isVerified(wallet)
        if (!currentlyVerified) {
          await db.query(
            `UPDATE public.onchain_jobs
                SET status = 'done', last_error = 'already_unverified', updated_at = now()
              WHERE id = $1`,
            [jobId],
          )
          succeeded++
          continue
        }
        const txHash = await executor.revokeVerification(wallet)
        await db.query(
          `UPDATE public.onchain_jobs
              SET status = 'done', tx_hash = $2, last_error = NULL, updated_at = now()
            WHERE id = $1`,
          [jobId, txHash],
        )
        await writeAudit(db, 'verifier_relayer', 'verifier.revoke_verification', wallet)
        succeeded++
      }
    } catch (err) {
      const nextAttempts = Number(job.attempts) + 1
      const delaySec = Math.min(3600, 30 * 2 ** Math.min(nextAttempts, 7))
      await db.query(
        `UPDATE public.onchain_jobs
            SET status = CASE WHEN $2 >= 10 THEN 'failed' ELSE 'pending' END,
                attempts = $2,
                last_error = $3,
                run_after = now() + make_interval(secs => $4),
                updated_at = now()
          WHERE id = $1`,
        [jobId, nextAttempts, sanitizeJobError(err), delaySec],
      )
      failed++
    }
  }

  return { processed: claimed.length, succeeded, failed }
}

/**
 * Verify Didit webhook headers + signature:
 * 1. Reject if `abs(nowSec - X-Timestamp) > 300`
 * 2. Verify `X-Signature-V2` (HMAC-SHA256 over canonical JSON) in constant time
 * 3. Fall back to `X-Signature` over raw body ONLY if `X-Signature-V2` was absent or unverified AND `X-Signature` is present
 * 4. NEVER accept `X-Signature-Simple` alone
 */
export async function verifyDiditWebhookRequest(params: {
  secret: string
  rawBodyBytes: Uint8Array
  parsedJson: unknown
  signatureV2Header: string | null
  signatureV1Header: string | null
  timestampHeader: string | null
  nowSec?: number
}): Promise<{ ok: true } | { ok: false; reason: 'invalid_timestamp' | 'invalid_signature' }> {
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000)
  const tsRaw = params.timestampHeader?.trim() ?? ''
  if (!/^\d{9,12}$/.test(tsRaw)) {
    return { ok: false, reason: 'invalid_timestamp' }
  }
  const ts = Number.parseInt(tsRaw, 10)
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > WEBHOOK_MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'invalid_timestamp' }
  }

  const sigV2 = params.signatureV2Header?.trim() ?? ''
  const sigV1 = params.signatureV1Header?.trim() ?? ''
  if (!sigV2 && !sigV1) {
    // Reject missing signatures and reject requests carrying only X-Signature-Simple
    return { ok: false, reason: 'invalid_signature' }
  }

  if (sigV2) {
    try {
      const canonical = canonicalizeDiditJson(params.parsedJson)
      if (await verifyHmacSha256Hex(params.secret, canonical, sigV2)) {
        return { ok: true }
      }
    } catch {
      /* fall through to raw-body X-Signature only if X-Signature is explicitly provided */
    }
  }

  if (sigV1) {
    if (await verifyHmacSha256Hex(params.secret, params.rawBodyBytes, sigV1)) {
      return { ok: true }
    }
  }

  return { ok: false, reason: 'invalid_signature' }
}

/**
 * Handle `/api/kyc/*`:
 * - `GET  /api/kyc/status`
 * - `POST /api/kyc/start`
 * - `POST /api/kyc/webhook`
 */
export async function handleKycRoutes(
  req: Request,
  env: Env,
  ctx: WorkerExecutionContext,
  db: Queryable,
  chain: ChainReader,
  subpath: string,
  opts?: {
    createDiditSession?: DiditSessionCreator
    verifierExecutor?: VerifierTxExecutor
    nowSec?: number
    runJobsInBackground?: (env: Env) => Promise<unknown>
  },
): Promise<Response | null> {
  const ip = clientIp(req)
  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000)
  const sandboxMode = isDiditSandbox(env)

  // ---- 1. Unauthenticated HMAC-verified Didit Webhook (`POST /api/kyc/webhook`) ----
  if (req.method === 'POST' && subpath === '/kyc/webhook') {
    if (!(await checkRateLimit(db, `rl:kyc:wh:${ip}`, 120, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const webhookSecret = env.DIDIT_WEBHOOK_SECRET?.trim()
    if (!webhookSecret) {
      return json(503, { error: 'service_unavailable' })
    }

    const buf = await req.arrayBuffer()
    if (buf.byteLength === 0 || buf.byteLength > 524_288) {
      return json(400, { error: 'bad_payload' })
    }
    const rawBytes = new Uint8Array(buf)
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBytes))
    } catch {
      return json(400, { error: 'bad_payload' })
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json(400, { error: 'bad_payload' })
    }

    const sigCheck = await verifyDiditWebhookRequest({
      secret: webhookSecret,
      rawBodyBytes: rawBytes,
      parsedJson: parsed,
      signatureV2Header: req.headers.get('x-signature-v2'),
      signatureV1Header: req.headers.get('x-signature'),
      timestampHeader: req.headers.get('x-timestamp'),
      nowSec,
    })
    if (!sigCheck.ok) {
      return json(401, { error: sigCheck.reason })
    }

    const payload = parsed as Record<string, unknown>
    const eventId = textField(payload.event_id, 128)
    const sessionId = textField(payload.session_id, 128)
    const webhookType = textField(payload.webhook_type, 64) ?? 'status.updated'
    const statusRaw = textField(payload.status, 64) ?? ''
    const vendorWallet = normalizeWallet(payload.vendor_data)

    if (!eventId || !sessionId) {
      return json(400, { error: 'bad_payload' })
    }

    // Resolve wallet strictly from an existing kyc_sessions row (M2: ignore unknown sessions)
    const sessRes = await db.query<{ wallet: string; sandbox_scenario: string | null }>(
      `SELECT wallet, sandbox_scenario FROM public.kyc_sessions WHERE didit_session_id = $1 LIMIT 1`,
      [sessionId],
    )
    const sessionRow = sessRes.rows[0]
    const sessionWallet = sessionRow ? normalizeWallet(sessionRow.wallet) : null
    if (!sessionWallet) {
      return json(200, { ok: true, ignored: true })
    }
    if (vendorWallet && sessionWallet !== vendorWallet) {
      await writeAudit(db, 'didit_webhook', 'kyc.vendor_mismatch', sessionId)
      return json(400, { error: 'vendor_mismatch' })
    }
    const wallet = sessionWallet

    const statusLower = statusRaw.toLowerCase()
    let queuedOnchainJob = false

    // Atomic dedupe + state transition in ONE transaction (H2):
    // if any state write fails, Postgres rolls back the webhook_events insert too and returns 500 so Didit retries.
    const txOutcome = await withTx(db, async (tx): Promise<'duplicate' | 'ignored' | 'processed'> => {
      const dedup = await tx.query(
        `INSERT INTO public.webhook_events (event_id, session_id, webhook_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId, sessionId, webhookType],
      )
      if ((dedup.rowCount ?? 0) === 0) {
        return 'duplicate'
      }

      if (webhookType !== 'status.updated') {
        return 'ignored'
      }

      if (statusLower === 'approved') {
        const expirySec = nowSec + KYC_VALIDITY_SECONDS
        const expiryIso = new Date(expirySec * 1000).toISOString()
        const extractedName =
          extractDecisionName(payload) ?? (sandboxMode ? 'Sandbox Test User' : null)
        const nameEnc = extractedName ? await sealText(env, extractedName, kycNameAad(wallet)) : null

        await tx.query(
          `INSERT INTO public.accounts (wallet, kyc_status, kyc_level, kyc_expires_at, kyc_name_enc, approved_session_id, consent_at)
           VALUES ($1, 'approved', 1, $2::timestamptz, $3, $4, now())
           ON CONFLICT (wallet) DO UPDATE
             SET kyc_status = 'approved',
                 kyc_level = 1,
                 kyc_expires_at = $2::timestamptz,
                 kyc_name_enc = COALESCE($3, public.accounts.kyc_name_enc),
                 approved_session_id = $4`,
          [wallet, expiryIso, nameEnc, sessionId],
        )
        await tx.query(
          `UPDATE public.kyc_sessions
              SET status = $2, decided_at = now()
            WHERE didit_session_id = $1`,
          [sessionId, statusRaw],
        )
        await tx.query(
          `INSERT INTO public.onchain_jobs (kind, payload, status, run_after)
           VALUES ('set_verification', $1::jsonb, 'pending', now())`,
          [JSON.stringify({ wallet, level: 1, expiry: expirySec, sessionId })],
        )
        await tx.query(
          `INSERT INTO public.notifications_outbox (dedupe_key, wallet, event, status)
           VALUES ($1, $2, 'kyc_approved', 'pending')
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [`kyc:${eventId}`, wallet],
        )
        await writeAudit(tx, 'didit_webhook', 'kyc.approved', wallet)
        queuedOnchainJob = true
      } else if (statusLower === 'abandoned') {
        // M1: Never treat abandoned as declined or revoke an existing approval
        await tx.query(
          `UPDATE public.kyc_sessions
              SET status = $2, decided_at = now()
            WHERE didit_session_id = $1`,
          [sessionId, statusRaw],
        )
        await writeAudit(tx, 'didit_webhook', 'kyc.abandoned', sessionId)
      } else if (statusLower === 'declined' || statusLower === 'expired') {
        const nextStatus = statusLower === 'expired' ? 'expired' : 'declined'
        const prevAcc = await tx.query<{
          kyc_status: string
          kyc_level: number
          approved_session_id: string | null
        }>(
          `SELECT kyc_status, kyc_level, approved_session_id FROM public.accounts WHERE wallet = $1 LIMIT 1`,
          [wallet],
        )
        const prev = prevAcc.rows[0]
        const wasApproved = prev?.kyc_status === 'approved' || Number(prev?.kyc_level ?? 0) > 0
        const ownsCurrentApproval = prev?.approved_session_id === sessionId

        await tx.query(
          `UPDATE public.kyc_sessions
              SET status = $2, decided_at = now()
            WHERE didit_session_id = $1`,
          [sessionId, statusRaw],
        )

        // M1: Only revoke/flip an already-approved account if this event belongs to the session that produced the approval
        if (!wasApproved || ownsCurrentApproval) {
          await tx.query(
            `INSERT INTO public.accounts (wallet, kyc_status, kyc_level, kyc_expires_at, approved_session_id)
             VALUES ($1, $2, 0, NULL, NULL)
             ON CONFLICT (wallet) DO UPDATE
               SET kyc_status = $2,
                   kyc_level = 0,
                   kyc_expires_at = NULL,
                   approved_session_id = NULL`,
            [wallet, nextStatus],
          )
          if (wasApproved && ownsCurrentApproval) {
            await tx.query(
              `INSERT INTO public.onchain_jobs (kind, payload, status, run_after)
               VALUES ('revoke_verification', $1::jsonb, 'pending', now())`,
              [JSON.stringify({ wallet, reason: nextStatus, sessionId })],
            )
            queuedOnchainJob = true
          }
          await tx.query(
            `INSERT INTO public.notifications_outbox (dedupe_key, wallet, event, status)
             VALUES ($1, $2, 'kyc_declined', 'pending')
             ON CONFLICT (dedupe_key) DO NOTHING`,
            [`kyc:${eventId}`, wallet],
          )
          await writeAudit(tx, 'didit_webhook', `kyc.${nextStatus}`, wallet)
        } else {
          await writeAudit(tx, 'didit_webhook', `kyc.${nextStatus}_ignored_stale_session`, sessionId)
        }
      } else {
        const inReview = statusLower.includes('review')
        await tx.query(
          `UPDATE public.kyc_sessions SET status = $2 WHERE didit_session_id = $1`,
          [sessionId, statusRaw],
        )
        if (inReview) {
          await tx.query(
            `UPDATE public.accounts
                SET kyc_status = 'in_review'
              WHERE wallet = $1 AND kyc_status NOT IN ('approved')`,
            [wallet],
          )
        }
      }

      return 'processed'
    })

    if (txOutcome === 'duplicate') {
      return json(200, { ok: true, duplicate: true })
    }
    if (txOutcome === 'ignored') {
      return json(200, { ok: true, ignored: true })
    }

    // Return 200 within <5s and execute onchain verifier tx asynchronously in ctx.waitUntil
    if (queuedOnchainJob) {
      const bgRunner =
        opts?.runJobsInBackground ??
        ((bgEnv: Env) =>
          withDb(bgEnv, (bgDb) =>
            processOnchainJobsBatch(bgEnv, bgDb, createChainReader(bgEnv), opts?.verifierExecutor, nowSec),
          ))
      ctx.waitUntil(bgRunner(env).catch(() => undefined))
    }

    return json(200, { ok: true })
  }

  // ---- Authenticated KYC endpoints ----
  if (subpath !== '/kyc/status' && subpath !== '/kyc/start') {
    return null
  }

  const auth = await requireSession(req, db)
  if (!auth.ok) return auth.response
  const wallet = auth.session.wallet

  if (req.method === 'GET' && subpath === '/kyc/status') {
    if (!(await checkRateLimit(db, `rl:kyc:status:${wallet}`, 60, 60))) {
      return json(429, { error: 'rate_limited' })
    }
    const [accRes, sessRes, jobRes, onchainVerified] = await Promise.all([
      db.query<{
        kyc_status: string
        kyc_level: number
        kyc_expires_at: string | Date | null
        consent_at: string | Date | null
      }>(
        `SELECT kyc_status, kyc_level, kyc_expires_at, consent_at
           FROM public.accounts
          WHERE wallet = $1 AND deleted_at IS NULL
          LIMIT 1`,
        [wallet],
      ),
      db.query<{
        didit_session_id: string
        status: string
        sandbox_scenario: string | null
        created_at: string | Date
        decided_at: string | Date | null
      }>(
        `SELECT didit_session_id, status, sandbox_scenario, created_at, decided_at
           FROM public.kyc_sessions
          WHERE wallet = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [wallet],
      ),
      db.query<{
        kind: string
        status: string
        attempts: number
        tx_hash: string | null
        last_error: string | null
      }>(
        `SELECT kind, status, attempts, tx_hash, last_error
           FROM public.onchain_jobs
          WHERE payload->>'wallet' = $1
          ORDER BY id DESC
          LIMIT 1`,
        [wallet],
      ),
      chain.isVerified(wallet).catch(() => false),
    ])

    const acc = accRes.rows[0]
    const sess = sessRes.rows[0]
    const job = jobRes.rows[0]

    return json(200, {
      mode: sandboxMode ? 'sandbox' : 'live',
      scenarios: sandboxMode ? SANDBOX_SCENARIOS : [],
      hasConsent: !!acc?.consent_at,
      kycStatus: acc?.kyc_status ?? 'none',
      kycLevel: Number(acc?.kyc_level ?? 0),
      kycExpiresAt: acc?.kyc_expires_at ? new Date(acc.kyc_expires_at).toISOString() : null,
      onchainVerified,
      latestSession: sess
        ? {
            sessionId: sess.didit_session_id,
            status: sess.status,
            sandboxScenario: sandboxMode ? sess.sandbox_scenario : null,
            createdAt: new Date(sess.created_at).toISOString(),
            decidedAt: sess.decided_at ? new Date(sess.decided_at).toISOString() : null,
          }
        : null,
      latestJob: job
        ? {
            kind: job.kind,
            status: job.status,
            attempts: Number(job.attempts),
            txHash: job.tx_hash,
            lastError: job.last_error,
          }
        : null,
    })
  }

  if (req.method === 'POST' && subpath === '/kyc/start') {
    if (!(await checkRateLimit(db, `rl:kyc:start:${wallet}`, 5, 300))) {
      return json(429, { error: 'rate_limited' })
    }
    const apiKey = env.DIDIT_API_KEY?.trim()
    const workflowId = env.DIDIT_WORKFLOW_ID?.trim()
    if (!apiKey || !workflowId) {
      return json(503, { error: 'kyc_not_configured' })
    }

    const body = (await readJsonBody(req, 4_096)) ?? {}

    // Ensure user has given explicit privacy + Didit consent (accepting inline `consent: true` or existing `consent_at`)
    const accRes = await db.query<{ consent_at: string | Date | null; kyc_status: string }>(
      `SELECT consent_at, kyc_status FROM public.accounts WHERE wallet = $1 AND deleted_at IS NULL LIMIT 1`,
      [wallet],
    )
    const hasConsent = !!accRes.rows[0]?.consent_at || body.consent === true
    if (!hasConsent) {
      return json(400, { error: 'consent_required' })
    }

    let sandboxScenario: string | undefined
    if (body.sandboxScenario !== undefined && body.sandboxScenario !== null && body.sandboxScenario !== '') {
      if (!sandboxMode) {
        return json(400, { error: 'sandbox_disabled' })
      }
      if (typeof body.sandboxScenario !== 'string' || !ALLOWED_SCENARIO_RE.test(body.sandboxScenario.trim())) {
        return json(400, { error: 'invalid_sandbox_scenario' })
      }
      sandboxScenario = body.sandboxScenario.trim()
    }

    const reqUrl = new URL(req.url)
    const origin = publicAppOrigin(env, reqUrl)
    const callbackUrl = `${origin}/p2p?kyc_return=1`

    const creator = opts?.createDiditSession ?? defaultDiditSessionCreator
    let created: { sessionId: string; url: string; status: string }
    try {
      created = await creator({
        apiKey,
        workflowId,
        wallet,
        callbackUrl,
        sandboxScenario,
      })
    } catch {
      return json(502, { error: 'kyc_provider_error' })
    }

    await withTx(db, async (tx) => {
      await tx.query(
        `INSERT INTO public.accounts (wallet, kyc_status, consent_at)
         VALUES ($1, 'pending', now())
         ON CONFLICT (wallet) DO UPDATE
           SET kyc_status = CASE
                 WHEN public.accounts.kyc_status = 'approved' THEN 'approved'
                 ELSE 'pending'
               END,
               consent_at = COALESCE(public.accounts.consent_at, now()),
               deleted_at = NULL`,
        [wallet],
      )
      await tx.query(
        `INSERT INTO public.kyc_sessions (wallet, didit_session_id, status, sandbox_scenario)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (didit_session_id) DO UPDATE
           SET status = EXCLUDED.status`,
        [wallet, created.sessionId, created.status, sandboxScenario ?? null],
      )
      await writeAudit(tx, wallet, 'kyc.session_started', created.sessionId)
    })

    return json(200, {
      sessionId: created.sessionId,
      url: created.url,
      status: created.status,
      mode: sandboxMode ? 'sandbox' : 'live',
      sandboxScenario: sandboxScenario ?? null,
    })
  }

  return null
}
