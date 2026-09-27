-- KIWI Teaching D08 — Course Plan, Coverage & Course-Creation Review
-- Exact delivery scope only. D09 scheduling and D10 lifecycle transitions are deliberately not implemented here.

BEGIN;

ALTER TABLE public.teaching_course_plans
  ADD COLUMN IF NOT EXISTS curriculum_audit_id text REFERENCES public.teaching_curriculum_audits(curriculum_audit_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS plan_contract_version text NOT NULL DEFAULT 'd08.course-plan.v1',
  ADD COLUMN IF NOT EXISTS source_inventory_digest text,
  ADD COLUMN IF NOT EXISTS scope_diff_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(scope_diff_summary)='object'),
  ADD COLUMN IF NOT EXISTS review_summary text;

CREATE TABLE IF NOT EXISTS public.teaching_course_plan_prerequisites (
  prerequisite_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE CASCADE,
  prerequisite_ref text NOT NULL,
  disclosure text NOT NULL CHECK (length(btrim(disclosure))>0),
  validation_status text NOT NULL CHECK (validation_status IN ('VALIDATED_PRIOR_KNOWLEDGE','UNVERIFIED','NOT_VALIDATED')),
  vpk_decision_id text REFERENCES public.teaching_validated_prior_knowledge_decisions(vpk_decision_id) ON DELETE SET NULL,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_plan_id,prerequisite_ref)
);

CREATE TABLE IF NOT EXISTS public.teaching_course_plan_source_mappings (
  mapping_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE CASCADE,
  source_content_item_id text NOT NULL REFERENCES public.teaching_source_content_items(source_content_item_id) ON DELETE RESTRICT,
  learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  mapping_role text NOT NULL CHECK (mapping_role IN ('REQUIRED_SCOPE','SUPPORTING_SCOPE')),
  instructional_mode text NOT NULL CHECK (instructional_mode IN ('STANDARD','VPK_COMPRESSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_plan_id,source_content_item_id,learning_unit_id)
);

CREATE TABLE IF NOT EXISTS public.teaching_course_plan_exclusions (
  exclusion_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE CASCADE,
  source_content_item_id text NOT NULL REFERENCES public.teaching_source_content_items(source_content_item_id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason))>0),
  approval_authority_ref text NOT NULL CHECK (length(btrim(approval_authority_ref))>0),
  policy_version text NOT NULL,
  approved_at timestamptz NOT NULL,
  UNIQUE(course_plan_id,source_content_item_id)
);

CREATE TABLE IF NOT EXISTS public.teaching_coverage_audits (
  coverage_audit_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE RESTRICT,
  audit_stage text NOT NULL CHECK (audit_stage IN ('PRE_ACTIVATION','END_OF_COURSE')),
  status text NOT NULL CHECK (status IN ('PASS','BLOCKED','INCOMPLETE')),
  policy_version text NOT NULL,
  machine_result jsonb NOT NULL CHECK (jsonb_typeof(machine_result)='object'),
  student_summary text NOT NULL CHECK (length(btrim(student_summary))>0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.teaching_course_scope_changes (
  scope_change_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  prior_course_plan_id text REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE SET NULL,
  observed_subject_snapshot_ref text,
  candidate_snapshot_ref text NOT NULL,
  candidate_inventory_digest text NOT NULL,
  change_classification text NOT NULL CHECK (change_classification IN ('MINOR_SUPPLEMENTARY_UPDATE','FORMAL_COURSE_PLAN_UPDATE')),
  requires_plan_version boolean NOT NULL,
  added_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(added_source_refs)='array'),
  changed_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changed_source_refs)='array'),
  removed_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(removed_source_refs)='array'),
  diff_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(diff_summary)='object'),
  student_summary text NOT NULL CHECK (length(btrim(student_summary))>0),
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id,candidate_inventory_digest)
);

CREATE TABLE IF NOT EXISTS public.teaching_course_scope_change_applications (
  application_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope_change_id text NOT NULL REFERENCES public.teaching_course_scope_changes(scope_change_id) ON DELETE RESTRICT,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE RESTRICT,
  applied_at timestamptz NOT NULL,
  UNIQUE(scope_change_id)
);

