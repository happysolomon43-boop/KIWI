-- KIWI Teaching D08 post-migration hardening
-- Clears only D08-specific advisor findings discovered after the additive D08 migration.
BEGIN;

ALTER FUNCTION public.teaching_guard_d08_course_plan_update()
  SET search_path = pg_catalog, public;

CREATE INDEX teaching_coverage_audits_course_idx
  ON public.teaching_coverage_audits(course_id,created_at DESC);

COMMIT;
