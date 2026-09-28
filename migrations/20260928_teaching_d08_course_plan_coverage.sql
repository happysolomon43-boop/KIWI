-- KIWI Teaching D08 — Course Plan, Coverage & Course-Creation Review
-- Additive realization of D08 authority. Model output remains provisional;
-- deterministic Course Plan/Coverage domain logic owns authoritative persistence.
BEGIN;

ALTER TABLE public.teaching_source_content_items
  ADD COLUMN scope_version_no bigint NOT NULL DEFAULT 1 CHECK (scope_version_no>=1),
  ADD COLUMN supersedes_source_content_item_id text REFERENCES public.teaching_source_content_items(source_content_item_id) DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN discovered_scope_change_id text,
  ADD COLUMN superseded_at timestamptz;

CREATE UNIQUE INDEX teaching_source_content_current_ref_uidx
  ON public.teaching_source_content_items(course_id,source_ref)
  WHERE superseded_at IS NULL;
CREATE INDEX teaching_source_content_supersedes_idx
  ON public.teaching_source_content_items(supersedes_source_content_item_id);
CREATE INDEX teaching_source_content_active_scope_idx
  ON public.teaching_source_content_items(student_id,course_id,scope_version_no,discovered_at)
  WHERE superseded_at IS NULL;

ALTER TABLE public.teaching_course_plans
  ADD COLUMN curriculum_audit_id text REFERENCES public.teaching_curriculum_audits(curriculum_audit_id) ON DELETE RESTRICT,
  ADD COLUMN plan_contract_version text,
  ADD COLUMN source_inventory_digest text,
  ADD COLUMN scope_diff_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(scope_diff_summary)='object'),
  ADD COLUMN review_summary text,
  ADD CONSTRAINT teaching_course_plan_state_d08
    CHECK (plan_state IN ('DRAFT','REVIEW_READY','REVIEW_REQUIRED','SUPERSEDED')),
  ADD CONSTRAINT teaching_course_plan_review_ready_provenance_d08
    CHECK (
      plan_state='DRAFT'
      OR (
        curriculum_audit_id IS NOT NULL
        AND length(btrim(coalesce(plan_contract_version,'')))>0
        AND length(btrim(coalesce(source_inventory_digest,'')))>0
        AND length(btrim(coalesce(source_snapshot_ref,'')))>0
      )
    );
CREATE INDEX teaching_course_plans_curriculum_audit_idx
  ON public.teaching_course_plans(curriculum_audit_id);
CREATE INDEX teaching_course_plans_current_idx
  ON public.teaching_course_plans(student_id,course_id,version_no DESC,plan_state);

CREATE TABLE public.teaching_course_plan_prerequisites (
  prerequisite_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE CASCADE,
  prerequisite_ref text NOT NULL,
  label text NOT NULL CHECK (length(btrim(label))>0),
  description text,
  disclosure_text text NOT NULL CHECK (length(btrim(disclosure_text))>0),
  resolution_state text NOT NULL CHECK (resolution_state IN ('ASSUMED','VALIDATED_PRIOR_KNOWLEDGE','UNRESOLVED')),
  vpk_decision_id text REFERENCES public.teaching_validated_prior_knowledge_decisions(vpk_decision_id) ON DELETE RESTRICT,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_plan_id,prerequisite_ref)
);
CREATE INDEX teaching_course_plan_prerequisites_student_idx
  ON public.teaching_course_plan_prerequisites(student_id,course_plan_id);
CREATE INDEX teaching_course_plan_prerequisites_vpk_idx
  ON public.teaching_course_plan_prerequisites(vpk_decision_id);

CREATE TABLE public.teaching_course_plan_source_mappings (
  mapping_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE CASCADE,
  coverage_entry_id text NOT NULL REFERENCES public.teaching_course_coverage(coverage_entry_id) ON DELETE CASCADE,
  source_content_item_id text NOT NULL REFERENCES public.teaching_source_content_items(source_content_item_id) ON DELETE RESTRICT,
  learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  mapping_kind text NOT NULL CHECK (mapping_kind IN ('REQUIRED_SCOPE','SUPPLEMENTARY_SCOPE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_plan_id,source_content_item_id,learning_unit_id)
);
CREATE INDEX teaching_course_plan_mappings_student_idx
  ON public.teaching_course_plan_source_mappings(student_id,course_plan_id);
CREATE INDEX teaching_course_plan_mappings_coverage_idx
  ON public.teaching_course_plan_source_mappings(coverage_entry_id);
CREATE INDEX teaching_course_plan_mappings_source_idx
  ON public.teaching_course_plan_source_mappings(source_content_item_id);
CREATE INDEX teaching_course_plan_mappings_unit_idx
  ON public.teaching_course_plan_source_mappings(learning_unit_id);

CREATE TABLE public.teaching_course_plan_exclusions (
  exclusion_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE CASCADE,
  source_content_item_id text NOT NULL REFERENCES public.teaching_source_content_items(source_content_item_id) ON DELETE RESTRICT,
  classification text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason))>0),
  policy_version text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  UNIQUE(course_plan_id,source_content_item_id)
);
CREATE INDEX teaching_course_plan_exclusions_student_idx
  ON public.teaching_course_plan_exclusions(student_id,course_plan_id);
