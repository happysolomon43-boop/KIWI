-- KIWI Teaching D07 — Course Intake, Curriculum Audit & Prior-Knowledge Verification
BEGIN;

-- Setup Stage 1 precedes Semester selection. Only DRAFT courses may omit it.
ALTER TABLE public.teaching_courses ALTER COLUMN semester_id DROP NOT NULL;
ALTER TABLE public.teaching_courses ADD COLUMN state_version bigint NOT NULL DEFAULT 1 CHECK (state_version>=1);
ALTER TABLE public.teaching_courses ADD CONSTRAINT teaching_course_semester_after_draft
  CHECK (lifecycle_state='DRAFT' OR semester_id IS NOT NULL);

ALTER TABLE public.teaching_source_content_items
  ADD CONSTRAINT teaching_source_kind_d07 CHECK (source_kind IN ('PRIMARY_KIWI_SUBJECT','STUDENT_SUPPLEMENT','AUTHORITATIVE_SCHOOL_SCOPE','AI_SUPPLEMENTATION')),
  ADD CONSTRAINT teaching_source_classification_d07 CHECK (classification IS NULL OR classification IN ('ACADEMICALLY_MEANINGFUL','DUPLICATE','ADMINISTRATIVE','FORMATTING_ONLY','OBSOLETE','OUTSIDE_APPROVED_COURSE_SCOPE')),
  ADD CONSTRAINT teaching_source_exclusion_reason_d07 CHECK (classification IS NULL OR classification='ACADEMICALLY_MEANINGFUL' OR length(btrim(coalesce(classification_reason,'')))>0);

CREATE TABLE public.teaching_curriculum_audits (
  curriculum_audit_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  audit_version bigint NOT NULL CHECK (audit_version>=1),
  subject_snapshot_ref text NOT NULL,
  source_inventory_digest text NOT NULL,
  capability_id text NOT NULL,
  prompt_family_id text NOT NULL,
  prompt_family_version text NOT NULL,
  output_schema_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('VALIDATED_CANDIDATE','REJECTED','SUPERSEDED')),
  audit_output jsonb NOT NULL CHECK (jsonb_typeof(audit_output)='object'),
  provenance_refs jsonb NOT NULL CHECK (jsonb_typeof(provenance_refs)='array'),
  validation_metadata jsonb NOT NULL CHECK (jsonb_typeof(validation_metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id,audit_version)
);

CREATE TABLE public.teaching_diagnostic_plans (
  diagnostic_plan_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  curriculum_audit_id text REFERENCES public.teaching_curriculum_audits(curriculum_audit_id) ON DELETE RESTRICT,
  plan_version bigint NOT NULL CHECK (plan_version>=1),
  requirement_state text NOT NULL CHECK (requirement_state IN ('REQUIRED','NOT_REQUIRED')),
  requirement_reason text NOT NULL,
  target_refs jsonb NOT NULL CHECK (jsonb_typeof(target_refs)='array'),
  non_graded boolean NOT NULL DEFAULT true CHECK (non_graded=true),
  capability_id text,
  prompt_family_id text,
  prompt_family_version text,
  output_schema_version text,
  diagnostic_design jsonb,
  provenance_refs jsonb NOT NULL CHECK (jsonb_typeof(provenance_refs)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id,plan_version),
  CHECK ((requirement_state='NOT_REQUIRED' AND capability_id IS NULL AND diagnostic_design IS NULL) OR requirement_state='REQUIRED')
);

CREATE TABLE public.teaching_validated_prior_knowledge_decisions (
  vpk_decision_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('PREREQUISITE','SOURCE_CONTENT_ITEM','LEARNING_UNIT')),
  target_ref text NOT NULL,
  decision_status text NOT NULL CHECK (decision_status IN ('VALIDATED_PRIOR_KNOWLEDGE','NOT_VALIDATED')),
  policy_version text NOT NULL CHECK (policy_version='validated-prior-knowledge.v1'),
  validator_id text NOT NULL,
  validator_version text NOT NULL,
  evidence_refs jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs)='array'),
  probe_refs jsonb NOT NULL CHECK (jsonb_typeof(probe_refs)='array'),
  provenance_refs jsonb NOT NULL CHECK (jsonb_typeof(provenance_refs)='array'),
  decision_reasons jsonb NOT NULL CHECK (jsonb_typeof(decision_reasons)='array'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  supersedes_vpk_decision_id text REFERENCES public.teaching_validated_prior_knowledge_decisions(vpk_decision_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX teaching_vpk_target_idx ON public.teaching_validated_prior_knowledge_decisions(student_id,course_id,target_kind,target_ref,decided_at DESC);

DO $$ DECLARE rel text; BEGIN
  FOREACH rel IN ARRAY ARRAY['teaching_curriculum_audits','teaching_diagnostic_plans','teaching_validated_prior_knowledge_decisions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service',rel);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated,service_role,teaching_domain_service',rel);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((select auth.uid())::text=student_id)',rel||'_student_select',rel);
  END LOOP;
END $$;
GRANT INSERT,UPDATE ON public.teaching_curriculum_audits,public.teaching_diagnostic_plans TO service_role,teaching_domain_service;
GRANT INSERT ON public.teaching_validated_prior_knowledge_decisions TO service_role,teaching_domain_service;

CREATE TRIGGER teaching_vpk_decisions_immutable BEFORE UPDATE OR DELETE ON public.teaching_validated_prior_knowledge_decisions FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
COMMIT;
