BEGIN;

-- KIWI Teaching D17 — authoritative formal Assessment domain.
-- D04 teaching_assessment_eligibility remains the eligibility owner. These tables
-- snapshot/consume that truth; they do not create a parallel eligibility source.

CREATE TABLE IF NOT EXISTS public.teaching_assessments (
  assessment_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  assessment_type text NOT NULL,
  purpose text NOT NULL,
  title text NOT NULL,
  graded boolean NOT NULL DEFAULT false,
  definition_state text NOT NULL,
  announced_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version text NOT NULL,
  source_lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_version bigint NOT NULL DEFAULT 1,
  supersedes_assessment_id text NULL REFERENCES public.teaching_assessments(assessment_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessments_student_idempotency_uidx ON public.teaching_assessments(student_id,idempotency_key);
CREATE INDEX IF NOT EXISTS teaching_assessments_student_course_idx ON public.teaching_assessments(student_id,course_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_blueprints (
  assessment_blueprint_id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  lane text NOT NULL,
  maturity text NOT NULL,
  blueprint_payload jsonb NOT NULL,
  response_form_architecture jsonb NOT NULL,
  total_marks numeric NOT NULL,
  duration_minutes integer NOT NULL,
  timer_model text NOT NULL,
  resource_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  accommodation_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  eligibility_snapshot_hash text NULL,
  single_mode_justification text NULL,
  source_state_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  supersedes_blueprint_id text NULL REFERENCES public.teaching_assessment_blueprints(assessment_blueprint_id),
  idempotency_key text NOT NULL,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_blueprints_version_uidx ON public.teaching_assessment_blueprints(assessment_id,version_no);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_blueprints_student_idempotency_uidx ON public.teaching_assessment_blueprints(student_id,idempotency_key);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_eligibility_entries (
  eligibility_entry_id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  blueprint_version integer NOT NULL,
  learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE RESTRICT,
  coverage_entry_id text NULL REFERENCES public.teaching_course_coverage(coverage_entry_id) ON DELETE SET NULL,
  coverage_version bigint NOT NULL,
  eligibility_basis text NOT NULL,
  owner_ref text NOT NULL,
  eligible_at timestamptz NOT NULL,
  policy_version text NOT NULL,
  snapshot_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_eligibility_snapshot_uidx ON public.teaching_assessment_eligibility_entries(assessment_id,blueprint_version,learning_unit_id);
CREATE INDEX IF NOT EXISTS teaching_assessment_eligibility_student_idx ON public.teaching_assessment_eligibility_entries(student_id,assessment_id,blueprint_version);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_candidates (
  assessment_candidate_id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  assessment_blueprint_id text NOT NULL REFERENCES public.teaching_assessment_blueprints(assessment_blueprint_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  slot_id text NOT NULL,
  candidate_state text NOT NULL,
  latest_version_no integer NOT NULL DEFAULT 0,
  similarity_lineage jsonb NOT NULL DEFAULT '[]'::jsonb,
  retire_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_candidates_slot_uidx ON public.teaching_assessment_candidates(assessment_blueprint_id,slot_id,assessment_candidate_id);
CREATE INDEX IF NOT EXISTS teaching_assessment_candidates_assessment_idx ON public.teaching_assessment_candidates(student_id,assessment_id,assessment_blueprint_id);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_candidate_versions (
  candidate_version_id text PRIMARY KEY,
  assessment_candidate_id text NOT NULL REFERENCES public.teaching_assessment_candidates(assessment_candidate_id) ON DELETE CASCADE,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  response_family text NOT NULL,
  intended_marks numeric NOT NULL,
  required_learning_unit_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  demand_vector jsonb NOT NULL DEFAULT '{}'::jsonb,
  public_item_payload jsonb NOT NULL,
  protected_payload jsonb NOT NULL,
  choice_set_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  hidden_validation_trace jsonb NOT NULL DEFAULT '{}'::jsonb,
  predicted_burden jsonb NOT NULL DEFAULT '{}'::jsonb,
  predicted_difficulty jsonb NOT NULL DEFAULT '{}'::jsonb,
  semantic_hash text NULL,
  protection_state text NOT NULL DEFAULT 'PROTECTED',
  created_at timestamptz NOT NULL DEFAULT now(),
  supersedes_candidate_version_id text NULL REFERENCES public.teaching_assessment_candidate_versions(candidate_version_id),
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_candidate_versions_uidx ON public.teaching_assessment_candidate_versions(assessment_candidate_id,version_no);
CREATE INDEX IF NOT EXISTS teaching_assessment_candidate_versions_assessment_idx ON public.teaching_assessment_candidate_versions(student_id,assessment_id);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_validations (
  assessment_validation_id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  validation_scope text NOT NULL,
  candidate_version_id text NULL REFERENCES public.teaching_assessment_candidate_versions(candidate_version_id) ON DELETE CASCADE,
  package_id text NULL,
  validator_role text NOT NULL,
  prompt_family text NULL,
  prompt_version text NULL,
  outcome text NOT NULL,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_state_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  independent_from_generation boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_validations_idempotency_uidx ON public.teaching_assessment_validations(student_id,idempotency_key);
CREATE INDEX IF NOT EXISTS teaching_assessment_validations_assessment_idx ON public.teaching_assessment_validations(student_id,assessment_id,validation_scope,created_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_packages (
  assessment_package_id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  assessment_blueprint_id text NOT NULL REFERENCES public.teaching_assessment_blueprints(assessment_blueprint_id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  package_state text NOT NULL,
  package_hash text NULL,
  locked_at timestamptz NULL,
  locked_by text NULL,
  duration_minutes integer NOT NULL,
  timer_model text NOT NULL,
  response_form_architecture jsonb NOT NULL,
  resource_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  accommodation_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_state_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  invalidation_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_packages_version_uidx ON public.teaching_assessment_packages(assessment_id,version_no);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_packages_idempotency_uidx ON public.teaching_assessment_packages(student_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_packages_locked_hash_uidx ON public.teaching_assessment_packages(package_hash) WHERE package_state='LOCKED';

CREATE TABLE IF NOT EXISTS public.teaching_assessment_package_items (
  package_item_id text PRIMARY KEY,
  assessment_package_id text NOT NULL REFERENCES public.teaching_assessment_packages(assessment_package_id) ON DELETE CASCADE,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  slot_id text NOT NULL,
  candidate_version_id text NOT NULL REFERENCES public.teaching_assessment_candidate_versions(candidate_version_id) ON DELETE RESTRICT,
  response_family text NOT NULL,
  intended_marks numeric NOT NULL,
  public_item_payload jsonb NOT NULL,
  protected_marking_payload jsonb NOT NULL,
  demand_vector jsonb NOT NULL DEFAULT '{}'::jsonb,
  learning_unit_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  item_hash text NOT NULL,
  answer_exposed boolean NOT NULL DEFAULT false,
  item_state text NOT NULL DEFAULT 'ACTIVE',
  invalidation_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_package_items_ordinal_uidx ON public.teaching_assessment_package_items(assessment_package_id,ordinal);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_package_items_candidate_uidx ON public.teaching_assessment_package_items(assessment_package_id,candidate_version_id);

ALTER TABLE public.teaching_assessment_validations DROP CONSTRAINT IF EXISTS teaching_assessment_validations_package_id_fkey;
ALTER TABLE public.teaching_assessment_validations ADD CONSTRAINT teaching_assessment_validations_package_id_fkey FOREIGN KEY(package_id) REFERENCES public.teaching_assessment_packages(assessment_package_id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.teaching_assessment_attempts (
  assessment_attempt_id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  assessment_package_id text NOT NULL REFERENCES public.teaching_assessment_packages(assessment_package_id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL DEFAULT 1,
  attempt_state text NOT NULL,
  result_state text NOT NULL DEFAULT 'NOT_FINAL',
  active_device_id text NULL,
  device_session_hash text NOT NULL,
  started_at timestamptz NULL,
  expires_at timestamptz NULL,
  finalized_at timestamptz NULL,
  finalization_version bigint NOT NULL DEFAULT 0,
  final_snapshot_ref text NULL,
  final_snapshot jsonb NULL,
  permitted_resources_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  accommodation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version_at_start text NOT NULL,
  state_version bigint NOT NULL DEFAULT 1,
  invalidation_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_attempts_number_uidx ON public.teaching_assessment_attempts(assessment_id,student_id,attempt_no);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_attempts_one_active_uidx ON public.teaching_assessment_attempts(assessment_id,student_id) WHERE attempt_state='ACTIVE';
CREATE INDEX IF NOT EXISTS teaching_assessment_attempts_package_idx ON public.teaching_assessment_attempts(assessment_package_id);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_attempt_events (
  assessment_attempt_event_id text PRIMARY KEY,
  assessment_attempt_id text NOT NULL REFERENCES public.teaching_assessment_attempts(assessment_attempt_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_kind text NOT NULL,
  server_occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_version bigint NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_attempt_events_idempotency_uidx ON public.teaching_assessment_attempt_events(student_id,idempotency_key);
CREATE INDEX IF NOT EXISTS teaching_assessment_attempt_events_attempt_idx ON public.teaching_assessment_attempt_events(assessment_attempt_id,server_occurred_at);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_responses (
  assessment_response_id text PRIMARY KEY,
  assessment_attempt_id text NOT NULL REFERENCES public.teaching_assessment_attempts(assessment_attempt_id) ON DELETE CASCADE,
  package_item_id text NOT NULL REFERENCES public.teaching_assessment_package_items(package_item_id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  response_version integer NOT NULL,
  renderer_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_state text NOT NULL DEFAULT 'SAVED',
  accepted_at timestamptz NOT NULL,
  client_occurred_at timestamptz NULL,
  device_id text NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_responses_version_uidx ON public.teaching_assessment_responses(assessment_attempt_id,package_item_id,response_version);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_responses_idempotency_uidx ON public.teaching_assessment_responses(student_id,idempotency_key);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_item_challenges (
  item_challenge_id text PRIMARY KEY,
  assessment_attempt_id text NOT NULL REFERENCES public.teaching_assessment_attempts(assessment_attempt_id) ON DELETE CASCADE,
  package_item_id text NOT NULL REFERENCES public.teaching_assessment_package_items(package_item_id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  challenge_text text NOT NULL,
  challenge_state text NOT NULL DEFAULT 'OPEN',
  answer_revealed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  resolution jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_item_challenges_idempotency_uidx ON public.teaching_assessment_item_challenges(student_id,idempotency_key);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_invalidations (
  assessment_invalidation_id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  target_ref text NOT NULL,
  reason_code text NOT NULL,
  reason_text text NULL,
  student_penalty_allowed boolean NOT NULL DEFAULT false,
  repair_action jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_invalidations_idempotency_uidx ON public.teaching_assessment_invalidations(student_id,idempotency_key);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_contamination_events (
  contamination_event_id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  candidate_version_id text NOT NULL REFERENCES public.teaching_assessment_candidate_versions(candidate_version_id) ON DELETE CASCADE,
  exposure_kind text NOT NULL,
  source_ref text NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  selective_recheck_required boolean NOT NULL DEFAULT true,
  idempotency_key text NOT NULL,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_at timestamptz NULL,
  resolution_ref text NULL
);
ALTER TABLE public.teaching_assessment_contamination_events ADD COLUMN IF NOT EXISTS resolved_at timestamptz NULL;
ALTER TABLE public.teaching_assessment_contamination_events ADD COLUMN IF NOT EXISTS resolution_ref text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_contamination_idempotency_uidx ON public.teaching_assessment_contamination_events(student_id,idempotency_key);

CREATE TABLE IF NOT EXISTS public.teaching_assessment_ppl_workspaces (
  workspace_id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES public.teaching_assessments(assessment_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  lane text NOT NULL,
  maturity text NOT NULL,
  workspace_version bigint NOT NULL DEFAULT 1,
  authoritative_input_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  open_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  materiality_digest text NULL,
  route_posture text NULL,
  finalization_ready boolean NOT NULL DEFAULT false,
  finalization_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_assessment_ppl_lane_uidx ON public.teaching_assessment_ppl_workspaces(assessment_id,lane);

-- Canonical value/state guards. Existing provisional Integration tables are empty;
-- replace legacy pre-freeze checks explicitly because CREATE TABLE IF NOT EXISTS
-- cannot converge same-named constraints whose old vocabularies reject D17 runtime states.
ALTER TABLE public.teaching_assessments
  DROP CONSTRAINT IF EXISTS teaching_assessments_assessment_type_check,
  DROP CONSTRAINT IF EXISTS teaching_assessments_type_check,
  DROP CONSTRAINT IF EXISTS teaching_assessments_definition_state_check,
  DROP CONSTRAINT IF EXISTS teaching_assessments_check;
ALTER TABLE public.teaching_assessments
  ADD CONSTRAINT teaching_assessments_type_check CHECK (assessment_type IN ('DIAGNOSTIC','CLASSWORK','IMPROMPTU_TEST','SCHEDULED_TEST','MID_SEMESTER','FINAL_EXAMINATION','MAKE_UP','RESIT','VERIFICATION')),
  ADD CONSTRAINT teaching_assessments_definition_state_check CHECK (definition_state IN ('DRAFT','PLANNED','READY','CANCELLED','SUPERSEDED'));

ALTER TABLE public.teaching_assessment_blueprints
  DROP CONSTRAINT IF EXISTS teaching_assessment_blueprints_lane_check,
  DROP CONSTRAINT IF EXISTS teaching_assessment_blueprints_maturity_check,
  DROP CONSTRAINT IF EXISTS teaching_assessment_blueprints_timer_model_check;
ALTER TABLE public.teaching_assessment_blueprints
  ADD CONSTRAINT teaching_assessment_blueprints_lane_check CHECK (lane IN ('FORECAST_PLANNING','ELIGIBLE_CANDIDATE')),
  ADD CONSTRAINT teaching_assessment_blueprints_maturity_check CHECK (maturity IN ('SKELETON','STRUCTURED','CANDIDATE','PRE_LOCK_READY')),
  ADD CONSTRAINT teaching_assessment_blueprints_timer_model_check CHECK (timer_model IN ('OVERALL','PER_QUESTION_EXPLICIT_SKILL'));

ALTER TABLE public.teaching_assessment_eligibility_entries
  DROP CONSTRAINT IF EXISTS teaching_assessment_eligibility_entries_eligibility_basis_check,
  DROP CONSTRAINT IF EXISTS teaching_assessment_eligibility_entries_basis_check;
ALTER TABLE public.teaching_assessment_eligibility_entries
  ADD CONSTRAINT teaching_assessment_eligibility_entries_basis_check CHECK (eligibility_basis IN ('TAUGHT','VALIDATED_PRIOR_KNOWLEDGE','EXPLICIT_ASSUMED_PREREQUISITE'));

ALTER TABLE public.teaching_assessment_candidates
  DROP CONSTRAINT IF EXISTS teaching_assessment_candidates_candidate_state_check;
ALTER TABLE public.teaching_assessment_candidates
  ADD CONSTRAINT teaching_assessment_candidates_candidate_state_check CHECK (candidate_state IN ('GENERATED','VALIDATION_PENDING','VALIDATED','REPAIR_REQUIRED','REJECTED','RETIRED','CONTAMINATED'));

ALTER TABLE public.teaching_assessment_validations
  DROP CONSTRAINT IF EXISTS teaching_assessment_validations_outcome_check,
  DROP CONSTRAINT IF EXISTS teaching_assessment_validations_independent_check;
ALTER TABLE public.teaching_assessment_validations
  ADD CONSTRAINT teaching_assessment_validations_outcome_check CHECK (outcome IN ('PASS','FAIL','REPAIR','REVIEW_REQUIRED','STALE')),
  ADD CONSTRAINT teaching_assessment_validations_independent_check CHECK (independent_from_generation=true);

ALTER TABLE public.teaching_assessment_packages
  DROP CONSTRAINT IF EXISTS teaching_assessment_packages_package_state_check,
  DROP CONSTRAINT IF EXISTS teaching_assessment_packages_check,
  DROP CONSTRAINT IF EXISTS teaching_assessment_packages_locked_complete_check;
ALTER TABLE public.teaching_assessment_packages
  ADD CONSTRAINT teaching_assessment_packages_package_state_check CHECK (package_state IN ('ASSEMBLING','VALIDATED','LOCKED','INVALIDATED','SUPERSEDED')),
  ADD CONSTRAINT teaching_assessment_packages_locked_complete_check CHECK (package_state <> 'LOCKED' OR (locked_at IS NOT NULL AND package_hash IS NOT NULL));

ALTER TABLE public.teaching_assessment_attempts
  DROP CONSTRAINT IF EXISTS teaching_assessment_attempts_attempt_state_check,
  DROP CONSTRAINT IF EXISTS teaching_assessment_attempts_result_state_check;
ALTER TABLE public.teaching_assessment_attempts
  ADD CONSTRAINT teaching_assessment_attempts_attempt_state_check CHECK (attempt_state IN ('CREATED','ACTIVE','SUBMITTED','EXPIRED','INVALIDATED','CANCELLED')),
  ADD CONSTRAINT teaching_assessment_attempts_result_state_check CHECK (result_state IN ('NOT_FINAL','AWAITING_MARKING','INVALIDATED','VOID'));

ALTER TABLE public.teaching_assessment_package_items
  DROP CONSTRAINT IF EXISTS teaching_assessment_package_items_item_state_check;
ALTER TABLE public.teaching_assessment_package_items
  ADD CONSTRAINT teaching_assessment_package_items_item_state_check CHECK (item_state IN ('ACTIVE','INVALIDATED','RETIRED_AS_CLEAN_EVIDENCE'));

-- The abandoned Integration prototype constrained contamination.action to an
-- obsolete vocabulary. Canonical D17 keeps action as auditable governed text;
-- service behavior currently emits RETIRE_AND_RECHECK.
ALTER TABLE public.teaching_assessment_contamination_events
  DROP CONSTRAINT IF EXISTS teaching_assessment_contamination_events_action_check;

ALTER TABLE public.teaching_assessment_invalidations
  DROP CONSTRAINT IF EXISTS teaching_assessment_invalidations_student_penalty_allowed_check,
  DROP CONSTRAINT IF EXISTS teaching_assessment_invalidations_no_penalty_check;
ALTER TABLE public.teaching_assessment_invalidations
  ADD CONSTRAINT teaching_assessment_invalidations_no_penalty_check CHECK (student_penalty_allowed=false);

-- Remove abandoned pre-freeze D17 package guards before installing the canonical freeze model.
-- These prototype triggers conflict with the canonical ASSEMBLING -> LOCKED transaction and
-- their functions also lack a fixed search_path.
DROP TRIGGER IF EXISTS teaching_d17_locked_package_update_guard ON public.teaching_assessment_packages;
DROP TRIGGER IF EXISTS teaching_d17_package_item_insert_guard ON public.teaching_assessment_package_items;
DROP TRIGGER IF EXISTS teaching_d17_package_item_update_guard ON public.teaching_assessment_package_items;
DROP TRIGGER IF EXISTS teaching_d17_package_item_delete_guard ON public.teaching_assessment_package_items;
DROP FUNCTION IF EXISTS public.teaching_d17_guard_locked_package_update();
DROP FUNCTION IF EXISTS public.teaching_d17_guard_package_item_mutation();

CREATE OR REPLACE FUNCTION public.teaching_d17_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION 'D17 append-only academic evidence cannot be mutated';
END $$;

CREATE OR REPLACE FUNCTION public.teaching_d17_guard_locked_package()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.package_state='LOCKED' AND NEW.package_state NOT IN ('LOCKED','INVALIDATED','SUPERSEDED') THEN
    RAISE EXCEPTION 'Locked Assessment Package cannot return to a mutable state';
  END IF;
  IF OLD.package_state IN ('INVALIDATED','SUPERSEDED') AND NEW.package_state IS DISTINCT FROM OLD.package_state THEN
    RAISE EXCEPTION 'Terminal Assessment Package state is immutable';
  END IF;
  IF OLD.package_state IN ('LOCKED','INVALIDATED','SUPERSEDED') AND (
    NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR
    NEW.assessment_blueprint_id IS DISTINCT FROM OLD.assessment_blueprint_id OR
    NEW.version_no IS DISTINCT FROM OLD.version_no OR
    NEW.package_hash IS DISTINCT FROM OLD.package_hash OR
    NEW.locked_at IS DISTINCT FROM OLD.locked_at OR
    NEW.locked_by IS DISTINCT FROM OLD.locked_by OR
    NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes OR
    NEW.timer_model IS DISTINCT FROM OLD.timer_model OR
    NEW.response_form_architecture IS DISTINCT FROM OLD.response_form_architecture OR
    NEW.resource_policy IS DISTINCT FROM OLD.resource_policy OR
    NEW.accommodation_policy IS DISTINCT FROM OLD.accommodation_policy OR
    NEW.policy_snapshot IS DISTINCT FROM OLD.policy_snapshot OR
    NEW.validation_summary IS DISTINCT FROM OLD.validation_summary OR
    NEW.source_state_versions IS DISTINCT FROM OLD.source_state_versions
  ) THEN RAISE EXCEPTION 'Locked Assessment Package is immutable'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.teaching_d17_guard_contamination_resolution()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.contamination_event_id IS DISTINCT FROM OLD.contamination_event_id OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.candidate_version_id IS DISTINCT FROM OLD.candidate_version_id OR NEW.exposure_kind IS DISTINCT FROM OLD.exposure_kind OR NEW.source_ref IS DISTINCT FROM OLD.source_ref OR NEW.detected_at IS DISTINCT FROM OLD.detected_at OR NEW.action IS DISTINCT FROM OLD.action OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.provenance_refs IS DISTINCT FROM OLD.provenance_refs THEN RAISE EXCEPTION 'Contamination evidence is immutable'; END IF;
  IF OLD.selective_recheck_required=false AND NEW.selective_recheck_required=true THEN RAISE EXCEPTION 'Resolved contamination cannot be reopened by mutation'; END IF;
  IF OLD.selective_recheck_required=true AND NEW.selective_recheck_required=false AND (NEW.resolved_at IS NULL OR NEW.resolution_ref IS NULL) THEN RAISE EXCEPTION 'Contamination resolution requires timestamp and resolution reference'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.teaching_d17_guard_locked_package_item()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE package_id text; frozen boolean;
BEGIN
  IF TG_OP='INSERT' THEN package_id := NEW.assessment_package_id; ELSE package_id := OLD.assessment_package_id; END IF;
  SELECT package_state IN ('LOCKED','INVALIDATED','SUPERSEDED') INTO frozen FROM public.teaching_assessment_packages WHERE assessment_package_id=package_id;
  IF frozen THEN
    IF TG_OP IN ('INSERT','DELETE') THEN RAISE EXCEPTION 'Locked Assessment Package item membership is immutable'; END IF;
    IF NEW.assessment_package_id IS DISTINCT FROM OLD.assessment_package_id OR
       NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR
       NEW.student_id IS DISTINCT FROM OLD.student_id OR
       NEW.ordinal IS DISTINCT FROM OLD.ordinal OR
       NEW.slot_id IS DISTINCT FROM OLD.slot_id OR
       NEW.candidate_version_id IS DISTINCT FROM OLD.candidate_version_id OR
       NEW.response_family IS DISTINCT FROM OLD.response_family OR
       NEW.intended_marks IS DISTINCT FROM OLD.intended_marks OR
       NEW.public_item_payload IS DISTINCT FROM OLD.public_item_payload OR
       NEW.protected_marking_payload IS DISTINCT FROM OLD.protected_marking_payload OR
       NEW.demand_vector IS DISTINCT FROM OLD.demand_vector OR
       NEW.learning_unit_ids IS DISTINCT FROM OLD.learning_unit_ids OR
       NEW.item_hash IS DISTINCT FROM OLD.item_hash THEN
      RAISE EXCEPTION 'Locked Assessment Package item content is immutable';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS teaching_d17_blueprints_append_only ON public.teaching_assessment_blueprints;
CREATE TRIGGER teaching_d17_blueprints_append_only BEFORE UPDATE OR DELETE ON public.teaching_assessment_blueprints FOR EACH ROW EXECUTE FUNCTION public.teaching_d17_reject_append_only_mutation();
DROP TRIGGER IF EXISTS teaching_d17_candidate_versions_append_only ON public.teaching_assessment_candidate_versions;
CREATE TRIGGER teaching_d17_candidate_versions_append_only BEFORE UPDATE OR DELETE ON public.teaching_assessment_candidate_versions FOR EACH ROW EXECUTE FUNCTION public.teaching_d17_reject_append_only_mutation();
DROP TRIGGER IF EXISTS teaching_d17_validations_append_only ON public.teaching_assessment_validations;
CREATE TRIGGER teaching_d17_validations_append_only BEFORE UPDATE OR DELETE ON public.teaching_assessment_validations FOR EACH ROW EXECUTE FUNCTION public.teaching_d17_reject_append_only_mutation();
DROP TRIGGER IF EXISTS teaching_d17_responses_append_only ON public.teaching_assessment_responses;
CREATE TRIGGER teaching_d17_responses_append_only BEFORE UPDATE OR DELETE ON public.teaching_assessment_responses FOR EACH ROW EXECUTE FUNCTION public.teaching_d17_reject_append_only_mutation();
DROP TRIGGER IF EXISTS teaching_d17_attempt_events_append_only ON public.teaching_assessment_attempt_events;
CREATE TRIGGER teaching_d17_attempt_events_append_only BEFORE UPDATE OR DELETE ON public.teaching_assessment_attempt_events FOR EACH ROW EXECUTE FUNCTION public.teaching_d17_reject_append_only_mutation();
DROP TRIGGER IF EXISTS teaching_d17_contamination_resolution_guard ON public.teaching_assessment_contamination_events;
CREATE TRIGGER teaching_d17_contamination_resolution_guard BEFORE UPDATE ON public.teaching_assessment_contamination_events FOR EACH ROW EXECUTE FUNCTION public.teaching_d17_guard_contamination_resolution();
DROP TRIGGER IF EXISTS teaching_d17_locked_package_guard ON public.teaching_assessment_packages;
CREATE TRIGGER teaching_d17_locked_package_guard BEFORE UPDATE ON public.teaching_assessment_packages FOR EACH ROW EXECUTE FUNCTION public.teaching_d17_guard_locked_package();
DROP TRIGGER IF EXISTS teaching_d17_locked_package_item_guard ON public.teaching_assessment_package_items;
CREATE TRIGGER teaching_d17_locked_package_item_guard BEFORE INSERT OR UPDATE OR DELETE ON public.teaching_assessment_package_items FOR EACH ROW EXECUTE FUNCTION public.teaching_d17_guard_locked_package_item();

-- Server-only authority. Browser reads/writes occur through authenticated API projections.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'teaching_assessments','teaching_assessment_blueprints','teaching_assessment_eligibility_entries',
    'teaching_assessment_candidates','teaching_assessment_candidate_versions','teaching_assessment_validations',
    'teaching_assessment_packages','teaching_assessment_package_items','teaching_assessment_attempts',
    'teaching_assessment_attempt_events','teaching_assessment_responses','teaching_assessment_item_challenges',
    'teaching_assessment_invalidations','teaching_assessment_contamination_events','teaching_assessment_ppl_workspaces'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated, public',t);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO service_role',t);
  END LOOP;
END $$;
GRANT UPDATE ON public.teaching_assessments,public.teaching_assessment_candidates,public.teaching_assessment_packages,public.teaching_assessment_package_items,public.teaching_assessment_attempts,public.teaching_assessment_item_challenges,public.teaching_assessment_ppl_workspaces TO service_role;
REVOKE UPDATE,DELETE,TRUNCATE ON public.teaching_assessment_blueprints,public.teaching_assessment_eligibility_entries,public.teaching_assessment_candidate_versions,public.teaching_assessment_validations,public.teaching_assessment_attempt_events,public.teaching_assessment_responses,public.teaching_assessment_invalidations FROM service_role;
GRANT UPDATE ON public.teaching_assessment_contamination_events TO service_role;

COMMIT;
