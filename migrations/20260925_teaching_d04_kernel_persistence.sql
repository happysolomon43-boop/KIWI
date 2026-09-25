-- KIWI Teaching D04 — Kernel Persistence, Security & Auditability
-- Exact delivery scope only: TCH-0035,0036,0038-0047,0061-0062,0064-0068,0070,
-- TCH-0684-0690,0875-0878. D05+ behavior is intentionally not implemented.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='teaching_domain_service') THEN
    CREATE ROLE teaching_domain_service NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='teaching_protected_service') THEN
    CREATE ROLE teaching_protected_service NOLOGIN;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.teaching_reject_immutable_row_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; create a new version/event instead', TG_TABLE_NAME
    USING ERRCODE='55000';
END $$;

CREATE OR REPLACE FUNCTION public.teaching_assert_course_subject_owner()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE owner_id text;
BEGIN
  SELECT user_id INTO owner_id FROM public.subjects WHERE id=NEW.subject_id;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Teaching Course subject % does not exist', NEW.subject_id USING ERRCODE='23503';
  END IF;
  IF owner_id IS DISTINCT FROM NEW.student_id THEN
    RAISE EXCEPTION 'Teaching Course subject owner does not match student owner' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE public.teaching_semesters (
  semester_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name))>0),
  starts_at timestamptz, ends_at timestamptz, timezone text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
);

CREATE TABLE public.teaching_courses (
  course_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  semester_id text NOT NULL REFERENCES public.teaching_semesters(semester_id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title))>0),
  lifecycle_state text NOT NULL DEFAULT 'DRAFT',
  subject_snapshot_ref text, source_version_ref text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER teaching_course_subject_owner_guard
BEFORE INSERT OR UPDATE OF subject_id,student_id ON public.teaching_courses
FOR EACH ROW EXECUTE FUNCTION public.teaching_assert_course_subject_owner();

CREATE TABLE public.teaching_course_plans (
  course_plan_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no>=1),
  plan_state text NOT NULL DEFAULT 'DRAFT',
  scope_checksum text, source_snapshot_ref text,
  generation_provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(generation_provenance)='object'),
  supersedes_course_plan_id text REFERENCES public.teaching_course_plans(course_plan_id) DEFERRABLE INITIALLY DEFERRED,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id,version_no)
);

CREATE TABLE public.teaching_topics (
  topic_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title))>0), ordinal integer NOT NULL CHECK (ordinal>=0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  UNIQUE(course_plan_id,ordinal)
);

CREATE TABLE public.teaching_subtopics (
  subtopic_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  topic_id text NOT NULL REFERENCES public.teaching_topics(topic_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title))>0), ordinal integer NOT NULL CHECK (ordinal>=0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  UNIQUE(topic_id,ordinal)
);

CREATE TABLE public.teaching_learning_units (
  learning_unit_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE CASCADE,
  topic_id text NOT NULL REFERENCES public.teaching_topics(topic_id) ON DELETE CASCADE,
  subtopic_id text REFERENCES public.teaching_subtopics(subtopic_id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(btrim(title))>0),
  intended_competence text NOT NULL CHECK (length(btrim(intended_competence))>0),
  exit_conditions jsonb NOT NULL CHECK (jsonb_typeof(exit_conditions) IN ('array','object')),
  criticality text NOT NULL CHECK (length(btrim(criticality))>0), foundational boolean NOT NULL DEFAULT false,
  instructional_load_min_minutes integer CHECK (instructional_load_min_minutes IS NULL OR instructional_load_min_minutes>=0),
  instructional_load_max_minutes integer CHECK (instructional_load_max_minutes IS NULL OR instructional_load_max_minutes>=0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (instructional_load_max_minutes IS NULL OR instructional_load_min_minutes IS NULL OR instructional_load_max_minutes>=instructional_load_min_minutes)
);

CREATE TABLE public.teaching_learning_unit_dependencies (
  dependency_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE CASCADE,
  prerequisite_learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE CASCADE,
  dependency_kind text NOT NULL DEFAULT 'PREREQUISITE', rationale text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(learning_unit_id,prerequisite_learning_unit_id,dependency_kind),
  CHECK (learning_unit_id<>prerequisite_learning_unit_id)
);

CREATE TABLE public.teaching_learning_unit_lineage (
  lineage_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  predecessor_learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  successor_learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  lineage_kind text NOT NULL CHECK (lineage_kind IN ('SPLIT','MERGE','REPLACED','REFINED')),
  course_plan_version_ref text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(predecessor_learning_unit_id,successor_learning_unit_id,lineage_kind),
  CHECK (predecessor_learning_unit_id<>successor_learning_unit_id)
);

CREATE TABLE public.teaching_classes (
  class_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  scheduled_start_at timestamptz NOT NULL, scheduled_end_at timestamptz NOT NULL, timezone text NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'SCHEDULED', schedule_version bigint NOT NULL DEFAULT 1 CHECK (schedule_version>=1),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_end_at>scheduled_start_at)
);
CREATE INDEX teaching_classes_due_idx ON public.teaching_classes(student_id,scheduled_start_at,lifecycle_state);

