-- OnPeer Phase 2: Remove BYPASSRLS from onpeer_worker now that explicit RLS policies
-- (created in 0002_phase2_fixes.sql) cover all 13 tables in public.
-- Idempotent and wrapped in a transaction.

BEGIN;

ALTER ROLE onpeer_worker NOBYPASSRLS;

COMMIT;
