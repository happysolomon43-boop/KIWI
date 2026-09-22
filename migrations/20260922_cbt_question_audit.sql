-- CBT question flag / AI integrity audit
-- A flag is an immutable audit request for the current exam attempt. The
-- original learner correctness is preserved separately from any bonus point.

ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS flagged_by_student boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_audit_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS ai_audit_result jsonb,
  ADD COLUMN IF NOT EXISTS ai_audit_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS bonus_awarded boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_questions_ai_audit_status_check'
  ) THEN
    ALTER TABLE exam_questions
      ADD CONSTRAINT exam_questions_ai_audit_status_check
      CHECK (ai_audit_status IN ('not_requested','pending','reviewed','error'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_exam_questions_flagged_audit
  ON exam_questions (exam_session_id, ai_audit_status)
  WHERE flagged_by_student = true;