CREATE TABLE public.teaching_lesson_blueprints (
  lesson_blueprint_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no>=1), objective_summary text NOT NULL,
  planned_learning_unit_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(planned_learning_unit_refs)='array'),
  planned_segments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(planned_segments)='array'),
  preparation_ref text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(class_id,version_no)
);

CREATE TABLE public.teaching_class_sessions (
  class_session_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
  lesson_blueprint_id text REFERENCES public.teaching_lesson_blueprints(lesson_blueprint_id) ON DELETE SET NULL,
  lifecycle_state text NOT NULL, instructional_substate text, state_version bigint NOT NULL DEFAULT 0 CHECK (state_version>=0),
  started_at timestamptz, ended_at timestamptz,
  interruption_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(interruption_metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at>=started_at)
);

CREATE TABLE public.teaching_board_scenes (
  board_scene_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal>=0), scene_type text NOT NULL, title text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(class_session_id,ordinal)
);

CREATE TABLE public.teaching_board_items (
  board_item_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  board_scene_id text NOT NULL REFERENCES public.teaching_board_scenes(board_scene_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal>=0), block_type text NOT NULL,
  content jsonb NOT NULL, provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(board_scene_id,ordinal)
);

CREATE TABLE public.teaching_student_responses (
  response_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE CASCADE,
  board_item_id text REFERENCES public.teaching_board_items(board_item_id) ON DELETE SET NULL,
  response_kind text NOT NULL, response_payload jsonb NOT NULL, submitted_at timestamptz NOT NULL,
  server_received_at timestamptz NOT NULL DEFAULT now(),
  assistance_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(assistance_context)='object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance)='object')
);