CREATE INDEX teaching_course_plan_exclusions_source_idx
  ON public.teaching_course_plan_exclusions(source_content_item_id);

CREATE TABLE public.teaching_coverage_audits (
  coverage_audit_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE RESTRICT,
  audit_kind text NOT NULL CHECK (audit_kind IN ('PRE_ACTIVATION','END_OF_COURSE','SCOPE_CHANGE')),
  outcome text NOT NULL CHECK (outcome IN ('PASS','FAIL')),
  policy_version text NOT NULL,
  machine_result jsonb NOT NULL CHECK (jsonb_typeof(machine_result)='object'),
  student_summary text NOT NULL CHECK (length(btrim(student_summary))>0),
  state_version_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teaching_coverage_audits_student_idx
  ON public.teaching_coverage_audits(student_id,course_id,created_at DESC);
CREATE INDEX teaching_coverage_audits_plan_idx
  ON public.teaching_coverage_audits(course_plan_id,created_at DESC);

CREATE TABLE public.teaching_course_scope_changes (
  scope_change_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  previous_snapshot_ref text NOT NULL,
  observed_snapshot_ref text NOT NULL,
  change_kind text NOT NULL CHECK (change_kind IN ('NO_CHANGE','MINOR_SUPPLEMENT','REVIEW_REQUIRED','MATERIAL_SCOPE_CHANGE')),
  status text NOT NULL CHECK (status IN ('NO_CHANGE','MINOR_SUPPLEMENT','OPEN','PENDING_PLAN_UPDATE','ADOPTED_PENDING_AUDIT','APPLIED')),
  added_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(added_source_refs)='array'),
  removed_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(removed_source_refs)='array'),
  changed_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changed_source_refs)='array'),
  impact_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(impact_summary)='object'),
  requires_plan_version boolean NOT NULL DEFAULT false,
  review_required boolean NOT NULL DEFAULT false,
  detected_at timestamptz NOT NULL DEFAULT now(),
  analyzed_at timestamptz,
  adopted_at timestamptz,
  applied_at timestamptz,
  UNIQUE(course_id,previous_snapshot_ref,observed_snapshot_ref)
);
CREATE INDEX teaching_course_scope_changes_student_idx
  ON public.teaching_course_scope_changes(student_id,course_id,detected_at DESC);
CREATE INDEX teaching_course_scope_changes_status_idx
  ON public.teaching_course_scope_changes(course_id,status,detected_at DESC);

CREATE TABLE public.teaching_course_scope_change_applications (
  application_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope_change_id text NOT NULL REFERENCES public.teaching_course_scope_changes(scope_change_id) ON DELETE RESTRICT,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE RESTRICT,
  applied_at timestamptz NOT NULL,
  UNIQUE(scope_change_id)
);
CREATE INDEX teaching_course_scope_apps_student_idx
  ON public.teaching_course_scope_change_applications(student_id,course_plan_id);
CREATE INDEX teaching_course_scope_apps_plan_idx
  ON public.teaching_course_scope_change_applications(course_plan_id);

