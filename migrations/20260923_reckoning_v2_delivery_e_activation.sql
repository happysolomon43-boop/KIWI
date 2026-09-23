-- Reckoning V2 Delivery E: persisted checkpoint/final-report UX state.
-- Additive and backward-compatible. Legacy rows remain unaffected.

ALTER TABLE public.reckoning_sessions
  ADD COLUMN IF NOT EXISTS checkpoint_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkpoint_next_question_id text,
  ADD COLUMN IF NOT EXISTS final_report jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reckoning_sessions_checkpoint_consistency_ck'
  ) THEN
    ALTER TABLE public.reckoning_sessions
      ADD CONSTRAINT reckoning_sessions_checkpoint_consistency_ck
      CHECK (
        checkpoint_pending = true
        OR checkpoint_next_question_id IS NULL
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reckoning_sessions_checkpoint_pending
  ON public.reckoning_sessions (user_id, checkpoint_pending)
  WHERE checkpoint_pending = true;

COMMENT ON COLUMN public.reckoning_sessions.checkpoint_pending IS
  'True when adaptive Reckoning is paused at a server-persisted block checkpoint.';
COMMENT ON COLUMN public.reckoning_sessions.checkpoint_next_question_id IS
  'Hidden next question unlocked only after the learner explicitly continues the checkpoint.';
COMMENT ON COLUMN public.reckoning_sessions.final_report IS
  'Persisted evidence-based Reckoning diagnostic result for the final learner report.';
