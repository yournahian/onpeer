-- OnPeer: P2P Full Audit Hardening (Migration 0007)
-- 1. Enforce partial UNIQUE index on `accounts.telegram_id_hash` (H-05) after clearing any stale duplicates
-- 2. Add partial index on `notifications_outbox (status, created_at)` including `'skipped'` for cron sweep (M-06)
-- 3. Add partial index on `vault_blobs (order_id, kind)` for fast per-order payer/evidence cap & AAD lookups (H-03, M-03)

BEGIN;

-- Clear older duplicate telegram_id_hash rows if any exist before enforcing uniqueness
WITH ranked AS (
  SELECT wallet,
         ROW_NUMBER() OVER (
           PARTITION BY telegram_id_hash
           ORDER BY telegram_linked_at DESC NULLS LAST, created_at DESC NULLS LAST, wallet ASC
         ) AS rn
    FROM public.accounts
   WHERE telegram_id_hash IS NOT NULL
     AND deleted_at IS NULL
)
UPDATE public.accounts a
   SET telegram_chat_id_enc = NULL,
       telegram_username_enc = NULL,
       telegram_id_hash = NULL,
       telegram_linked_at = NULL,
       telegram_opt_in = false
  FROM ranked r
 WHERE a.wallet = r.wallet
   AND r.rn > 1;

DROP INDEX IF EXISTS public.idx_accounts_telegram_id_hash;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_telegram_id_hash
  ON public.accounts (telegram_id_hash)
  WHERE telegram_id_hash IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_outbox_cleanup
  ON public.notifications_outbox (status, created_at)
  WHERE status IN ('sent', 'failed', 'skipped');

CREATE INDEX IF NOT EXISTS idx_vault_blobs_order_kind
  ON public.vault_blobs (order_id, kind)
  WHERE order_id IS NOT NULL;

COMMIT;