ALTER TABLE public.teaching_source_content_items
  ADD CONSTRAINT teaching_source_content_scope_change_fk
  FOREIGN KEY(discovered_scope_change_id)
  REFERENCES public.teaching_course_scope_changes(scope_change_id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX teaching_source_content_scope_change_idx
  ON public.teaching_source_content_items(discovered_scope_change_id);

CREATE OR REPLACE FUNCTION public.teaching_guard_d08_course_plan_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.course_plan_id IS DISTINCT FROM OLD.course_plan_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.course_id IS DISTINCT FROM OLD.course_id
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.scope_checksum IS DISTINCT FROM OLD.scope_checksum
     OR NEW.source_snapshot_ref IS DISTINCT FROM OLD.source_snapshot_ref
     OR NEW.generation_provenance IS DISTINCT FROM OLD.generation_provenance
     OR NEW.supersedes_course_plan_id IS DISTINCT FROM OLD.supersedes_course_plan_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.curriculum_audit_id IS DISTINCT FROM OLD.curriculum_audit_id
     OR NEW.plan_contract_version IS DISTINCT FROM OLD.plan_contract_version
     OR NEW.source_inventory_digest IS DISTINCT FROM OLD.source_inventory_digest
     OR NEW.scope_diff_summary IS DISTINCT FROM OLD.scope_diff_summary
     OR NEW.review_summary IS DISTINCT FROM OLD.review_summary
  THEN
    RAISE EXCEPTION 'Teaching Course Plan versions are immutable except for governed plan_state transitions.';
  END IF;

  IF OLD.plan_state='SUPERSEDED' AND NEW.plan_state IS DISTINCT FROM OLD.plan_state THEN
    RAISE EXCEPTION 'A superseded Teaching Course Plan cannot be reactivated.';
  END IF;
  IF OLD.plan_state='REVIEW_REQUIRED' AND NEW.plan_state NOT IN ('REVIEW_REQUIRED','SUPERSEDED') THEN
    RAISE EXCEPTION 'A review-required Teaching Course Plan cannot be silently reactivated.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER teaching_course_plan_d08_update_guard
BEFORE UPDATE ON public.teaching_course_plans
FOR EACH ROW EXECUTE FUNCTION public.teaching_guard_d08_course_plan_update();

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_course_plan_prerequisites',
    'teaching_course_plan_source_mappings',
    'teaching_course_plan_exclusions',
    'teaching_coverage_audits',
    'teaching_course_scope_changes',
    'teaching_course_scope_change_applications'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service', rel);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated,service_role,teaching_domain_service', rel);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((select auth.uid())::text=student_id)',
      rel||'_student_select', rel
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO teaching_domain_service USING (true)',
      rel||'_domain_service_select', rel
    );
  END LOOP;
END $$;

GRANT INSERT ON
  public.teaching_course_plan_prerequisites,
  public.teaching_course_plan_source_mappings,
  public.teaching_course_plan_exclusions,
  public.teaching_coverage_audits,
  public.teaching_course_scope_change_applications
TO service_role,teaching_domain_service;

GRANT INSERT,UPDATE ON public.teaching_course_scope_changes TO service_role,teaching_domain_service;

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_course_plan_prerequisites',
    'teaching_course_plan_source_mappings',
    'teaching_course_plan_exclusions',
    'teaching_coverage_audits',
    'teaching_course_scope_change_applications'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO teaching_domain_service WITH CHECK (true)',
      rel||'_domain_service_insert', rel
    );
  END LOOP;
END $$;

CREATE POLICY teaching_course_scope_changes_domain_service_insert
  ON public.teaching_course_scope_changes FOR INSERT TO teaching_domain_service WITH CHECK (true);
CREATE POLICY teaching_course_scope_changes_domain_service_update
  ON public.teaching_course_scope_changes FOR UPDATE TO teaching_domain_service USING (true) WITH CHECK (true);

REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON
  public.teaching_course_plan_prerequisites,
  public.teaching_course_plan_source_mappings,
  public.teaching_course_plan_exclusions,
  public.teaching_coverage_audits,
  public.teaching_course_scope_changes,
  public.teaching_course_scope_change_applications
FROM authenticated;

CREATE TRIGGER teaching_course_plan_prerequisites_immutable
BEFORE UPDATE OR DELETE ON public.teaching_course_plan_prerequisites
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
CREATE TRIGGER teaching_course_plan_mappings_immutable
BEFORE UPDATE OR DELETE ON public.teaching_course_plan_source_mappings
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
CREATE TRIGGER teaching_course_plan_exclusions_immutable
BEFORE UPDATE OR DELETE ON public.teaching_course_plan_exclusions
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
CREATE TRIGGER teaching_coverage_audits_immutable
BEFORE UPDATE OR DELETE ON public.teaching_coverage_audits
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
CREATE TRIGGER teaching_course_scope_applications_immutable
BEFORE UPDATE OR DELETE ON public.teaching_course_scope_change_applications
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

COMMIT;

-- Recovery contract:
-- Before any D08 records exist, child tables may be removed in reverse dependency
-- order and D08-added columns/indexes/guard may be removed. Once any plan, audit,
-- scope-change, mapping or application exists, use a forward corrective migration.
-- Never delete historical Learning Units/VPK decisions, rewrite Coverage Audit
-- snapshots, or grant browser mutation access to authoritative Teaching state.