CREATE TABLE public.teaching_evidence_events (
  evidence_event_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  class_session_id text REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE SET NULL,
  source_response_id text REFERENCES public.teaching_student_responses(response_id) ON DELETE SET NULL,
  evidence_kind text NOT NULL, evidence_purpose text NOT NULL, formal_assessment boolean NOT NULL DEFAULT false,
  independent_performance boolean, assistance_level text,
  response_quality jsonb NOT NULL DEFAULT '{}'::jsonb, difficulty_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  novelty_context jsonb NOT NULL DEFAULT '{}'::jsonb, observed_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb, occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.teaching_evidence_event_learning_units (
  evidence_event_id text NOT NULL REFERENCES public.teaching_evidence_events(evidence_event_id) ON DELETE CASCADE,
  learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  evidence_role text NOT NULL DEFAULT 'PRIMARY',
  PRIMARY KEY(evidence_event_id,learning_unit_id,evidence_role)
);

CREATE TABLE public.teaching_teacher_identities (
  teacher_identity_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(btrim(display_name))>0),
  identity_profile jsonb NOT NULL DEFAULT '{}'::jsonb, personality_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  style_envelope_version text, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.teaching_interaction_preferences (
  interaction_preference_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  teacher_identity_id text REFERENCES public.teaching_teacher_identities(teacher_identity_id) ON DELETE SET NULL,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preferences)='object'),
  source text NOT NULL, effective_at timestamptz NOT NULL DEFAULT now(), superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.teaching_student_course_intakes (
  intake_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  original_free_form_text text,
  learning_preferences jsonb NOT NULL DEFAULT '[]'::jsonb,
  reported_strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  reported_weaknesses jsonb NOT NULL DEFAULT '[]'::jsonb,
  goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  important_deadlines jsonb NOT NULL DEFAULT '[]'::jsonb,
  other_course_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.teaching_student_course_intake_extractions (
  extraction_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  intake_id text NOT NULL REFERENCES public.teaching_student_course_intakes(intake_id) ON DELETE CASCADE,
  extractor_capability_id text NOT NULL, extractor_contract_version text NOT NULL,
  structured_signals jsonb NOT NULL CHECK (jsonb_typeof(structured_signals)='object'),
  uncertainty jsonb NOT NULL DEFAULT '{}'::jsonb, provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.teaching_source_content_items (
  source_content_item_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  source_kind text NOT NULL, source_ref text NOT NULL, source_version_ref text,
  locator jsonb NOT NULL DEFAULT '{}'::jsonb, content_hash text NOT NULL, content_summary text,
  academically_meaningful boolean, classification text, classification_reason text, classifier_rule_version text,
  discovered_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id,source_kind,source_ref,content_hash)
);

CREATE TABLE public.teaching_course_coverage (
  coverage_entry_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE CASCADE,
  source_content_item_id text NOT NULL REFERENCES public.teaching_source_content_items(source_content_item_id) ON DELETE CASCADE,
  topic_id text REFERENCES public.teaching_topics(topic_id) ON DELETE SET NULL,
  subtopic_id text REFERENCES public.teaching_subtopics(subtopic_id) ON DELETE SET NULL,
  learning_unit_id text REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE SET NULL,
  found_at timestamptz NOT NULL, mapped_at timestamptz, planned_at timestamptz, taught_at timestamptz,
  validated_prior_knowledge_at timestamptz, instructionally_complete_at timestamptz, assessed_at timestamptz,
  excluded_at timestamptz, exclusion_reason text,
  instructional_completion_basis text CHECK (instructional_completion_basis IS NULL OR instructional_completion_basis IN ('TAUGHT','VALIDATED_PRIOR_KNOWLEDGE')),
  coverage_version bigint NOT NULL DEFAULT 1 CHECK (coverage_version>=1), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_plan_id,source_content_item_id),
  CHECK (excluded_at IS NULL OR length(btrim(coalesce(exclusion_reason,'')))>0),
  CHECK (instructionally_complete_at IS NULL OR instructional_completion_basis IS NOT NULL)
);
CREATE INDEX teaching_course_coverage_course_idx ON public.teaching_course_coverage(student_id,course_id,course_plan_id);

CREATE TABLE public.teaching_assessment_eligibility (
  eligibility_entry_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE CASCADE,
  learning_unit_id text REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE CASCADE,
  source_content_item_id text REFERENCES public.teaching_source_content_items(source_content_item_id) ON DELETE CASCADE,
  eligible boolean NOT NULL, reason_code text NOT NULL, reason_detail text, rule_version text NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb, effective_from timestamptz NOT NULL, effective_to timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (learning_unit_id IS NOT NULL OR source_content_item_id IS NOT NULL),
  CHECK (effective_to IS NULL OR effective_to>effective_from)
);
CREATE INDEX teaching_assessment_eligibility_current_idx
ON public.teaching_assessment_eligibility(student_id,course_id,effective_from DESC) WHERE effective_to IS NULL;

