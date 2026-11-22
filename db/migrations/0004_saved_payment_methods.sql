-- OnPeer: Add encrypted saved payment methods column on public.accounts
-- AES-256-GCM envelope ciphertext bound to AAD `account:pm:<wallet>`.
-- Scrubbed on DELETE /api/account alongside email_enc and kyc_name_enc.

BEGIN;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS payment_methods_enc text;

COMMIT;
