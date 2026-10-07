-- KIWI Teaching — guarded preactivation reset for Course Analysis revision
-- Allows only the explicit Course Analysis revision transaction to move a READY
-- Course back to DRAFT. Normal lifecycle transitions remain unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.teaching_guard_d10_course_lifecycle()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
  analysis_reset boolean := coalesce(current_setting('kiwi.teaching_analysis_reset', true),'') = 'COURSE_ANALYSIS_REVISION';
BEGIN
  IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    IF NOT (
      (OLD.lifecycle_state='DRAFT' AND NEW.lifecycle_state='READY') OR
      (OLD.lifecycle_state='READY' AND NEW.lifecycle_state='ACTIVE') OR
      (OLD.lifecycle_state='ACTIVE' AND NEW.lifecycle_state IN ('PAUSED','TEACHING_ENDED')) OR
      (OLD.lifecycle_state='PAUSED' AND NEW.lifecycle_state IN ('ACTIVE','TEACHING_ENDED')) OR
      (OLD.lifecycle_state='TEACHING_ENDED' AND NEW.lifecycle_state='FINALIZING') OR
      (OLD.lifecycle_state='FINALIZING' AND NEW.lifecycle_state IN ('INCOMPLETE','COMPLETED')) OR
      (OLD.lifecycle_state='INCOMPLETE' AND NEW.lifecycle_state='FINALIZING') OR
      (OLD.lifecycle_state='COMPLETED' AND NEW.lifecycle_state='ARCHIVED') OR
      (analysis_reset AND OLD.lifecycle_state='READY' AND NEW.lifecycle_state='DRAFT'
        AND OLD.activated_at IS NULL AND OLD.academic_record_started_at IS NULL)
    ) THEN
      RAISE EXCEPTION 'Invalid Teaching Course lifecycle transition % -> %',OLD.lifecycle_state,NEW.lifecycle_state;
    END IF;
    IF NEW.state_version <> OLD.state_version + 1 THEN
      RAISE EXCEPTION 'Course lifecycle transitions must increment state_version exactly once.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.teaching_guard_d10_course_lifecycle() IS
  'D10 lifecycle guard. READY->DRAFT is allowed only inside a transaction explicitly marked for preactivation Course Analysis revision; activated academic history can never be reset by this path.';

COMMIT;
