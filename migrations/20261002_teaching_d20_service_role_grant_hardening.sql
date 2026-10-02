BEGIN;

-- KIWI Teaching D20 production grant hardening.
-- Supabase production default privileges can grant service_role broad table DML
-- on newly-created public tables. D20 requires append-only/versioned evidence to
-- remain protected at both the trigger and GRANT layers.

REVOKE UPDATE, DELETE, TRUNCATE ON
  public.teaching_grading_policies,
  public.teaching_assessment_results,
  public.teaching_marking_runs,
  public.teaching_marking_criterion_judgments,
  public.teaching_grade_appeals,
  public.teaching_gradebook_entries,
  public.teaching_topic_score_snapshots,
  public.teaching_course_result_snapshots,
  public.teaching_grade_change_audit
FROM service_role;

-- Only the two mutable D20 state carriers may be updated by the application
-- service. All other official academic evidence remains insert/version based.
GRANT UPDATE ON public.teaching_assessment_results, public.teaching_grade_appeals TO service_role;

COMMIT;
