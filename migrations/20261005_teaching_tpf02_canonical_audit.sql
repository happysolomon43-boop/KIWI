-- KIWI Teaching — canonical isolated TPF-02 Curriculum Audit persistence
BEGIN;

ALTER TABLE public.teaching_curriculum_audits
  ADD COLUMN artifact_status text,
  ADD COLUMN input_state_reference text,
  ADD COLUMN review_required boolean,
  ADD COLUMN review_reasons jsonb,
  ADD COLUMN audit_scope jsonb,
  ADD COLUMN student_facing_summary_candidate text;

ALTER TABLE public.teaching_curriculum_audits
  ADD CONSTRAINT teaching_curriculum_audits_artifact_status_ck
    CHECK (artifact_status IS NULL OR artifact_status IN ('ok','unresolved','blocked_insufficient_sources','blocked_authority_conflict')),
  ADD CONSTRAINT teaching_curriculum_audits_review_reasons_ck
    CHECK (review_reasons IS NULL OR jsonb_typeof(review_reasons)='array'),
  ADD CONSTRAINT teaching_curriculum_audits_audit_scope_ck
    CHECK (audit_scope IS NULL OR jsonb_typeof(audit_scope)='object'),
  ADD CONSTRAINT teaching_curriculum_audits_tpf02_projection_ck
    CHECK (
      output_schema_version <> 'tpf02.curriculum-audit.v1'
      OR (
        artifact_status IS NOT NULL
        AND input_state_reference IS NOT NULL
        AND review_required IS NOT NULL
        AND jsonb_typeof(review_reasons)='array'
        AND jsonb_typeof(audit_scope)='object'
      )
    );

CREATE UNIQUE INDEX teaching_curriculum_audits_identity_uq
  ON public.teaching_curriculum_audits(curriculum_audit_id,student_id,course_id);

CREATE TABLE public.teaching_curriculum_audit_source_inventory (
  curriculum_audit_id text NOT NULL,
  student_id text NOT NULL,
  course_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal>=0),
  source_item_ref text NOT NULL,
  provenance text NOT NULL,
  academic_meaning text NOT NULL,
  proposed_scope_classification text NOT NULL CHECK (proposed_scope_classification IN ('required','supplementary','duplicate','non_instructional','outside_approved_scope','unresolved')),
  scope_classification_basis text NOT NULL,
  content_validity_status text NOT NULL CHECK (content_validity_status IN ('current_supported','outdated_or_inaccurate','disputed','historical_or_contextual','not_applicable','unresolved')),
  content_validity_basis text NOT NULL DEFAULT '',
  confidence text NOT NULL CHECK (confidence IN ('high','medium','low')),
  PRIMARY KEY(curriculum_audit_id,ordinal),
  UNIQUE(curriculum_audit_id,source_item_ref),
  FOREIGN KEY(curriculum_audit_id,student_id,course_id)
    REFERENCES public.teaching_curriculum_audits(curriculum_audit_id,student_id,course_id) ON DELETE CASCADE
);

CREATE TABLE public.teaching_curriculum_audit_topics (
  curriculum_audit_id text NOT NULL,
  student_id text NOT NULL,
  course_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal>=0),
  topic_id text NOT NULL,
  title text NOT NULL,
  source_item_refs jsonb NOT NULL CHECK (jsonb_typeof(source_item_refs)='array'),
  subtopics jsonb NOT NULL CHECK (jsonb_typeof(subtopics)='array'),
  PRIMARY KEY(curriculum_audit_id,ordinal),
  UNIQUE(curriculum_audit_id,topic_id),
  FOREIGN KEY(curriculum_audit_id,student_id,course_id)
    REFERENCES public.teaching_curriculum_audits(curriculum_audit_id,student_id,course_id) ON DELETE CASCADE
);

CREATE TABLE public.teaching_curriculum_audit_learning_units (
  curriculum_audit_id text NOT NULL,
  student_id text NOT NULL,
  course_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal>=0),
  learning_unit_id text NOT NULL,
  title text NOT NULL,
  intended_competence text NOT NULL,
  source_item_refs jsonb NOT NULL CHECK (jsonb_typeof(source_item_refs)='array'),
  topic_refs jsonb NOT NULL CHECK (jsonb_typeof(topic_refs)='array'),
  prerequisite_refs jsonb NOT NULL CHECK (jsonb_typeof(prerequisite_refs)='array'),
  dependency_type_notes text NOT NULL DEFAULT '',
  criticality text NOT NULL CHECK (criticality IN ('foundational','major','supporting','enrichment','unresolved')),
  criticality_basis text NOT NULL,
  proposed_exit_evidence text NOT NULL,
  uncertainties jsonb NOT NULL CHECK (jsonb_typeof(uncertainties)='array'),
  PRIMARY KEY(curriculum_audit_id,ordinal),
  UNIQUE(curriculum_audit_id,learning_unit_id),
  FOREIGN KEY(curriculum_audit_id,student_id,course_id)
    REFERENCES public.teaching_curriculum_audits(curriculum_audit_id,student_id,course_id) ON DELETE CASCADE
);

