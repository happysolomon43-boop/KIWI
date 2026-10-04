-- KIWI Teaching D26 — covering indexes for new foreign-key paths.
BEGIN;
CREATE INDEX IF NOT EXISTS teaching_review_needs_course_fk_idx ON public.teaching_review_needs(course_id);
CREATE INDEX IF NOT EXISTS teaching_review_needs_learning_unit_fk_idx ON public.teaching_review_needs(learning_unit_id);
CREATE INDEX IF NOT EXISTS teaching_recovery_cases_course_fk_idx ON public.teaching_recovery_cases(course_id);
COMMIT;
