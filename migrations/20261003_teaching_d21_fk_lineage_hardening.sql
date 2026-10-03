BEGIN;

-- KIWI Teaching D21 foreign-key lineage hardening.
-- Keep every D21 authority/lineage lookup indexable from the referenced key,
-- including correction, supersession, repeat-attempt, PPL, and GPA paths.

CREATE INDEX IF NOT EXISTS teaching_course_attempts_course_fk_idx
  ON public.teaching_course_attempts(course_id);
CREATE INDEX IF NOT EXISTS teaching_course_attempts_root_course_fk_idx
  ON public.teaching_course_attempts(root_course_id);
CREATE INDEX IF NOT EXISTS teaching_course_attempts_source_course_fk_idx
  ON public.teaching_course_attempts(source_course_id);
CREATE INDEX IF NOT EXISTS teaching_course_attempts_source_attempt_fk_idx
  ON public.teaching_course_attempts(source_attempt_id);
CREATE INDEX IF NOT EXISTS teaching_course_attempts_source_progression_outcome_fk_idx
  ON public.teaching_course_attempts(source_progression_outcome_id);

CREATE INDEX IF NOT EXISTS teaching_progression_policies_course_fk_idx
  ON public.teaching_progression_policies(course_id);
CREATE INDEX IF NOT EXISTS teaching_progression_policies_semester_fk_idx
  ON public.teaching_progression_policies(semester_id);

CREATE INDEX IF NOT EXISTS teaching_progression_outcomes_course_fk_idx
  ON public.teaching_progression_outcomes(course_id);
CREATE INDEX IF NOT EXISTS teaching_progression_outcomes_attempt_fk_idx
  ON public.teaching_progression_outcomes(attempt_id);
CREATE INDEX IF NOT EXISTS teaching_progression_outcomes_policy_fk_idx
  ON public.teaching_progression_outcomes(progression_policy_id);
CREATE INDEX IF NOT EXISTS teaching_progression_outcomes_source_result_fk_idx
  ON public.teaching_progression_outcomes(source_course_result_id);
CREATE INDEX IF NOT EXISTS teaching_progression_outcomes_supersedes_fk_idx
  ON public.teaching_progression_outcomes(supersedes_outcome_id);

CREATE INDEX IF NOT EXISTS teaching_progression_pathways_course_fk_idx
  ON public.teaching_progression_pathways(course_id);
CREATE INDEX IF NOT EXISTS teaching_progression_pathways_attempt_fk_idx
  ON public.teaching_progression_pathways(attempt_id);
CREATE INDEX IF NOT EXISTS teaching_progression_pathways_outcome_fk_idx
  ON public.teaching_progression_pathways(progression_outcome_id);
CREATE INDEX IF NOT EXISTS teaching_progression_pathways_workspace_fk_idx
  ON public.teaching_progression_pathways(preparation_workspace_ref);

CREATE INDEX IF NOT EXISTS teaching_progression_pathway_steps_pathway_fk_idx
  ON public.teaching_progression_pathway_steps(pathway_id);

CREATE INDEX IF NOT EXISTS teaching_semester_gpa_snapshots_semester_fk_idx
  ON public.teaching_semester_gpa_snapshots(semester_id);
CREATE INDEX IF NOT EXISTS teaching_semester_gpa_snapshots_policy_fk_idx
  ON public.teaching_semester_gpa_snapshots(progression_policy_id);
CREATE INDEX IF NOT EXISTS teaching_semester_gpa_snapshots_supersedes_fk_idx
  ON public.teaching_semester_gpa_snapshots(supersedes_gpa_snapshot_id);

COMMIT;
