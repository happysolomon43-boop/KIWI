-- KIWI AI Resilience Delivery B1-B2
-- Durable Reckoning preparation ownership. A stale worker must never persist
-- progress or activation after another worker has reclaimed the same Reckoning.

ALTER TABLE public.reckoning_sessions
  ADD COLUMN IF NOT EXISTS preparation_claim_id text,
  ADD COLUMN IF NOT EXISTS preparation_claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS preparation_heartbeat_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_reckoning_sessions_preparation_claim
  ON public.reckoning_sessions (generation_status, preparation_claim_expires_at)
  WHERE engine_version = 2
    AND generation_status = 'pending'
    AND exam_session_id IS NULL;

COMMENT ON COLUMN public.reckoning_sessions.preparation_claim_id IS
  'Opaque backend ownership token for the one active Reckoning V2 preparation worker.';
COMMENT ON COLUMN public.reckoning_sessions.preparation_claim_expires_at IS
  'Lease expiry after which another backend worker may reclaim an abandoned preparation.';
COMMENT ON COLUMN public.reckoning_sessions.preparation_heartbeat_at IS
  'Last successful heartbeat from the worker currently owning preparation_claim_id.';
