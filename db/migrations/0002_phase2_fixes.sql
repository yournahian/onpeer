-- OnPeer Phase 2 Fixes Migration (Review Batch 1: M1, M6, M8, L3)
-- 1. Add accounts.approved_session_id (M1)
-- 2. Add notifications_outbox.claimed_at (L3)
-- 3. Add cron_health table (M8)
-- 4. Restore ownership of all tables & sequences to `postgres` and grant explicit RLS policies to `onpeer_worker` (M6)

BEGIN;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS approved_session_id text;

ALTER TABLE public.notifications_outbox
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.cron_health (
  job_name      text PRIMARY KEY CHECK (char_length(job_name) BETWEEN 1 AND 64),
  last_run_at   timestamptz NOT NULL DEFAULT now(),
  last_ok_at    timestamptz,
  last_error    text CHECK (last_error IS NULL OR char_length(last_error) <= 120),
  last_error_at timestamptz
);

ALTER TABLE public.cron_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cron_health FROM PUBLIC;
REVOKE ALL ON TABLE public.cron_health FROM anon;
REVOKE ALL ON TABLE public.cron_health FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cron_health TO onpeer_worker;

DO $$
DECLARE
  tbl text;
  seq record;
  all_tables constant text[] := ARRAY[
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
  -- Ensure `postgres` can reclaim ownership from `onpeer_worker` on managed Supabase (Postgres 16+):
  -- `postgres` has ADMIN OPTION on `onpeer_worker` (as its creator), so granting membership temporarily
  -- lets `ALTER TABLE/SEQUENCE ... OWNER TO postgres` succeed without superuser privileges.
  GRANT onpeer_worker TO postgres;

  -- Restore ownership of every table and sequence to `postgres`
  FOREACH tbl IN ARRAY all_tables LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO postgres', tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;

  FOR seq IN
    SELECT c.relname AS seqname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S' AND n.nspname = 'public'
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO postgres', seq.seqname);
  END LOOP;

  REVOKE onpeer_worker FROM postgres;

  -- Explicit RLS policies for `onpeer_worker` only
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

-- Ensure audit_log remains strictly append-only for onpeer_worker
REVOKE UPDATE, DELETE ON TABLE public.audit_log FROM onpeer_worker;
GRANT SELECT, INSERT ON TABLE public.audit_log TO onpeer_worker;

COMMIT;
