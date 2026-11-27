-- OnPeer Admin Analytics: Transactions & Daily Visits (Global + Country-wise)
-- Run once in the Supabase SQL Editor as postgres.

BEGIN;

CREATE TABLE IF NOT EXISTS public.analytics_txs (
  id              bigserial PRIMARY KEY,
  tx_hash         text CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  kind            text NOT NULL CHECK (kind IN ('p2p', 'swap', 'bridge')),
  action          text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 48),
  wallet          text NOT NULL CHECK (wallet = lower(wallet) AND wallet ~ '^0x[0-9a-f]{40}$'),
  chain           text NOT NULL CHECK (char_length(chain) BETWEEN 1 AND 32),
  token           text NOT NULL CHECK (char_length(token) BETWEEN 1 AND 16),
  amount_usd      numeric(20, 6) NOT NULL DEFAULT 0 CHECK (amount_usd >= 0),
  network_fee_usd numeric(20, 8) NOT NULL DEFAULT 0 CHECK (network_fee_usd >= 0),
  status          text NOT NULL CHECK (status IN ('success', 'failed')),
  country         text NOT NULL DEFAULT 'XX' CHECK (country ~ '^[A-Z]{2}$'),
  meta_enc        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_txs_hash_unique
  ON public.analytics_txs (tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_txs_created_at
  ON public.analytics_txs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_txs_country_created
  ON public.analytics_txs (country, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_txs_wallet_created
  ON public.analytics_txs (wallet, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_txs_chain
  ON public.analytics_txs (chain);

CREATE TABLE IF NOT EXISTS public.analytics_daily_visits (
  day             date NOT NULL,
  country         text NOT NULL DEFAULT 'XX' CHECK (country ~ '^[A-Z]{2}$'),
  route           text NOT NULL DEFAULT 'home' CHECK (char_length(route) BETWEEN 1 AND 24),
  visits          integer NOT NULL DEFAULT 0 CHECK (visits >= 0),
  unique_visitors integer NOT NULL DEFAULT 0 CHECK (unique_visitors >= 0),
  PRIMARY KEY (day, country, route)
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_visits_country_day
  ON public.analytics_daily_visits (country, day DESC);

ALTER TABLE public.analytics_txs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_daily_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onpeer_worker_all_analytics_txs ON public.analytics_txs;
CREATE POLICY onpeer_worker_all_analytics_txs
  ON public.analytics_txs
  FOR ALL
  TO onpeer_worker
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS onpeer_worker_all_analytics_daily_visits ON public.analytics_daily_visits;
CREATE POLICY onpeer_worker_all_analytics_daily_visits
  ON public.analytics_daily_visits
  FOR ALL
  TO onpeer_worker
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.analytics_txs TO onpeer_worker;
GRANT USAGE, SELECT ON SEQUENCE public.analytics_txs_id_seq TO onpeer_worker;
GRANT SELECT, INSERT, UPDATE ON public.analytics_daily_visits TO onpeer_worker;

COMMIT;
