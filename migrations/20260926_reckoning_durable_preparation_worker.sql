-- KIWI Reckoning durable preparation worker
-- Converts preparation items from passive checkpoints into durable work units.
-- Existing READY questions are preserved exactly; unresolved rows become resumable work.

ALTER TABLE reckoning_preparation_items
  ADD COLUMN IF NOT EXISTS work_state text NOT NULL DEFAULT 'NEEDS_GENERATION';

ALTER TABLE reckoning_preparation_items
  ADD COLUMN IF NOT EXISTS candidate_question jsonb;

ALTER TABLE reckoning_preparation_items
  ADD COLUMN IF NOT EXISTS retry_phase text;

ALTER TABLE reckoning_preparation_items
  ADD COLUMN IF NOT EXISTS retry_epoch integer NOT NULL DEFAULT 0;

ALTER TABLE reckoning_preparation_items
  ADD COLUMN IF NOT EXISTS content_revision_count integer NOT NULL DEFAULT 0;

ALTER TABLE reckoning_preparation_items
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

ALTER TABLE reckoning_preparation_items
  ADD COLUMN IF NOT EXISTS lease_token text;

ALTER TABLE reckoning_preparation_items
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

ALTER TABLE reckoning_preparation_items
  ADD COLUMN IF NOT EXISTS last_error_code text;

ALTER TABLE reckoning_preparation_items
  DROP CONSTRAINT IF EXISTS reckoning_preparation_items_work_state_ck;

ALTER TABLE reckoning_preparation_items
  ADD CONSTRAINT reckoning_preparation_items_work_state_ck
  CHECK (
    work_state IN (
      'NEEDS_GENERATION',
      'GENERATING',
      'NEEDS_AUDIT',
      'AUDITING',
      'RETRY_WAIT',
      'READY',
      'TERMINAL_ERROR'
    )
  );

ALTER TABLE reckoning_preparation_items
  DROP CONSTRAINT IF EXISTS reckoning_preparation_items_retry_phase_ck;

ALTER TABLE reckoning_preparation_items
  ADD CONSTRAINT reckoning_preparation_items_retry_phase_ck
  CHECK (retry_phase IS NULL OR retry_phase IN ('GENERATE','AUDIT'));

ALTER TABLE reckoning_preparation_items
  DROP CONSTRAINT IF EXISTS reckoning_preparation_items_retry_counts_ck;

ALTER TABLE reckoning_preparation_items
  ADD CONSTRAINT reckoning_preparation_items_retry_counts_ck
  CHECK (retry_epoch >= 0 AND content_revision_count >= 0);

ALTER TABLE reckoning_preparation_items
  DROP CONSTRAINT IF EXISTS reckoning_preparation_items_candidate_ck;

ALTER TABLE reckoning_preparation_items
  ADD CONSTRAINT reckoning_preparation_items_candidate_ck
  CHECK (
    work_state NOT IN ('NEEDS_AUDIT','AUDITING')
    OR candidate_question IS NOT NULL
  );

-- Preserve all completed work exactly.
UPDATE reckoning_preparation_items
SET work_state = 'READY',
    retry_phase = NULL,
    candidate_question = NULL,
    next_attempt_at = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    last_error_code = NULL
WHERE status = 'READY';

-- Existing unresolved/failed rows become durable work. This is intentionally
-- non-destructive: attempt_count, validation_issues and last_error are retained
-- as diagnostics while the item is made eligible for a new retry epoch.
UPDATE reckoning_preparation_items
SET status = 'PENDING',
    work_state = 'NEEDS_GENERATION',
    retry_phase = 'GENERATE',
    candidate_question = NULL,
    next_attempt_at = now(),
    lease_token = NULL,
    lease_expires_at = NULL,
    retry_epoch = GREATEST(retry_epoch, 0)
WHERE status = 'ERROR';

UPDATE reckoning_preparation_items
SET work_state = CASE
      WHEN generated_question IS NOT NULL THEN 'READY'
      WHEN candidate_question IS NOT NULL THEN 'NEEDS_AUDIT'
      ELSE 'NEEDS_GENERATION'
    END,
    retry_phase = CASE
      WHEN generated_question IS NOT NULL THEN NULL
      WHEN candidate_question IS NOT NULL THEN 'AUDIT'
      ELSE 'GENERATE'
    END,
    next_attempt_at = CASE
      WHEN generated_question IS NOT NULL THEN NULL
      ELSE COALESCE(next_attempt_at, now())
    END
WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_reckoning_preparation_items_due_work
  ON reckoning_preparation_items (
    reckoning_id,
    status,
    work_state,
    next_attempt_at,
    lease_expires_at,
    family_index,
    item_index
  );

CREATE INDEX IF NOT EXISTS idx_reckoning_preparation_items_work_lease
  ON reckoning_preparation_items (lease_expires_at)
  WHERE lease_token IS NOT NULL;
