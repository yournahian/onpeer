-- OnPeer Phase 2: Initial PostgreSQL Schema for Supabase + Cloudflare Hyperdrive
-- Run once in the Supabase SQL Editor (as postgres), then set the password for `onpeer_worker`
-- separately with: ALTER ROLE onpeer_worker WITH LOGIN PASSWORD '<strong-random-password>';
-- Never commit credentials to the repository.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Least-privilege Worker role (no superuser, no createdb, no createrole, no replication)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onpeer_worker') THEN
    CREATE ROLE onpeer_worker NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;
END
$$;

-- 2. Tables

CREATE TABLE IF NOT EXISTS public.accounts (
  wallet            text PRIMARY KEY CHECK (wallet = lower(wallet) AND wallet ~ '^0x[0-9a-f]{40}$'),
  display_name      text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 64),
  country           text CHECK (country IS NULL OR char_length(country) BETWEEN 2 AND 3),
  email_enc         text,
  email_verified_at timestamptz,
  email_opt_in      boolean NOT NULL DEFAULT false,
  kyc_status        text NOT NULL DEFAULT 'none'
                      CHECK (kyc_status IN ('none', 'pending', 'in_review', 'approved', 'declined', 'expired', 'revoked')),
  kyc_level         smallint NOT NULL DEFAULT 0 CHECK (kyc_level >= 0 AND kyc_level <= 2),
  kyc_expires_at      timestamptz,
  kyc_name_enc        text,
  approved_session_id text,
  consent_at          timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_accounts_kyc_expiry
  ON public.accounts (kyc_expires_at)
  WHERE kyc_status = 'approved' AND kyc_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sessions (
  token_hash text PRIMARY KEY CHECK (char_length(token_hash) = 64),
  wallet     text NOT NULL CHECK (wallet = lower(wallet) AND wallet ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sessions_wallet ON public.sessions (wallet);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions (expires_at);

CREATE TABLE IF NOT EXISTS public.kyc_sessions (
  id               bigserial PRIMARY KEY,
  wallet           text NOT NULL CHECK (wallet = lower(wallet) AND wallet ~ '^0x[0-9a-f]{40}$'),
  didit_session_id text NOT NULL UNIQUE,
  status           text NOT NULL,
  sandbox_scenario text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_kyc_sessions_wallet_created
  ON public.kyc_sessions (wallet, created_at DESC);

CREATE TABLE IF NOT EXISTS public.webhook_events (
  event_id     text PRIMARY KEY,
  session_id   text NOT NULL,
  webhook_type text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_delete_after
  ON public.webhook_events (delete_after);

CREATE TABLE IF NOT EXISTS public.onchain_jobs (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('set_verification', 'revoke_verification')),
  payload    jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts   integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  tx_hash    text,
  last_error text,
  run_after  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onchain_jobs_due
  ON public.onchain_jobs (status, run_after)
  WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS public.vault_blobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('ad_details', 'order_details', 'payer', 'evidence')),
  ad_id        bigint,
  order_id     bigint,
  author       text NOT NULL CHECK (author = lower(author) AND author ~ '^0x[0-9a-f]{40}$'),
  mime_type    text CHECK (mime_type IS NULL OR char_length(mime_type) <= 100),
  ciphertext   bytea NOT NULL,
  wrapped_key  bytea NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^0x[0-9a-f]{64}$'),
  size         integer NOT NULL CHECK (size > 0 AND size <= 1048576),
  created_at   timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz
);

CREATE INDEX IF NOT EXISTS idx_vault_blobs_content_hash ON public.vault_blobs (content_hash);
CREATE INDEX IF NOT EXISTS idx_vault_blobs_ad_id ON public.vault_blobs (ad_id) WHERE ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vault_blobs_order_id ON public.vault_blobs (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vault_blobs_delete_after ON public.vault_blobs (delete_after) WHERE delete_after IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id               bigserial PRIMARY KEY,
  order_id         bigint NOT NULL,
  author           text NOT NULL CHECK (author = lower(author) AND author ~ '^0x[0-9a-f]{40}$'),
  body_enc         text NOT NULL,
  evidence_blob_id uuid REFERENCES public.vault_blobs (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  delete_after     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_order_id ON public.chat_messages (order_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_evidence_blob_id ON public.chat_messages (evidence_blob_id) WHERE evidence_blob_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_delete_after ON public.chat_messages (delete_after) WHERE delete_after IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dispute_filings (
  id                bigserial PRIMARY KEY,
  order_id          bigint NOT NULL,
  filed_by          text NOT NULL CHECK (filed_by = lower(filed_by) AND filed_by ~ '^0x[0-9a-f]{40}$'),
  reason_code       text NOT NULL CHECK (char_length(reason_code) BETWEEN 1 AND 64),
  text_enc          text NOT NULL,
  evidence_blob_ids uuid[] NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'taken', 'resolved', 'settled', 'closed')),
  filed_at          timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  delete_after      timestamptz,
  UNIQUE (order_id, filed_by)
);

CREATE INDEX IF NOT EXISTS idx_dispute_filings_status_filed
  ON public.dispute_filings (status, filed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispute_filings_order_id
  ON public.dispute_filings (order_id);
CREATE INDEX IF NOT EXISTS idx_dispute_filings_delete_after
  ON public.dispute_filings (delete_after) WHERE delete_after IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notifications_outbox (
  id         bigserial PRIMARY KEY,
  dedupe_key text UNIQUE,
  wallet     text NOT NULL CHECK (wallet = lower(wallet) AND wallet ~ '^0x[0-9a-f]{40}$'),
  event      text NOT NULL CHECK (char_length(event) BETWEEN 1 AND 64),
  order_id   bigint,
  ad_id      bigint,
  status     text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed')),
  attempts   integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  claimed_at timestamptz,
  send_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_outbox_due
  ON public.notifications_outbox (status, send_after)
  WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS public.chain_cursor (
  name       text PRIMARY KEY,
  last_block bigint NOT NULL CHECK (last_block >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id      bigserial PRIMARY KEY,
  actor   text NOT NULL CHECK (char_length(actor) BETWEEN 1 AND 80),
  action  text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  subject text CHECK (subject IS NULL OR char_length(subject) <= 120),
  at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_at ON public.audit_log (at DESC);

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket   text PRIMARY KEY CHECK (char_length(bucket) BETWEEN 1 AND 160),
  count    integer NOT NULL DEFAULT 1 CHECK (count >= 0),
  reset_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON public.rate_limits (reset_at);

CREATE TABLE IF NOT EXISTS public.cron_health (
  job_name      text PRIMARY KEY CHECK (char_length(job_name) BETWEEN 1 AND 64),
  last_run_at   timestamptz NOT NULL DEFAULT now(),
  last_ok_at    timestamptz,
  last_error    text CHECK (last_error IS NULL OR char_length(last_error) <= 120),
  last_error_at timestamptz
);

-- 3. Enable Row Level Security on EVERY table (default-deny for PostgREST / anon / authenticated)
DO $$
DECLARE
  tbl text;
  app_tables constant text[] := ARRAY[
    'accounts',
    'sessions',
    'kyc_sessions',
    'webhook_events',
    'onchain_jobs',
    'vault_blobs',
    'chat_messages',
    'dispute_filings',
    'notifications_outbox',
    'chain_cursor',
    'audit_log',
    'rate_limits',
    'cron_health'
  ];
BEGIN
  FOREACH tbl IN ARRAY app_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', tbl);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl);
    END IF;
  END LOOP;

  -- Schema-wide revokes + default privileges so existing and future objects in `public`
  -- are never exposed to PUBLIC, `anon`, or `authenticated`
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;
  END IF;
END
$$;

-- 4. Least-privilege grants for `onpeer_worker` (DML only; append-only on audit_log; ownership stays with postgres)
GRANT USAGE ON SCHEMA public TO onpeer_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.accounts,
  public.sessions,
  public.kyc_sessions,
  public.webhook_events,
  public.onchain_jobs,
  public.vault_blobs,
  public.chat_messages,
  public.dispute_filings,
  public.notifications_outbox,
  public.chain_cursor,
  public.rate_limits,
  public.cron_health
TO onpeer_worker;

-- audit_log is strictly append-only (no UPDATE, no DELETE)
GRANT SELECT, INSERT ON TABLE public.audit_log TO onpeer_worker;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO onpeer_worker;

-- Explicit RLS policies restricted strictly to `onpeer_worker` so ownership stays with `postgres`
-- while `anon`, `authenticated`, and PostgREST remain completely blocked (zero policies for them).
DO $$
DECLARE
  tbl text;
  rw_tables constant text[] := ARRAY[
    'accounts',
    'sessions',
    'kyc_sessions',
    'webhook_events',
    'onchain_jobs',
    'vault_blobs',
    'chat_messages',
    'dispute_filings',
    'notifications_outbox',
    'chain_cursor',
    'rate_limits',
    'cron_health'
  ];
BEGIN
  FOREACH tbl IN ARRAY rw_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS worker_all ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY worker_all ON public.%I FOR ALL TO onpeer_worker USING (true) WITH CHECK (true)',
      tbl
    );
  END LOOP;

  DROP POLICY IF EXISTS worker_select ON public.audit_log;
  DROP POLICY IF EXISTS worker_insert ON public.audit_log;
  CREATE POLICY worker_select ON public.audit_log FOR SELECT TO onpeer_worker USING (true);
  CREATE POLICY worker_insert ON public.audit_log FOR INSERT TO onpeer_worker WITH CHECK (true);
END
$$;

COMMIT;
