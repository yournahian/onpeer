-- OnPeer: Telegram Mini App & Live Order Notification Bot linkage on public.accounts
-- - `telegram_chat_id_enc`: AES-256-GCM envelope ciphertext bound to AAD `account:tg:<wallet>`
-- - `telegram_username_enc`: AES-256-GCM envelope ciphertext bound to AAD `account:tg_user:<wallet>`
-- - `telegram_id_hash`: keyed HMAC-SHA256 digest (`SESSION_SECRET`) for O(1) bot command lookup (/stop, /mute, /unlink)
--   without storing plaintext Telegram IDs in PostgreSQL.
-- All columns are scrubbed on `DELETE /api/account` or `DELETE /api/telegram/link`.

BEGIN;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS telegram_chat_id_enc text,
  ADD COLUMN IF NOT EXISTS telegram_username_enc text,
  ADD COLUMN IF NOT EXISTS telegram_id_hash text,
  ADD COLUMN IF NOT EXISTS telegram_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS telegram_opt_in boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_accounts_telegram_id_hash
  ON public.accounts (telegram_id_hash)
  WHERE telegram_id_hash IS NOT NULL AND deleted_at IS NULL;

COMMIT;