CREATE TABLE public.teaching_curriculum_audit_assumed_prerequisites (
  curriculum_audit_id text NOT NULL,
  student_id text NOT NULL,
  course_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal>=0),
  capability text NOT NULL,
  why_required text NOT NULL,
  source_or_academic_basis text NOT NULL,
  inside_course_scope boolean NOT NULL CHECK (inside_course_scope=false),
  PRIMARY KEY(curriculum_audit_id,ordinal),
  FOREIGN KEY(curriculum_audit_id,student_id,course_id)
    REFERENCES public.teaching_curriculum_audits(curriculum_audit_id,student_id,course_id) ON DELETE CASCADE
);

CREATE TABLE public.teaching_curriculum_audit_source_conflicts (
  curriculum_audit_id text NOT NULL,
  student_id text NOT NULL,
  course_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal>=0),
  conflict text NOT NULL,
  conflict_type text NOT NULL CHECK (conflict_type IN ('scope_authority','factual_content','terminology','sequencing','other')),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs)='array'),
  authority_context text NOT NULL DEFAULT '',
  resolution_status text NOT NULL CHECK (resolution_status IN ('resolved_by_authoritative_rule','proposed_resolution','unresolved')),
  resolution_or_required_review text NOT NULL,
  PRIMARY KEY(curriculum_audit_id,ordinal),
  FOREIGN KEY(curriculum_audit_id,student_id,course_id)
    REFERENCES public.teaching_curriculum_audits(curriculum_audit_id,student_id,course_id) ON DELETE CASCADE
);

CREATE TABLE public.teaching_curriculum_audit_coverage_gaps (
  curriculum_audit_id text NOT NULL,
  student_id text NOT NULL,
  course_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal>=0),
  required_area text NOT NULL,
  why_gap_matters text NOT NULL,
  available_support text NOT NULL DEFAULT '',
  supplementation_needed text NOT NULL,
  blocking boolean NOT NULL,
  PRIMARY KEY(curriculum_audit_id,ordinal),
  FOREIGN KEY(curriculum_audit_id,student_id,course_id)
    REFERENCES public.teaching_curriculum_audits(curriculum_audit_id,student_id,course_id) ON DELETE CASCADE
);

CREATE TABLE public.teaching_curriculum_audit_structure_change_proposals (
  curriculum_audit_id text NOT NULL,
  student_id text NOT NULL,
  course_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal>=0),
  change_type text NOT NULL CHECK (change_type IN ('split','merge','compress')),
  affected_unit_refs jsonb NOT NULL CHECK (jsonb_typeof(affected_unit_refs)='array'),
  proposal text NOT NULL,
  lineage_preserved boolean NOT NULL CHECK (lineage_preserved=true),
  reason text NOT NULL,
  PRIMARY KEY(curriculum_audit_id,ordinal),
  FOREIGN KEY(curriculum_audit_id,student_id,course_id)
    REFERENCES public.teaching_curriculum_audits(curriculum_audit_id,student_id,course_id) ON DELETE CASCADE
);

CREATE TABLE public.teaching_curriculum_audit_unresolved_items (
  curriculum_audit_id text NOT NULL,
  student_id text NOT NULL,
  course_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal>=0),
  issue text NOT NULL,
  why_unresolved text NOT NULL,
  required_next_input_or_review text NOT NULL,
  blocks_responsible_planning boolean NOT NULL,
  PRIMARY KEY(curriculum_audit_id,ordinal),
  FOREIGN KEY(curriculum_audit_id,student_id,course_id)
    REFERENCES public.teaching_curriculum_audits(curriculum_audit_id,student_id,course_id) ON DELETE CASCADE
);

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_curriculum_audit_source_inventory',
    'teaching_curriculum_audit_topics',
    'teaching_curriculum_audit_learning_units',
    'teaching_curriculum_audit_assumed_prerequisites',
    'teaching_curriculum_audit_source_conflicts',
    'teaching_curriculum_audit_coverage_gaps',
    'teaching_curriculum_audit_structure_change_proposals',
    'teaching_curriculum_audit_unresolved_items'
  ] LOOP
    EXECUTE format('CREATE INDEX %I ON public.%I(student_id,course_id,curriculum_audit_id)', rel || '_owner_idx', rel);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service', rel);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated,service_role,teaching_domain_service', rel);
    EXECUTE format('GRANT INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role,teaching_domain_service', rel);
    EXECUTE format('CREATE POLICY teaching_student_select ON public.%I FOR SELECT TO authenticated USING ((select auth.uid())::text=student_id)', rel);
  END LOOP;
END $$;

COMMIT;
