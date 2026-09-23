-- Reckoning V2 Phase 2: persistent engine/evidence state.
--
-- This migration is intentionally additive and backward-compatible:
-- - existing Reckoning rows remain LEGACY engine rows;
-- - existing CBT/Reckoning question behavior is unchanged;
-- - no existing columns or constraints are removed;
-- - Reckoning V2 remains disabled at the application layer.

ALTER TABLE public.reckoning_sessions
  ADD COLUMN IF NOT EXISTS engine_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS engine_mode text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS engine_phase text,
  ADD COLUMN IF NOT EXISTS questions_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS soft_question_budget integer,
  ADD COLUMN IF NOT EXISTS hard_question_cap integer,
  ADD COLUMN IF NOT EXISTS recovery_score numeric,
  ADD COLUMN IF NOT EXISTS raw_accuracy numeric,
  ADD COLUMN IF NOT EXISTS unresolved_critical_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_block integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_question_id text,
  ADD COLUMN IF NOT EXISTS state_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prepared_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS safety_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS generation_error text,
  ADD COLUMN IF NOT EXISTS planner_version integer,
  ADD COLUMN IF NOT EXISTS config_version integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reckoning_sessions_engine_mode_ck'
  ) THEN
    ALTER TABLE public.reckoning_sessions
      ADD CONSTRAINT reckoning_sessions_engine_mode_ck
      CHECK (engine_mode IN ('LEGACY','SHADOW','PILOT','LIVE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reckoning_sessions_engine_phase_ck'
  ) THEN
    ALTER TABLE public.reckoning_sessions
      ADD CONSTRAINT reckoning_sessions_engine_phase_ck
      CHECK (
        engine_phase IS NULL
        OR engine_phase IN ('PREPARING','ACTIVE','FINALIZING','COMPLETE')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reckoning_sessions_generation_status_ck'
  ) THEN
    ALTER TABLE public.reckoning_sessions
      ADD CONSTRAINT reckoning_sessions_generation_status_ck
      CHECK (generation_status IN ('not_started','pending','ready','partial','error'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reckoning_sessions_v2_numeric_bounds_ck'
  ) THEN
    ALTER TABLE public.reckoning_sessions
      ADD CONSTRAINT reckoning_sessions_v2_numeric_bounds_ck
      CHECK (
        engine_version >= 1
        AND questions_used >= 0
        AND unresolved_critical_count >= 0
        AND current_block >= 0
        AND state_version >= 0
        AND (soft_question_budget IS NULL OR soft_question_budget > 0)
        AND (hard_question_cap IS NULL OR hard_question_cap > 0)
        AND (
          soft_question_budget IS NULL
          OR hard_question_cap IS NULL
          OR hard_question_cap >= soft_question_budget
        )
        AND (recovery_score IS NULL OR recovery_score BETWEEN 0 AND 100)
        AND (raw_accuracy IS NULL OR raw_accuracy BETWEEN 0 AND 100)
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.reckoning_evidence (
  id text PRIMARY KEY,
  reckoning_id text NOT NULL
    REFERENCES public.reckoning_sessions(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  subject_id text,
  source_card_id text
    REFERENCES public.cards(id) ON DELETE SET NULL,
  concept_key text NOT NULL,

  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_hash text,
  original_card_state text,

  risk_score numeric NOT NULL DEFAULT 0,
  risk_level text NOT NULL,
  risk_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,

  is_bubble_critical boolean NOT NULL DEFAULT false,
  has_learning_debt boolean NOT NULL DEFAULT false,
  discovered_by_control boolean NOT NULL DEFAULT false,

  evidence_status text NOT NULL DEFAULT 'UNTESTED',
  diagnostic_outcome text,
  challenge_outcome text,
  confirmation_outcome text,

  attempt_count integer NOT NULL DEFAULT 0,
  successful_demonstrations integer NOT NULL DEFAULT 0,
  required_confirmations integer NOT NULL DEFAULT 0,
  questions_seen integer NOT NULL DEFAULT 0,
  last_question_role text,
  confirmation_not_before_question integer,

  resolved_at timestamptz,
  learning_effect_applied_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reckoning_evidence_risk_score_ck
    CHECK (risk_score BETWEEN 0 AND 100),
  CONSTRAINT reckoning_evidence_risk_level_ck
    CHECK (risk_level IN ('CRITICAL','HIGH','SUPPORTING')),
  CONSTRAINT reckoning_evidence_status_ck
    CHECK (
      evidence_status IN (
        'UNTESTED',
        'PROVISIONAL',
        'CHALLENGE_REQUIRED',
        'CONFIRMATION_REQUIRED',
        'RECOVERED',
        'UNRESOLVED',
        'INVALIDATED'
      )
    ),
  CONSTRAINT reckoning_evidence_outcome_ck
    CHECK (
      (diagnostic_outcome IS NULL OR diagnostic_outcome IN ('CORRECT','INCORRECT','INVALIDATED'))
      AND (challenge_outcome IS NULL OR challenge_outcome IN ('CORRECT','INCORRECT','INVALIDATED'))
      AND (confirmation_outcome IS NULL OR confirmation_outcome IN ('CORRECT','INCORRECT','INVALIDATED'))
    ),
  CONSTRAINT reckoning_evidence_counts_ck
    CHECK (
      attempt_count >= 0
      AND successful_demonstrations >= 0
      AND required_confirmations >= 0
      AND questions_seen >= 0
      AND (
        confirmation_not_before_question IS NULL
        OR confirmation_not_before_question >= 0
      )
    ),
  CONSTRAINT reckoning_evidence_last_role_ck
    CHECK (
      last_question_role IS NULL
      OR last_question_role IN ('DIAGNOSTIC','CONTROL','CHALLENGE','CONFIRMATION')
    )
);

ALTER TABLE public.reckoning_evidence ENABLE ROW LEVEL SECURITY;

-- V2 evidence is an internal assessment-engine table. It is intentionally not
-- directly exposed to browser roles; curated state will later be served by the
-- backend API. Backend/direct-Postgres ownership remains unaffected.
REVOKE ALL ON TABLE public.reckoning_evidence FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reckoning_evidence TO service_role;

CREATE INDEX IF NOT EXISTS idx_reckoning_sessions_v2_user_mode
  ON public.reckoning_sessions (user_id, engine_mode, status)
  WHERE engine_version >= 2;

CREATE INDEX IF NOT EXISTS idx_reckoning_evidence_reckoning_status
  ON public.reckoning_evidence (reckoning_id, evidence_status, risk_score DESC);

CREATE INDEX IF NOT EXISTS idx_reckoning_evidence_user_reckoning
  ON public.reckoning_evidence (user_id, reckoning_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reckoning_evidence_source_card
  ON public.reckoning_evidence (reckoning_id, source_card_id)
  WHERE source_card_id IS NOT NULL;

ALTER TABLE public.exam_questions
  ADD COLUMN IF NOT EXISTS reckoning_evidence_id text,
  ADD COLUMN IF NOT EXISTS reckoning_role text,
  ADD COLUMN IF NOT EXISTS variant_index integer,
  ADD COLUMN IF NOT EXISTS reckoning_blueprint jsonb,
  ADD COLUMN IF NOT EXISTS is_unlocked boolean,
  ADD COLUMN IF NOT EXISTS unlocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_time_ms integer,
  ADD COLUMN IF NOT EXISTS evidence_effect jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_questions_reckoning_evidence_fkey'
  ) THEN
    ALTER TABLE public.exam_questions
      ADD CONSTRAINT exam_questions_reckoning_evidence_fkey
      FOREIGN KEY (reckoning_evidence_id)
      REFERENCES public.reckoning_evidence(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_questions_reckoning_role_ck'
  ) THEN
    ALTER TABLE public.exam_questions
      ADD CONSTRAINT exam_questions_reckoning_role_ck
      CHECK (
        reckoning_role IS NULL
        OR reckoning_role IN ('DIAGNOSTIC','CONTROL','CHALLENGE','CONFIRMATION')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_questions_reckoning_metadata_ck'
  ) THEN
    ALTER TABLE public.exam_questions
      ADD CONSTRAINT exam_questions_reckoning_metadata_ck
      CHECK (
        (variant_index IS NULL OR variant_index >= 0)
        AND (response_time_ms IS NULL OR response_time_ms >= 0)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_exam_questions_reckoning_evidence
  ON public.exam_questions (reckoning_evidence_id, reckoning_role, variant_index)
  WHERE reckoning_evidence_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exam_questions_reckoning_unlocked
  ON public.exam_questions (exam_session_id, is_unlocked, question_number)
  WHERE reckoning_evidence_id IS NOT NULL;

COMMENT ON TABLE public.reckoning_evidence IS
  'Persistent per-concept evidence state for Reckoning V2. Backend-only in Phase 2.';

COMMENT ON COLUMN public.reckoning_sessions.engine_version IS
  '1 means legacy Reckoning. V2 sessions will explicitly set engine_version=2.';

COMMENT ON COLUMN public.reckoning_sessions.engine_mode IS
  'Reckoning engine authority mode: LEGACY, SHADOW, PILOT, or LIVE.';

COMMENT ON COLUMN public.exam_questions.reckoning_evidence_id IS
  'Links a Reckoning V2 question to the evidence unit that caused it to exist.';