ALTER TABLE public.teaching_source_content_items
  ADD COLUMN IF NOT EXISTS scope_version_no bigint NOT NULL DEFAULT 1 CHECK (scope_version_no>=1),
  ADD COLUMN IF NOT EXISTS supersedes_source_content_item_id text REFERENCES public.teaching_source_content_items(source_content_item_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS discovered_scope_change_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='teaching_source_content_scope_change_fk') THEN
    ALTER TABLE public.teaching_source_content_items
      ADD CONSTRAINT teaching_source_content_scope_change_fk
      FOREIGN KEY(discovered_scope_change_id) REFERENCES public.teaching_course_scope_changes(scope_change_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.teaching_guard_course_plan_version_content()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(
    OLD.student_id,OLD.course_id,OLD.version_no,OLD.scope_checksum,OLD.source_snapshot_ref,
    OLD.generation_provenance,OLD.supersedes_course_plan_id,OLD.created_by,OLD.created_at,
    OLD.curriculum_audit_id,OLD.plan_contract_version,OLD.source_inventory_digest,
    OLD.scope_diff_summary,OLD.review_summary
  ) IS DISTINCT FROM ROW(
    NEW.student_id,NEW.course_id,NEW.version_no,NEW.scope_checksum,NEW.source_snapshot_ref,
    NEW.generation_provenance,NEW.supersedes_course_plan_id,NEW.created_by,NEW.created_at,
    NEW.curriculum_audit_id,NEW.plan_contract_version,NEW.source_inventory_digest,
    NEW.scope_diff_summary,NEW.review_summary
  ) THEN
    RAISE EXCEPTION 'Teaching Course Plan version content is immutable; create a new version instead' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS teaching_course_plan_version_guard ON public.teaching_course_plans;
CREATE TRIGGER teaching_course_plan_version_guard
BEFORE UPDATE ON public.teaching_course_plans
FOR EACH ROW EXECUTE FUNCTION public.teaching_guard_course_plan_version_content();

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_topics','teaching_subtopics','teaching_learning_units','teaching_learning_unit_dependencies',
    'teaching_course_plan_prerequisites','teaching_course_plan_source_mappings','teaching_course_plan_exclusions',
    'teaching_coverage_audits','teaching_course_scope_changes','teaching_course_scope_change_applications'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=rel AND t.tgname=rel||'_immutable' AND NOT t.tgisinternal
    ) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation()', rel||'_immutable', rel);
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS teaching_course_plans_curriculum_audit_idx ON public.teaching_course_plans(curriculum_audit_id);
CREATE INDEX IF NOT EXISTS teaching_course_plan_prerequisites_student_idx ON public.teaching_course_plan_prerequisites(student_id);
CREATE INDEX IF NOT EXISTS teaching_course_plan_prerequisites_vpk_idx ON public.teaching_course_plan_prerequisites(vpk_decision_id) WHERE vpk_decision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_course_plan_source_mappings_student_idx ON public.teaching_course_plan_source_mappings(student_id);
CREATE INDEX IF NOT EXISTS teaching_course_plan_source_mappings_source_idx ON public.teaching_course_plan_source_mappings(source_content_item_id);
CREATE INDEX IF NOT EXISTS teaching_course_plan_source_mappings_unit_idx ON public.teaching_course_plan_source_mappings(learning_unit_id);
CREATE INDEX IF NOT EXISTS teaching_course_plan_exclusions_student_idx ON public.teaching_course_plan_exclusions(student_id);
CREATE INDEX IF NOT EXISTS teaching_course_plan_exclusions_source_idx ON public.teaching_course_plan_exclusions(source_content_item_id);
CREATE INDEX IF NOT EXISTS teaching_coverage_audits_course_idx ON public.teaching_coverage_audits(student_id,course_id,course_plan_id,audit_stage,created_at DESC);
CREATE INDEX IF NOT EXISTS teaching_scope_changes_course_idx ON public.teaching_course_scope_changes(student_id,course_id,detected_at DESC);
CREATE INDEX IF NOT EXISTS teaching_scope_changes_prior_plan_idx ON public.teaching_course_scope_changes(prior_course_plan_id) WHERE prior_course_plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_scope_applications_student_idx ON public.teaching_course_scope_change_applications(student_id);
CREATE INDEX IF NOT EXISTS teaching_scope_applications_plan_idx ON public.teaching_course_scope_change_applications(course_plan_id);
CREATE INDEX IF NOT EXISTS teaching_source_content_scope_change_idx ON public.teaching_source_content_items(discovered_scope_change_id) WHERE discovered_scope_change_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_source_content_supersedes_idx ON public.teaching_source_content_items(supersedes_source_content_item_id) WHERE supersedes_source_content_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_source_content_current_scope_idx ON public.teaching_source_content_items(student_id,course_id,source_kind,source_ref) WHERE superseded_at IS NULL;

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_course_plan_prerequisites','teaching_course_plan_source_mappings','teaching_course_plan_exclusions',
    'teaching_coverage_audits','teaching_course_scope_changes','teaching_course_scope_change_applications'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service', rel);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated,service_role,teaching_domain_service', rel);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((select auth.uid())::text=student_id)', rel||'_student_select', rel);
  END LOOP;
END $$;

GRANT INSERT ON
  public.teaching_course_plan_prerequisites,
  public.teaching_course_plan_source_mappings,
  public.teaching_course_plan_exclusions,
  public.teaching_coverage_audits,
  public.teaching_course_scope_changes,
  public.teaching_course_scope_change_applications
TO service_role,teaching_domain_service;

GRANT UPDATE ON public.teaching_course_plans,public.teaching_courses,public.teaching_source_content_items TO service_role,teaching_domain_service;
GRANT INSERT ON public.teaching_topics,public.teaching_subtopics,public.teaching_learning_units,
  public.teaching_learning_unit_dependencies,public.teaching_learning_unit_lineage,
  public.teaching_course_coverage,public.teaching_source_content_items,public.teaching_academic_audit_log,
  public.teaching_validated_prior_knowledge_decisions
TO service_role,teaching_domain_service;

COMMIT;
