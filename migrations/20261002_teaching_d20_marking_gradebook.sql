BEGIN;

-- KIWI Teaching D20 — Formal Marking, Moderation, Appeals & Gradebook.
-- D17 remains the owner of immutable Assessment/Package/Attempt/Response truth.
-- D20 consumes that lineage and owns official marking/result/Gradebook truth.

CREATE TABLE IF NOT EXISTS public.teaching_grading_policies (
  grading_policy_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  policy_state text NOT NULL CHECK (policy_state IN ('DRAFT','LOCKED','SUPERSEDED')),
  category_weights jsonb NOT NULL,
  rounding_policy jsonb NOT NULL,
  grade_scale_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  topic_evidence_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  essential_outcome_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  moderation_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  appeal_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_policy_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  locked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_grading_policies_course_version_uidx ON public.teaching_grading_policies(student_id,course_id,version_no);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_grading_policies_idempotency_uidx ON public.teaching_grading_policies(student_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_grading_policies_one_locked_uidx ON public.teaching_grading_policies(student_id,course_id) WHERE policy_state='LOCKED';

CREATE TABLE IF NOT EXISTS public.teaching_assessment_results (
  assessment_result_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  assessment_attempt_id text NOT NULL REFERENCES public.teaching_assessment_attempts(assessment_attempt_id) ON DELETE RESTRICT,
  assessment_package_id text NOT NULL REFERENCES public.teaching_assessment_packages(assessment_package_id) ON DELETE RESTRICT,
  grading_policy_id text NOT NULL REFERENCES public.teaching_grading_policies(grading_policy_id) ON DELETE RESTRICT,
  assessment_type text NOT NULL,
  category_key text NOT NULL,
  marking_state text NOT NULL CHECK (marking_state IN ('MARKING','MODERATING','PROVISIONAL','MODERATED','REVIEW_NEEDED')),
  release_state text NOT NULL CHECK (release_state IN ('HELD','RELEASED','APPEALABLE','FINALIZED')),
  moderation_required boolean NOT NULL DEFAULT false,
  review_blocked boolean NOT NULL DEFAULT false,
  original_marking_run_id text NULL,
  current_marking_run_id text NULL,
  raw_earned_marks numeric NULL,
  raw_max_marks numeric NULL,
  raw_percentage numeric NULL,
  source_snapshot_ref text NOT NULL,
  source_snapshot_hash text NOT NULL,
  result_version bigint NOT NULL DEFAULT 1 CHECK (result_version > 0),
  feedback_release_at timestamptz NULL,
  released_at timestamptz NULL,
  appealable_at timestamptz NULL,
  finalized_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_results_attempt_uidx ON public.teaching_assessment_results(student_id,assessment_attempt_id);
CREATE INDEX IF NOT EXISTS teaching_assessment_results_course_idx ON public.teaching_assessment_results(student_id,course_id,created_at DESC);
CREATE INDEX IF NOT EXISTS teaching_assessment_results_assessment_idx ON public.teaching_assessment_results(student_id,assessment_id);

CREATE TABLE IF NOT EXISTS public.teaching_marking_runs (
  marking_run_id text PRIMARY KEY,
  assessment_result_id text NOT NULL REFERENCES public.teaching_assessment_results(assessment_result_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  package_item_id text NULL REFERENCES public.teaching_assessment_package_items(package_item_id) ON DELETE RESTRICT,
  parent_run_id text NULL REFERENCES public.teaching_marking_runs(marking_run_id) ON DELETE SET NULL,
  run_kind text NOT NULL,
  run_status text NOT NULL,
  capability_id text NULL,
  authority_level text NOT NULL,
  prompt_family text NULL,
  prompt_version text NULL,
  input_state_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_digest text NOT NULL,
  structured_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  original_credit_visible boolean NOT NULL DEFAULT false,
  raw_appeal_visible boolean NOT NULL DEFAULT false,
  review_direction_visible boolean NOT NULL DEFAULT false,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_marking_runs_idempotency_uidx ON public.teaching_marking_runs(student_id,idempotency_key);
CREATE INDEX IF NOT EXISTS teaching_marking_runs_result_idx ON public.teaching_marking_runs(student_id,assessment_result_id,created_at);
CREATE INDEX IF NOT EXISTS teaching_marking_runs_item_idx ON public.teaching_marking_runs(package_item_id,created_at);

ALTER TABLE public.teaching_assessment_results
  DROP CONSTRAINT IF EXISTS teaching_assessment_results_original_marking_run_id_fkey;
ALTER TABLE public.teaching_assessment_results
  ADD CONSTRAINT teaching_assessment_results_original_marking_run_id_fkey
  FOREIGN KEY(original_marking_run_id) REFERENCES public.teaching_marking_runs(marking_run_id) ON DELETE SET NULL;
ALTER TABLE public.teaching_assessment_results
  DROP CONSTRAINT IF EXISTS teaching_assessment_results_current_marking_run_id_fkey;
ALTER TABLE public.teaching_assessment_results
  ADD CONSTRAINT teaching_assessment_results_current_marking_run_id_fkey
  FOREIGN KEY(current_marking_run_id) REFERENCES public.teaching_marking_runs(marking_run_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.teaching_marking_criterion_judgments (
  criterion_judgment_id text PRIMARY KEY,
  marking_run_id text NOT NULL REFERENCES public.teaching_marking_runs(marking_run_id) ON DELETE CASCADE,
  assessment_result_id text NOT NULL REFERENCES public.teaching_assessment_results(assessment_result_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  package_item_id text NOT NULL REFERENCES public.teaching_assessment_package_items(package_item_id) ON DELETE RESTRICT,
  criterion_id text NOT NULL,
  criterion_max_marks numeric NOT NULL CHECK (criterion_max_marks >= 0),
  proposed_credit numeric NULL CHECK (proposed_credit IS NULL OR proposed_credit >= 0),
  proposed_band_id text NULL,
  supported_credit_range jsonb NULL,
  satisfaction text NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_summary text NULL,
  review_state text NOT NULL,
  confidence text NULL,
  alternative_valid_route_used boolean NOT NULL DEFAULT false,
  follow_through_applied boolean NOT NULL DEFAULT false,
  defect_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_marking_criterion_judgments_run_criterion_uidx ON public.teaching_marking_criterion_judgments(marking_run_id,package_item_id,criterion_id);
CREATE INDEX IF NOT EXISTS teaching_marking_criterion_judgments_result_idx ON public.teaching_marking_criterion_judgments(student_id,assessment_result_id,package_item_id);

CREATE TABLE IF NOT EXISTS public.teaching_grade_appeals (
  grade_appeal_id text PRIMARY KEY,
  assessment_result_id text NOT NULL REFERENCES public.teaching_assessment_results(assessment_result_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  package_item_id text NOT NULL REFERENCES public.teaching_assessment_package_items(package_item_id) ON DELETE RESTRICT,
  criterion_id text NOT NULL,
  appeal_ground text NOT NULL,
  raw_appeal_text text NOT NULL DEFAULT '',
  normalized_artifact jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_direction_policy text NOT NULL CHECK (review_direction_policy IN ('upward_only','two_way','retain_or_escalate')),
  appeal_state text NOT NULL CHECK (appeal_state IN ('SUBMITTED','REVIEWING','EXTERNAL_HANDOFF','RESOLVED')),
  prior_appeal_id text NULL REFERENCES public.teaching_grade_appeals(grade_appeal_id) ON DELETE RESTRICT,
  repeat_authorization_ref text NULL,
  rubric_ref text NOT NULL,
  policy_ref text NOT NULL,
  pass_a_run_id text NULL REFERENCES public.teaching_marking_runs(marking_run_id) ON DELETE SET NULL,
  pass_b_run_id text NULL REFERENCES public.teaching_marking_runs(marking_run_id) ON DELETE SET NULL,
  disposition text NULL,
  corrected_credit numeric NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_grade_appeals_idempotency_uidx ON public.teaching_grade_appeals(student_id,idempotency_key);
CREATE INDEX IF NOT EXISTS teaching_grade_appeals_result_idx ON public.teaching_grade_appeals(student_id,assessment_result_id,submitted_at);
CREATE INDEX IF NOT EXISTS teaching_grade_appeals_repeat_idx ON public.teaching_grade_appeals(prior_appeal_id);

CREATE TABLE IF NOT EXISTS public.teaching_gradebook_entries (
  gradebook_entry_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  grading_policy_id text NOT NULL REFERENCES public.teaching_grading_policies(grading_policy_id) ON DELETE RESTRICT,
  source_kind text NOT NULL,
  source_ref text NOT NULL,
  source_result_id text NULL REFERENCES public.teaching_assessment_results(assessment_result_id) ON DELETE SET NULL,
  source_assignment_evaluation_id text NULL REFERENCES public.teaching_assignment_evaluations(assignment_evaluation_id) ON DELETE SET NULL,
  source_assessment_id text NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE SET NULL,
  source_assessment_attempt_id text NULL REFERENCES public.teaching_assessment_attempts(assessment_attempt_id) ON DELETE SET NULL,
  source_assessment_package_id text NULL REFERENCES public.teaching_assessment_packages(assessment_package_id) ON DELETE SET NULL,
  category_key text NOT NULL,
  category_weight numeric NOT NULL CHECK (category_weight >= 0 AND category_weight <= 1),
  within_category_weight numeric NOT NULL CHECK (within_category_weight >= 0 AND within_category_weight <= 1),
  raw_earned_marks numeric NOT NULL,
  raw_max_marks numeric NOT NULL CHECK (raw_max_marks > 0),
  raw_percentage numeric NOT NULL,
  course_contribution numeric NOT NULL,
  entry_state text NOT NULL,
  learning_unit_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  topic_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  version_no integer NOT NULL CHECK (version_no > 0),
  supersedes_entry_id text NULL REFERENCES public.teaching_gradebook_entries(gradebook_entry_id) ON DELETE SET NULL,
  change_reason text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_gradebook_entries_idempotency_uidx ON public.teaching_gradebook_entries(student_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_gradebook_entries_source_version_uidx ON public.teaching_gradebook_entries(student_id,source_kind,source_ref,version_no);
CREATE INDEX IF NOT EXISTS teaching_gradebook_entries_course_idx ON public.teaching_gradebook_entries(student_id,course_id,category_key,created_at DESC);
CREATE INDEX IF NOT EXISTS teaching_gradebook_entries_assessment_lineage_idx ON public.teaching_gradebook_entries(source_assessment_id,source_assessment_attempt_id,source_assessment_package_id);

CREATE TABLE IF NOT EXISTS public.teaching_topic_score_snapshots (
  topic_score_snapshot_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  topic_id text NOT NULL REFERENCES public.teaching_topics(topic_id) ON DELETE RESTRICT,
  grading_policy_id text NOT NULL REFERENCES public.teaching_grading_policies(grading_policy_id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  score_percentage numeric NULL,
  score_state text NOT NULL,
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  distinct_context_count integer NOT NULL DEFAULT 0 CHECK (distinct_context_count >= 0),
  distinct_occasion_count integer NOT NULL DEFAULT 0 CHECK (distinct_occasion_count >= 0),
  controlled_independent_present boolean NOT NULL DEFAULT false,
  category_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  essential_outcome_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_gradebook_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_topic_score_snapshots_version_uidx ON public.teaching_topic_score_snapshots(student_id,course_id,topic_id,version_no);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_topic_score_snapshots_idempotency_uidx ON public.teaching_topic_score_snapshots(student_id,idempotency_key);
CREATE INDEX IF NOT EXISTS teaching_topic_score_snapshots_course_idx ON public.teaching_topic_score_snapshots(student_id,course_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_course_result_snapshots (
  course_result_snapshot_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  grading_policy_id text NOT NULL REFERENCES public.teaching_grading_policies(grading_policy_id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  score_percentage numeric NOT NULL,
  result_state text NOT NULL,
  category_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  grade_scale_outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  essential_outcome_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_gradebook_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_course_result_snapshots_version_uidx ON public.teaching_course_result_snapshots(student_id,course_id,version_no);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_course_result_snapshots_idempotency_uidx ON public.teaching_course_result_snapshots(student_id,idempotency_key);
CREATE INDEX IF NOT EXISTS teaching_course_result_snapshots_course_idx ON public.teaching_course_result_snapshots(student_id,course_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_grade_change_audit (
  grade_change_audit_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_ref text NOT NULL,
  appeal_id text NULL REFERENCES public.teaching_grade_appeals(grade_appeal_id) ON DELETE SET NULL,
  original_entry_id text NULL REFERENCES public.teaching_gradebook_entries(gradebook_entry_id) ON DELETE SET NULL,
  new_entry_id text NULL REFERENCES public.teaching_gradebook_entries(gradebook_entry_id) ON DELETE SET NULL,
  reason_code text NOT NULL,
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  bounded_reason_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  downstream_handoffs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_grade_change_audit_idempotency_uidx ON public.teaching_grade_change_audit(student_id,idempotency_key);
CREATE INDEX IF NOT EXISTS teaching_grade_change_audit_course_idx ON public.teaching_grade_change_audit(student_id,course_id,created_at DESC);
CREATE INDEX IF NOT EXISTS teaching_grade_change_audit_source_idx ON public.teaching_grade_change_audit(source_kind,source_ref,created_at DESC);

-- Formal academic truth is service-owned. Browsers receive projections through
-- authenticated application routes; they do not receive direct table DML grants.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'teaching_grading_policies','teaching_assessment_results','teaching_marking_runs',
    'teaching_marking_criterion_judgments','teaching_grade_appeals','teaching_gradebook_entries',
    'teaching_topic_score_snapshots','teaching_course_result_snapshots','teaching_grade_change_audit'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated, public',t);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO service_role',t);
  END LOOP;
END $$;

GRANT UPDATE ON public.teaching_assessment_results,public.teaching_grade_appeals TO service_role;

COMMIT;
