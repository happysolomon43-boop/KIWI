-- KIWI Teaching D13 — Student Knowledge Model
-- Exact delivery scope: TCH-0048, TCH-0049, TCH-0216–TCH-0237, TCH-0764.
-- Extends the D04 Evidence Event owner; does not create a second evidence truth.
-- Gradebook and Progression remain separate authoritative domains.

BEGIN;

ALTER TABLE public.teaching_evidence_events
  ADD COLUMN IF NOT EXISTS source_interpretation_ref text,
  ADD COLUMN IF NOT EXISTS source_owner text,
  ADD COLUMN IF NOT EXISTS task_ref text,
  ADD COLUMN IF NOT EXISTS evidence_claim text,
  ADD COLUMN IF NOT EXISTS demand_vector jsonb,
  ADD COLUMN IF NOT EXISTS instructional_lineage_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS support_context jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS answer_or_method_exposed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS permitted_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accessibility_support jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS control_context text,
  ADD COLUMN IF NOT EXISTS confidence_sample jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS misconception_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS prerequisite_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS path_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_validity text,
  ADD COLUMN IF NOT EXISTS evidential_strength text,
  ADD COLUMN IF NOT EXISTS information_gain text,
  ADD COLUMN IF NOT EXISTS comparability_group text,
  ADD COLUMN IF NOT EXISTS redundancy text,
  ADD COLUMN IF NOT EXISTS normalization_version text;

ALTER TABLE public.teaching_evidence_events
  ADD CONSTRAINT teaching_evidence_events_d13_demand_object_ck CHECK (demand_vector IS NULL OR jsonb_typeof(demand_vector)='object'),
  ADD CONSTRAINT teaching_evidence_events_d13_lineage_array_ck CHECK (jsonb_typeof(instructional_lineage_refs)='array'),
  ADD CONSTRAINT teaching_evidence_events_d13_support_array_ck CHECK (jsonb_typeof(support_context)='array'),
  ADD CONSTRAINT teaching_evidence_events_d13_tools_array_ck CHECK (jsonb_typeof(permitted_tools)='array'),
  ADD CONSTRAINT teaching_evidence_events_d13_access_object_ck CHECK (jsonb_typeof(accessibility_support)='object'),
  ADD CONSTRAINT teaching_evidence_events_d13_confidence_object_ck CHECK (jsonb_typeof(confidence_sample)='object'),
  ADD CONSTRAINT teaching_evidence_events_d13_misconception_object_ck CHECK (jsonb_typeof(misconception_context)='object'),
  ADD CONSTRAINT teaching_evidence_events_d13_prerequisite_object_ck CHECK (jsonb_typeof(prerequisite_context)='object'),
  ADD CONSTRAINT teaching_evidence_events_d13_path_object_ck CHECK (jsonb_typeof(path_context)='object'),
  ADD CONSTRAINT teaching_evidence_events_d13_claim_ck CHECK (
    evidence_claim IS NULL OR evidence_claim IN ('recall','reproduce','independent_performance','adapt_to_variation','select_method','retain_after_delay','integrate_or_transfer','other')
  ),
  ADD CONSTRAINT teaching_evidence_events_d13_control_ck CHECK (
    control_context IS NULL OR control_context IN ('CONTROLLED','PARTIALLY_CONTROLLED','UNCONTROLLED','UNKNOWN')
  ),
  ADD CONSTRAINT teaching_evidence_events_d13_validity_ck CHECK (
    evidence_validity IS NULL OR evidence_validity IN ('VALID','LIMITED','CONTAMINATED','INVALID','UNKNOWN')
  ),
  ADD CONSTRAINT teaching_evidence_events_d13_strength_ck CHECK (
    evidential_strength IS NULL OR evidential_strength IN ('STRONG','MODERATE','WEAK','UNUSABLE','INDETERMINATE')
  ),
  ADD CONSTRAINT teaching_evidence_events_d13_information_gain_ck CHECK (
    information_gain IS NULL OR information_gain IN ('LOW','MODERATE','HIGH','UNKNOWN')
  ),
  ADD CONSTRAINT teaching_evidence_events_d13_redundancy_ck CHECK (
    redundancy IS NULL OR redundancy IN ('NEW_INFORMATION','PARTLY_REDUNDANT','HIGHLY_REDUNDANT','UNKNOWN')
  );