CREATE TABLE public.teaching_academic_audit_log (
  audit_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL, actor_type text NOT NULL, actor_id text, action text NOT NULL,
  entity_type text NOT NULL, entity_id text NOT NULL, authoritative_owner text NOT NULL,
  state_version_ref text, correlation_id text, causation_id text, reason text,
  before_ref jsonb NOT NULL DEFAULT '{}'::jsonb, after_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb, safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER teaching_academic_audit_immutable
BEFORE UPDATE OR DELETE ON public.teaching_academic_audit_log
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

CREATE SCHEMA teaching_preparation;
CREATE SCHEMA teaching_protected;
REVOKE ALL ON SCHEMA teaching_preparation FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA teaching_protected FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA teaching_preparation TO service_role,teaching_domain_service,teaching_protected_service;
GRANT USAGE ON SCHEMA teaching_protected TO service_role,teaching_protected_service;

CREATE TABLE teaching_preparation.workspaces (
  workspace_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_type text NOT NULL, target_kind text NOT NULL, target_ref text NOT NULL,
  authoritative_owner_ref text NOT NULL, preparation_profile_ref text NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_state IN ('ACTIVE','FINALIZATION_DUE','FINALIZED','HANDED_OFF','SUPERSEDED','CANCELLED')),
  maturity_stage text NOT NULL DEFAULT 'SKELETON' CHECK (maturity_stage IN ('SKELETON','STRUCTURED','CANDIDATE','PRE_LOCK_READY')),
  state_version bigint NOT NULL DEFAULT 0 CHECK (state_version>=0),
  target_effective_at timestamptz, finalization_or_freeze_at timestamptz,
  current_authoritative_input_bundle_ref text, current_forecast_context_ref text, current_artifact_version_ref text,
  protected_content_class text NOT NULL CHECK (length(btrim(protected_content_class))>0),
  last_material_review_at timestamptz, next_review_due_at timestamptz, trigger_policy_ref text,
  cost_execution_budget_ref text, superseded_by_workspace_id text, supersedes_workspace_id text,
  cancellation_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teaching_preparation.authoritative_input_bundles (
  input_bundle_id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES teaching_preparation.workspaces(workspace_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  bundle_version bigint NOT NULL CHECK (bundle_version>=1), captured_at timestamptz NOT NULL,
  authoritative_refs jsonb NOT NULL CHECK (jsonb_typeof(authoritative_refs)='array'),
  preconditions jsonb NOT NULL DEFAULT '{}'::jsonb, material_delta_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,bundle_version)
);

CREATE TABLE teaching_preparation.input_bundle_dependencies (
  input_dependency_id text PRIMARY KEY,
  input_bundle_id text NOT NULL REFERENCES teaching_preparation.authoritative_input_bundles(input_bundle_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dependency_kind text NOT NULL, authoritative_owner_ref text NOT NULL, aggregate_ref text NOT NULL,
  version_ref text NOT NULL, component_scope_key text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teaching_preparation.artifact_versions (
  artifact_version_id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES teaching_preparation.workspaces(workspace_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  artifact_kind text NOT NULL, version_no bigint NOT NULL CHECK (version_no>=1),
  input_bundle_id text NOT NULL REFERENCES teaching_preparation.authoritative_input_bundles(input_bundle_id) ON DELETE RESTRICT,
  parent_artifact_version_id text REFERENCES teaching_preparation.artifact_versions(artifact_version_id) DEFERRABLE INITIALLY DEFERRED,
  created_by_capability_id text NOT NULL, prompt_family_ref text, schema_version text NOT NULL,
  artifact_digest text NOT NULL, protected_content_class text NOT NULL CHECK (length(btrim(protected_content_class))>0),
  validity_state text NOT NULL DEFAULT 'CURRENT' CHECK (validity_state IN ('CURRENT','PARTIALLY_STALE','STALE','SUPERSEDED','RETIRED_CONTAMINATED')),
  concise_rationale text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,version_no)
);

ALTER TABLE teaching_preparation.workspaces
  ADD CONSTRAINT teaching_workspace_current_bundle_fk FOREIGN KEY(current_authoritative_input_bundle_ref)
  REFERENCES teaching_preparation.authoritative_input_bundles(input_bundle_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE teaching_preparation.workspaces
  ADD CONSTRAINT teaching_workspace_current_artifact_fk FOREIGN KEY(current_artifact_version_ref)
  REFERENCES teaching_preparation.artifact_versions(artifact_version_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE teaching_preparation.workspaces
  ADD CONSTRAINT teaching_workspace_superseded_by_fk FOREIGN KEY(superseded_by_workspace_id)
  REFERENCES teaching_preparation.workspaces(workspace_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE teaching_preparation.workspaces
  ADD CONSTRAINT teaching_workspace_supersedes_fk FOREIGN KEY(supersedes_workspace_id)
  REFERENCES teaching_preparation.workspaces(workspace_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE teaching_preparation.artifact_components (
  artifact_component_id text PRIMARY KEY,
  artifact_version_id text NOT NULL REFERENCES teaching_preparation.artifact_versions(artifact_version_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  component_key text NOT NULL, component_kind text NOT NULL, component_digest text,
  stale boolean NOT NULL DEFAULT false, stale_reason text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(artifact_version_id,component_key)
);

CREATE TABLE teaching_preparation.component_dependencies (
  component_dependency_id text PRIMARY KEY,
  artifact_component_id text NOT NULL REFERENCES teaching_preparation.artifact_components(artifact_component_id) ON DELETE CASCADE,
  input_dependency_id text NOT NULL REFERENCES teaching_preparation.input_bundle_dependencies(input_dependency_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dependency_role text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(artifact_component_id,input_dependency_id,dependency_role)
);

CREATE TABLE teaching_preparation.artifact_lineage (
  artifact_lineage_id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES teaching_preparation.workspaces(workspace_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  predecessor_artifact_version_id text NOT NULL REFERENCES teaching_preparation.artifact_versions(artifact_version_id) ON DELETE RESTRICT,
  successor_artifact_version_id text NOT NULL REFERENCES teaching_preparation.artifact_versions(artifact_version_id) ON DELETE RESTRICT,
  lineage_kind text NOT NULL CHECK (lineage_kind IN ('REFINEMENT','REPAIR','REPLACEMENT','ALTERNATIVE_CANDIDATE','MATERIAL_RECONCILIATION')),
  reason text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(predecessor_artifact_version_id,successor_artifact_version_id,lineage_kind),
  CHECK (predecessor_artifact_version_id<>successor_artifact_version_id)
);

CREATE TABLE teaching_preparation.workspace_candidates (
  workspace_id text NOT NULL REFERENCES teaching_preparation.workspaces(workspace_id) ON DELETE CASCADE,
  artifact_version_id text NOT NULL REFERENCES teaching_preparation.artifact_versions(artifact_version_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  candidate_status text NOT NULL DEFAULT 'ACTIVE' CHECK (candidate_status IN ('ACTIVE','SELECTED','REJECTED','RETIRED','CONTAMINATED')),
  added_at timestamptz NOT NULL DEFAULT now(), retired_at timestamptz,
  PRIMARY KEY(workspace_id,artifact_version_id)
);

CREATE TABLE teaching_preparation.review_findings (
  finding_id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES teaching_preparation.workspaces(workspace_id) ON DELETE CASCADE,
  artifact_version_id text NOT NULL REFERENCES teaching_preparation.artifact_versions(artifact_version_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  finding_type text NOT NULL, severity text NOT NULL, short_explanation text NOT NULL CHECK (length(btrim(short_explanation))>0),
  required_action text, status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','ACCEPTED_RISK','OBSOLETE')),
  resolved_in_artifact_version_id text REFERENCES teaching_preparation.artifact_versions(artifact_version_id) ON DELETE SET NULL,
  recurrence_guard_key text, created_by_capability_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  CHECK ((status='RESOLVED')=(resolved_in_artifact_version_id IS NOT NULL))
);

CREATE TABLE teaching_preparation.finding_component_refs (
  finding_id text NOT NULL REFERENCES teaching_preparation.review_findings(finding_id) ON DELETE CASCADE,
  artifact_component_id text NOT NULL REFERENCES teaching_preparation.artifact_components(artifact_component_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY(finding_id,artifact_component_id)
);

CREATE TABLE teaching_preparation.finding_evidence_rule_refs (
  finding_ref_id text PRIMARY KEY, finding_id text NOT NULL REFERENCES teaching_preparation.review_findings(finding_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ref_kind text NOT NULL CHECK (ref_kind IN ('EVIDENCE','RULE','PROVENANCE','POLICY','VALIDATION')),
  ref_value text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teaching_protected.prepared_artifact_payloads (
  artifact_version_id text PRIMARY KEY REFERENCES teaching_preparation.artifact_versions(artifact_version_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  protected_content_class text NOT NULL CHECK (length(btrim(protected_content_class))>0),
  payload_schema_version text NOT NULL, payload jsonb NOT NULL, payload_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX teaching_preparation_workspace_target_idx
ON teaching_preparation.workspaces(target_kind,target_ref,lifecycle_state);
CREATE INDEX teaching_preparation_review_due_idx
ON teaching_preparation.workspaces(next_review_due_at) WHERE lifecycle_state IN ('ACTIVE','FINALIZATION_DUE');
CREATE INDEX teaching_preparation_findings_open_idx
ON teaching_preparation.review_findings(workspace_id,status,severity);

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_student_responses','teaching_evidence_events','teaching_evidence_event_learning_units',
    'teaching_student_course_intakes','teaching_student_course_intake_extractions','teaching_learning_unit_lineage'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation()', rel||'_immutable', rel);
  END LOOP;
  FOREACH rel IN ARRAY ARRAY[
    'authoritative_input_bundles','input_bundle_dependencies','component_dependencies',
    'artifact_lineage','finding_component_refs','finding_evidence_rule_refs'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON teaching_preparation.%I FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation()', rel||'_immutable', rel);
  END LOOP;
END $$;
CREATE TRIGGER teaching_protected_payload_immutable
BEFORE UPDATE OR DELETE ON teaching_protected.prepared_artifact_payloads
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_semesters','teaching_courses','teaching_course_plans','teaching_topics','teaching_subtopics',
    'teaching_learning_units','teaching_learning_unit_dependencies','teaching_learning_unit_lineage',
    'teaching_classes','teaching_lesson_blueprints','teaching_class_sessions','teaching_board_scenes',
    'teaching_board_items','teaching_student_responses','teaching_evidence_events','teaching_evidence_event_learning_units',
    'teaching_teacher_identities','teaching_interaction_preferences','teaching_student_course_intakes',
    'teaching_student_course_intake_extractions','teaching_source_content_items','teaching_course_coverage',
    'teaching_assessment_eligibility','teaching_academic_audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service', rel);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated,service_role,teaching_domain_service', rel);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((select auth.uid())::text=student_id)', rel||'_student_select', rel);
  END LOOP;
END $$;

GRANT INSERT,UPDATE ON
  public.teaching_semesters,public.teaching_courses,public.teaching_course_plans,
  public.teaching_topics,public.teaching_subtopics,public.teaching_learning_units,
  public.teaching_learning_unit_dependencies,public.teaching_classes,public.teaching_lesson_blueprints,
  public.teaching_class_sessions,public.teaching_board_scenes,public.teaching_board_items,
  public.teaching_teacher_identities,public.teaching_interaction_preferences,
  public.teaching_source_content_items,public.teaching_course_coverage,public.teaching_assessment_eligibility
TO service_role,teaching_domain_service;

GRANT INSERT ON
  public.teaching_learning_unit_lineage,public.teaching_student_responses,
  public.teaching_evidence_events,public.teaching_evidence_event_learning_units,
  public.teaching_student_course_intakes,public.teaching_student_course_intake_extractions,
  public.teaching_academic_audit_log
TO service_role,teaching_domain_service;

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'workspaces','authoritative_input_bundles','input_bundle_dependencies','artifact_versions',
    'artifact_components','component_dependencies','artifact_lineage','workspace_candidates',
    'review_findings','finding_component_refs','finding_evidence_rule_refs'
  ] LOOP
    EXECUTE format('ALTER TABLE teaching_preparation.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON TABLE teaching_preparation.%I FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service,teaching_protected_service', rel);
    EXECUTE format('GRANT SELECT ON TABLE teaching_preparation.%I TO service_role,teaching_domain_service,teaching_protected_service', rel);
  END LOOP;
END $$;

GRANT INSERT,UPDATE ON
  teaching_preparation.workspaces,teaching_preparation.artifact_versions,
  teaching_preparation.artifact_components,teaching_preparation.workspace_candidates,
  teaching_preparation.review_findings
TO service_role,teaching_domain_service,teaching_protected_service;

GRANT INSERT ON
  teaching_preparation.authoritative_input_bundles,teaching_preparation.input_bundle_dependencies,
  teaching_preparation.component_dependencies,teaching_preparation.artifact_lineage,
  teaching_preparation.finding_component_refs,teaching_preparation.finding_evidence_rule_refs
TO service_role,teaching_domain_service,teaching_protected_service;

ALTER TABLE teaching_protected.prepared_artifact_payloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE teaching_protected.prepared_artifact_payloads FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service,teaching_protected_service;
GRANT SELECT,INSERT ON TABLE teaching_protected.prepared_artifact_payloads TO service_role,teaching_protected_service;

ALTER DEFAULT PRIVILEGES IN SCHEMA teaching_preparation REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA teaching_protected REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;

COMMIT;

-- Recovery is documented in docs/teaching/migrations/d04-recovery.md.
-- Never recover by granting browser writes or exposing teaching_protected.
