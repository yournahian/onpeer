-- OnPeer: P2P Post-Trade Feedback + Rating & Trader Follow/Block Relations
-- Protected with RLS and restricted strictly to `onpeer_worker`.

BEGIN;

CREATE TABLE IF NOT EXISTS public.p2p_feedback (
  id          bigserial PRIMARY KEY,
  order_id    bigint NOT NULL,
  from_wallet text NOT NULL CHECK (from_wallet = lower(from_wallet) AND from_wallet ~ '^0x[0-9a-f]{40}$'),
  to_wallet   text NOT NULL CHECK (to_wallet = lower(to_wallet) AND to_wallet ~ '^0x[0-9a-f]{40}$'),
  rating      smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  positive    boolean NOT NULL,
  comment     text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 280),
  anonymous   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, from_wallet),
  CHECK (from_wallet <> to_wallet)
);

CREATE INDEX IF NOT EXISTS idx_p2p_feedback_to_wallet
  ON public.p2p_feedback (to_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_p2p_feedback_order_id
  ON public.p2p_feedback (order_id);

CREATE TABLE IF NOT EXISTS public.p2p_relations (
  actor      text NOT NULL CHECK (actor = lower(actor) AND actor ~ '^0x[0-9a-f]{40}$'),
  target     text NOT NULL CHECK (target = lower(target) AND target ~ '^0x[0-9a-f]{40}$'),
  kind       text NOT NULL CHECK (kind IN ('follow', 'block')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor, target, kind),
  CHECK (actor <> target)
);

CREATE INDEX IF NOT EXISTS idx_p2p_relations_target
  ON public.p2p_relations (target, kind);
CREATE INDEX IF NOT EXISTS idx_p2p_relations_actor
  ON public.p2p_relations (actor, kind);

ALTER TABLE public.p2p_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_relations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.p2p_feedback, public.p2p_relations FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.p2p_feedback, public.p2p_relations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.p2p_feedback, public.p2p_relations FROM authenticated;
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.p2p_feedback, public.p2p_relations TO onpeer_worker;
GRANT USAGE, SELECT ON SEQUENCE public.p2p_feedback_id_seq TO onpeer_worker;

DROP POLICY IF EXISTS worker_all ON public.p2p_feedback;
CREATE POLICY worker_all ON public.p2p_feedback FOR ALL TO onpeer_worker USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS worker_all ON public.p2p_relations;
CREATE POLICY worker_all ON public.p2p_relations FOR ALL TO onpeer_worker USING (true) WITH CHECK (true);

COMMIT;