CREATE UNIQUE INDEX IF NOT EXISTS teaching_evidence_events_source_interpretation_uidx
  ON public.teaching_evidence_events(student_id,source_owner,source_interpretation_ref)
  WHERE source_owner IS NOT NULL AND source_interpretation_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_evidence_events_claim_time_idx
  ON public.teaching_evidence_events(student_id,evidence_claim,occurred_at DESC)
  WHERE evidence_claim IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_evidence_events_comparability_idx
  ON public.teaching_evidence_events(student_id,comparability_group,occurred_at DESC)
  WHERE comparability_group IS NOT NULL;

CREATE TABLE public.teaching_student_knowledge_state_versions (
  knowledge_state_version_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  algorithm_id text NOT NULL CHECK (algorithm_id='EVIDENCE_QUALITY_STATE_MACHINE_V1'),
  algorithm_version text NOT NULL CHECK (length(btrim(algorithm_version))>0),
  base_state text NOT NULL CHECK (base_state IN ('UNSEEN','INTRODUCED','ASSISTED','EMERGING','INDEPENDENT','SECURE','TRANSFERABLE')),
  overlays jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(overlays)='array'),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dimensions)='object'),
  certainty_band text NOT NULL CHECK (certainty_band IN ('UNKNOWN','LOW','MEDIUM','HIGH')),
  certainty_basis jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(certainty_basis)='object'),
  retention_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(retention_context)='object'),
  strongest_supported_claim text NOT NULL,
  contradiction_state boolean NOT NULL DEFAULT false,
  evidence_event_count integer NOT NULL DEFAULT 0 CHECK (evidence_event_count >= 0),
  evidence_cutoff_at timestamptz,
  path_to_success jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(path_to_success)='object'),
  confidence_calibration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(confidence_calibration)='object'),
  source_evidence_digest text NOT NULL CHECK (length(btrim(source_evidence_digest))>0),
  cause_evidence_event_id text NOT NULL REFERENCES public.teaching_evidence_events(evidence_event_id) ON DELETE RESTRICT,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,learning_unit_id,version_no)
);
CREATE INDEX teaching_student_knowledge_state_latest_idx
  ON public.teaching_student_knowledge_state_versions(student_id,learning_unit_id,version_no DESC);
CREATE INDEX teaching_student_knowledge_state_algorithm_idx
  ON public.teaching_student_knowledge_state_versions(algorithm_version,created_at DESC);

CREATE TABLE public.teaching_skm_evidence_applications (
  evidence_application_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  evidence_event_id text NOT NULL REFERENCES public.teaching_evidence_events(evidence_event_id) ON DELETE RESTRICT,
  learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  algorithm_id text NOT NULL CHECK (algorithm_id='EVIDENCE_QUALITY_STATE_MACHINE_V1'),
  algorithm_version text NOT NULL CHECK (length(btrim(algorithm_version))>0),
  application_state text NOT NULL CHECK (application_state IN ('APPLIED','NO_STATE_EFFECT','REJECTED_STALE','REJECTED_INVALID')),
  information_gain text NOT NULL CHECK (information_gain IN ('LOW','MODERATE','HIGH','UNKNOWN')),
  resulting_state_version_id text REFERENCES public.teaching_student_knowledge_state_versions(knowledge_state_version_id) ON DELETE RESTRICT,
  application_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,evidence_event_id,learning_unit_id,algorithm_version)
);
CREATE INDEX teaching_skm_evidence_applications_lu_idx
  ON public.teaching_skm_evidence_applications(student_id,learning_unit_id,created_at DESC);

