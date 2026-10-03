-- KIWI Teaching D21 — Progression, Remediation, Resit, Recovery, Repeat & GPA
-- Scope: TCH-0037, TCH-0063, TCH-0427..0461, TCH-0732, TCH-0890.
-- D20 remains official Gradebook/result owner. D13 remains SKM owner. D17 remains Assessment Package owner.

BEGIN;

CREATE TABLE IF NOT EXISTS public.teaching_course_attempts (
  attempt_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  root_course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no >= 1),
  attempt_kind text NOT NULL CHECK (attempt_kind IN ('INITIAL','REPEAT')),
  source_course_id text NULL REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  source_attempt_id text NULL REFERENCES public.teaching_course_attempts(attempt_id) ON DELETE RESTRICT,
  source_progression_outcome_id text NULL,
  prior_pedagogical_history_ref jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(prior_pedagogical_history_ref)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  CHECK ((attempt_kind='INITIAL' AND attempt_no=1 AND source_attempt_id IS NULL AND source_course_id IS NULL)
      OR (attempt_kind='REPEAT' AND attempt_no>1 AND source_attempt_id IS NOT NULL AND source_course_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_course_attempts_course_uidx
  ON public.teaching_course_attempts(student_id,course_id);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_course_attempts_root_number_uidx
  ON public.teaching_course_attempts(student_id,root_course_id,attempt_no);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_course_attempts_idempotency_uidx
  ON public.teaching_course_attempts(student_id,idempotency_key);
CREATE INDEX IF NOT EXISTS teaching_course_attempts_source_idx
  ON public.teaching_course_attempts(student_id,source_attempt_id);

CREATE TABLE IF NOT EXISTS public.teaching_progression_policies (
  progression_policy_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('COURSE','SEMESTER')),
  course_id text NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  semester_id text NULL REFERENCES public.teaching_semesters(semester_id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no >= 1),
  policy_state text NOT NULL CHECK (policy_state IN ('LOCKED','SUPERSEDED')),
  academic_credits numeric NULL CHECK (academic_credits IS NULL OR academic_credits > 0),
  certification_rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(certification_rules)='object'),
  pathway_rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pathway_rules)='object'),
  resit_policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(resit_policy)='object'),
  repeat_policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(repeat_policy)='object'),
  gpa_policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(gpa_policy)='object'),
  source_policy_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_policy_refs)='array'),
  locked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  CHECK ((scope_kind='COURSE' AND course_id IS NOT NULL AND semester_id IS NULL)
      OR (scope_kind='SEMESTER' AND semester_id IS NOT NULL AND course_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_progression_policies_idempotency_uidx
  ON public.teaching_progression_policies(student_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_progression_policies_course_version_uidx
  ON public.teaching_progression_policies(student_id,course_id,version_no) WHERE scope_kind='COURSE';
CREATE UNIQUE INDEX IF NOT EXISTS teaching_progression_policies_semester_version_uidx
  ON public.teaching_progression_policies(student_id,semester_id,version_no) WHERE scope_kind='SEMESTER';
CREATE UNIQUE INDEX IF NOT EXISTS teaching_progression_policies_locked_course_uidx
  ON public.teaching_progression_policies(student_id,course_id) WHERE scope_kind='COURSE' AND policy_state='LOCKED';
CREATE UNIQUE INDEX IF NOT EXISTS teaching_progression_policies_locked_semester_uidx
  ON public.teaching_progression_policies(student_id,semester_id) WHERE scope_kind='SEMESTER' AND policy_state='LOCKED';

CREATE TABLE IF NOT EXISTS public.teaching_progression_outcomes (
  progression_outcome_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  attempt_id text NOT NULL REFERENCES public.teaching_course_attempts(attempt_id) ON DELETE RESTRICT,
  progression_policy_id text NOT NULL REFERENCES public.teaching_progression_policies(progression_policy_id) ON DELETE RESTRICT,
  progression_policy_version integer NOT NULL CHECK (progression_policy_version >= 1),
  version_no integer NOT NULL CHECK (version_no >= 1),
  source_course_result_id text NULL REFERENCES public.teaching_course_result_snapshots(course_result_snapshot_id) ON DELETE RESTRICT,
  source_course_result_version integer NOT NULL DEFAULT 0 CHECK (source_course_result_version >= 0),
  source_gradebook_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_gradebook_entry_ids)='array'),
  source_state_digest text NOT NULL CHECK (length(btrim(source_state_digest)) > 0),
  outcome text NOT NULL CHECK (outcome IN (
    'INCOMPLETE','CLEAN_PASS','PASS_REMEDIATION_REQUIRED','RESIT_REQUIRED',
    'RECOVERY_PROGRAMME_REQUIRED','REPEAT_REQUIRED','FAILED_AFTER_RESIT_OR_RECOVERY'
  )),
  certification_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(certification_snapshot)='object'),
  weakness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(weakness_snapshot)='object'),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes)='array'),
  supersedes_outcome_id text NULL REFERENCES public.teaching_progression_outcomes(progression_outcome_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_progression_outcomes_attempt_version_uidx
  ON public.teaching_progression_outcomes(student_id,attempt_id,version_no);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_progression_outcomes_source_digest_uidx
  ON public.teaching_progression_outcomes(student_id,attempt_id,source_state_digest);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_progression_outcomes_idempotency_uidx
  ON public.teaching_progression_outcomes(student_id,idempotency_key);
CREATE INDEX IF NOT EXISTS teaching_progression_outcomes_course_idx
  ON public.teaching_progression_outcomes(student_id,course_id,version_no DESC);

ALTER TABLE public.teaching_course_attempts
  DROP CONSTRAINT IF EXISTS teaching_course_attempts_source_progression_outcome_id_fkey;
ALTER TABLE public.teaching_course_attempts
  ADD CONSTRAINT teaching_course_attempts_source_progression_outcome_id_fkey
  FOREIGN KEY(source_progression_outcome_id)
  REFERENCES public.teaching_progression_outcomes(progression_outcome_id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.teaching_progression_pathways (
  pathway_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  attempt_id text NOT NULL REFERENCES public.teaching_course_attempts(attempt_id) ON DELETE RESTRICT,
  progression_outcome_id text NOT NULL REFERENCES public.teaching_progression_outcomes(progression_outcome_id) ON DELETE RESTRICT,
  pathway_type text NOT NULL CHECK (pathway_type IN ('REMEDIATION','RESIT_PREPARATION','TARGETED_VERIFICATION','RECOVERY','REPEAT')),
  pathway_state text NOT NULL CHECK (pathway_state IN ('DRAFT','ACTIVE','READY_FOR_VERIFICATION','VERIFIED','FAILED','SUPERSEDED','CANCELLED')),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  required_learning_unit_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_learning_unit_refs)='array'),
  required_task_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_task_refs)='array'),
  verification_condition jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(verification_condition)='object'),
  verification_ref text NULL,
  plan_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(plan_payload)='object'),
  source_state_versions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_state_versions)='object'),
  preparation_workspace_ref text NULL REFERENCES teaching_preparation.workspaces(workspace_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_progression_pathways_idempotency_uidx
  ON public.teaching_progression_pathways(student_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_progression_pathways_outcome_type_uidx
  ON public.teaching_progression_pathways(student_id,progression_outcome_id,pathway_type);
CREATE INDEX IF NOT EXISTS teaching_progression_pathways_course_idx
  ON public.teaching_progression_pathways(student_id,course_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_progression_pathway_steps (
  pathway_step_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pathway_id text NOT NULL REFERENCES public.teaching_progression_pathways(pathway_id) ON DELETE CASCADE,
  step_kind text NOT NULL CHECK (length(btrim(step_kind)) > 0),
  reference_id text NULL,
  step_state text NOT NULL CHECK (length(btrim(step_state)) > 0),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_progression_pathway_steps_idempotency_uidx
  ON public.teaching_progression_pathway_steps(student_id,idempotency_key);
CREATE INDEX IF NOT EXISTS teaching_progression_pathway_steps_pathway_idx
  ON public.teaching_progression_pathway_steps(student_id,pathway_id,created_at);

CREATE TABLE IF NOT EXISTS public.teaching_semester_gpa_snapshots (
  semester_gpa_snapshot_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  semester_id text NOT NULL REFERENCES public.teaching_semesters(semester_id) ON DELETE RESTRICT,
  progression_policy_id text NOT NULL REFERENCES public.teaching_progression_policies(progression_policy_id) ON DELETE RESTRICT,
  progression_policy_version integer NOT NULL CHECK (progression_policy_version >= 1),
  version_no integer NOT NULL CHECK (version_no >= 1),
  gpa_value numeric NULL,
  numerator numeric NOT NULL DEFAULT 0,
  denominator numeric NOT NULL DEFAULT 0 CHECK (denominator >= 0),
  weighting_mode text NOT NULL CHECK (length(btrim(weighting_mode)) > 0),
  calculation_entries jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(calculation_entries)='array'),
  source_state_digest text NOT NULL CHECK (length(btrim(source_state_digest)) > 0),
  supersedes_gpa_snapshot_id text NULL REFERENCES public.teaching_semester_gpa_snapshots(semester_gpa_snapshot_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_semester_gpa_snapshots_version_uidx
  ON public.teaching_semester_gpa_snapshots(student_id,semester_id,version_no);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_semester_gpa_snapshots_source_digest_uidx
  ON public.teaching_semester_gpa_snapshots(student_id,semester_id,source_state_digest);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_semester_gpa_snapshots_idempotency_uidx
  ON public.teaching_semester_gpa_snapshots(student_id,idempotency_key);

INSERT INTO public.teaching_course_attempts(
  attempt_id,student_id,course_id,root_course_id,attempt_no,attempt_kind,
  source_course_id,source_attempt_id,source_progression_outcome_id,prior_pedagogical_history_ref,idempotency_key
)
SELECT c.course_id||':attempt:1',c.student_id,c.course_id,c.course_id,1,'INITIAL',
       null,null,null,'{}'::jsonb,'d21-initial-attempt:'||c.course_id
  FROM public.teaching_courses c
ON CONFLICT(student_id,course_id) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS teaching_d21_ppl_pathway_workspace_uidx
  ON teaching_preparation.workspaces(student_id,target_kind,target_ref)
  WHERE target_kind='PROGRESSION_PATHWAY';

DROP TRIGGER IF EXISTS d21_course_attempts_append_only ON public.teaching_course_attempts;
CREATE TRIGGER d21_course_attempts_append_only
BEFORE UPDATE OR DELETE ON public.teaching_course_attempts
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

DROP TRIGGER IF EXISTS d21_progression_policies_append_only ON public.teaching_progression_policies;
CREATE TRIGGER d21_progression_policies_append_only
BEFORE UPDATE OR DELETE ON public.teaching_progression_policies
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

DROP TRIGGER IF EXISTS d21_progression_outcomes_append_only ON public.teaching_progression_outcomes;
CREATE TRIGGER d21_progression_outcomes_append_only
BEFORE UPDATE OR DELETE ON public.teaching_progression_outcomes
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

DROP TRIGGER IF EXISTS d21_pathway_steps_append_only ON public.teaching_progression_pathway_steps;
CREATE TRIGGER d21_pathway_steps_append_only
BEFORE UPDATE OR DELETE ON public.teaching_progression_pathway_steps
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

DROP TRIGGER IF EXISTS d21_semester_gpa_append_only ON public.teaching_semester_gpa_snapshots;
CREATE TRIGGER d21_semester_gpa_append_only
BEFORE UPDATE OR DELETE ON public.teaching_semester_gpa_snapshots
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

CREATE OR REPLACE FUNCTION public.teaching_d21_guard_pathway_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.pathway_id IS DISTINCT FROM OLD.pathway_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.course_id IS DISTINCT FROM OLD.course_id
     OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
     OR NEW.progression_outcome_id IS DISTINCT FROM OLD.progression_outcome_id
     OR NEW.pathway_type IS DISTINCT FROM OLD.pathway_type
     OR NEW.source_state_versions IS DISTINCT FROM OLD.source_state_versions
     OR NEW.required_learning_unit_refs IS DISTINCT FROM OLD.required_learning_unit_refs
     OR NEW.required_task_refs IS DISTINCT FROM OLD.required_task_refs
     OR NEW.verification_condition IS DISTINCT FROM OLD.verification_condition
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'D21 pathway academic identity/source lineage is immutable; create a new pathway/version instead'
      USING ERRCODE='55000';
  END IF;
  IF NEW.state_version <> OLD.state_version + 1 THEN
    RAISE EXCEPTION 'D21 pathway update must advance state_version exactly once'
      USING ERRCODE='40001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS d21_pathway_identity_guard ON public.teaching_progression_pathways;
CREATE TRIGGER d21_pathway_identity_guard
BEFORE UPDATE ON public.teaching_progression_pathways
FOR EACH ROW EXECUTE FUNCTION public.teaching_d21_guard_pathway_identity();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'teaching_course_attempts','teaching_progression_policies','teaching_progression_outcomes',
    'teaching_progression_pathways','teaching_progression_pathway_steps','teaching_semester_gpa_snapshots'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT SELECT,INSERT ON TABLE public.%I TO service_role',t);
  END LOOP;
END $$;
GRANT UPDATE ON public.teaching_progression_pathways TO service_role;

COMMIT;