CREATE TABLE public.teaching_persistent_misconception_versions (
  misconception_version_id text PRIMARY KEY,
  misconception_record_id text NOT NULL,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  primary_learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  normalized_hypothesis text NOT NULL CHECK (length(btrim(normalized_hypothesis))>0),
  hypothesis text NOT NULL CHECK (length(btrim(hypothesis))>0),
  version_no bigint NOT NULL CHECK (version_no >= 1),
  status text NOT NULL CHECK (status IN ('CANDIDATE','RECURRING','RESOLUTION_SUPPORTED','RESOLVED')),
  affected_learning_unit_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(affected_learning_unit_refs)='array'),
  supporting_evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(supporting_evidence_refs)='array'),
  repair_attempt_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(repair_attempt_refs)='array'),
  independent_verification_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(independent_verification_refs)='array'),
  delayed_verification_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(delayed_verification_refs)='array'),
  confidence text NOT NULL CHECK (confidence IN ('LOW','MEDIUM','HIGH')),
  algorithm_version text NOT NULL CHECK (length(btrim(algorithm_version))>0),
  supersedes_misconception_version_id text REFERENCES public.teaching_persistent_misconception_versions(misconception_version_id) ON DELETE RESTRICT,
  cause_evidence_event_id text NOT NULL REFERENCES public.teaching_evidence_events(evidence_event_id) ON DELETE RESTRICT,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(misconception_record_id,version_no)
);
CREATE INDEX teaching_persistent_misconception_current_idx
  ON public.teaching_persistent_misconception_versions(student_id,misconception_record_id,version_no DESC);
CREATE INDEX teaching_persistent_misconception_learning_unit_idx
  ON public.teaching_persistent_misconception_versions(student_id,primary_learning_unit_id,version_no DESC);

CREATE TRIGGER teaching_student_knowledge_state_versions_immutable
BEFORE UPDATE OR DELETE ON public.teaching_student_knowledge_state_versions
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

CREATE TRIGGER teaching_skm_evidence_applications_immutable
BEFORE UPDATE OR DELETE ON public.teaching_skm_evidence_applications
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

CREATE TRIGGER teaching_persistent_misconception_versions_immutable
BEFORE UPDATE OR DELETE ON public.teaching_persistent_misconception_versions
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

ALTER TABLE public.teaching_student_knowledge_state_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_skm_evidence_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_persistent_misconception_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.teaching_student_knowledge_state_versions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.teaching_skm_evidence_applications FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.teaching_persistent_misconception_versions FROM PUBLIC,anon,authenticated;

GRANT SELECT,INSERT ON public.teaching_student_knowledge_state_versions TO service_role,teaching_domain_service;
GRANT SELECT,INSERT ON public.teaching_skm_evidence_applications TO service_role,teaching_domain_service;
GRANT SELECT,INSERT ON public.teaching_persistent_misconception_versions TO service_role,teaching_domain_service;

CREATE POLICY teaching_student_knowledge_state_domain_select
  ON public.teaching_student_knowledge_state_versions FOR SELECT TO teaching_domain_service USING (true);
CREATE POLICY teaching_student_knowledge_state_domain_insert
  ON public.teaching_student_knowledge_state_versions FOR INSERT TO teaching_domain_service WITH CHECK (true);
CREATE POLICY teaching_skm_evidence_applications_domain_select
  ON public.teaching_skm_evidence_applications FOR SELECT TO teaching_domain_service USING (true);
CREATE POLICY teaching_skm_evidence_applications_domain_insert
  ON public.teaching_skm_evidence_applications FOR INSERT TO teaching_domain_service WITH CHECK (true);
CREATE POLICY teaching_persistent_misconception_domain_select
  ON public.teaching_persistent_misconception_versions FOR SELECT TO teaching_domain_service USING (true);
CREATE POLICY teaching_persistent_misconception_domain_insert
  ON public.teaching_persistent_misconception_versions FOR INSERT TO teaching_domain_service WITH CHECK (true);

-- The D04 Evidence Event table historically allowed authenticated read access.
-- D13 adds internal inference metadata, so preserve only the legacy student-safe
-- Evidence Event columns for direct authenticated SELECT. Student-facing D13
-- Learning Analysis is served through the application API.
REVOKE SELECT ON public.teaching_evidence_events FROM authenticated;
GRANT SELECT (
  evidence_event_id,student_id,course_id,class_session_id,source_response_id,
  evidence_kind,evidence_purpose,formal_assessment,independent_performance,assistance_level,
  response_quality,difficulty_context,novelty_context,observed_errors,provenance_refs,
  occurred_at,created_at
) ON public.teaching_evidence_events TO authenticated;

COMMIT;
