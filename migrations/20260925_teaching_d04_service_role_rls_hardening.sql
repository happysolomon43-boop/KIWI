-- KIWI Teaching D04 hardening — usable privileged service-role boundaries under RLS
-- Corrects TCH-0067/TCH-0068 implementation realization without changing academic ownership.

BEGIN;

ALTER ROLE teaching_domain_service NOLOGIN NOBYPASSRLS;
ALTER ROLE teaching_protected_service NOLOGIN NOBYPASSRLS;

-- Browser roles may never inherit trusted Teaching service roles.
REVOKE teaching_domain_service, teaching_protected_service FROM anon, authenticated;

-- Supabase service_role may explicitly SET ROLE to the narrower D04 privilege groups
-- while retaining its existing direct service grants for current server operation.
GRANT teaching_domain_service, teaching_protected_service TO service_role;

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
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rel||'_domain_service_select', rel);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO teaching_domain_service USING (true)',
      rel||'_domain_service_select', rel
    );

    IF has_table_privilege('teaching_domain_service', format('public.%I', rel), 'INSERT') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rel||'_domain_service_insert', rel);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO teaching_domain_service WITH CHECK (true)',
        rel||'_domain_service_insert', rel
      );
    END IF;

    IF has_table_privilege('teaching_domain_service', format('public.%I', rel), 'UPDATE') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rel||'_domain_service_update', rel);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO teaching_domain_service USING (true) WITH CHECK (true)',
        rel||'_domain_service_update', rel
      );
    END IF;

    REVOKE DELETE, TRUNCATE ON TABLE public.%I FROM teaching_domain_service;
  END LOOP;
END $$;

DO $$
DECLARE rel text;
DECLARE role_name text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'workspaces','authoritative_input_bundles','input_bundle_dependencies','artifact_versions',
    'artifact_components','component_dependencies','artifact_lineage','workspace_candidates',
    'review_findings','finding_component_refs','finding_evidence_rule_refs'
  ] LOOP
    FOREACH role_name IN ARRAY ARRAY['teaching_domain_service','teaching_protected_service'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON teaching_preparation.%I', rel||'_'||role_name||'_select', rel);
      EXECUTE format(
        'CREATE POLICY %I ON teaching_preparation.%I FOR SELECT TO %I USING (true)',
        rel||'_'||role_name||'_select', rel, role_name
      );

      IF has_table_privilege(role_name, format('teaching_preparation.%I', rel), 'INSERT') THEN
        EXECUTE format('DROP POLICY IF EXISTS %I ON teaching_preparation.%I', rel||'_'||role_name||'_insert', rel);
        EXECUTE format(
          'CREATE POLICY %I ON teaching_preparation.%I FOR INSERT TO %I WITH CHECK (true)',
          rel||'_'||role_name||'_insert', rel, role_name
        );
      END IF;

      IF has_table_privilege(role_name, format('teaching_preparation.%I', rel), 'UPDATE') THEN
        EXECUTE format('DROP POLICY IF EXISTS %I ON teaching_preparation.%I', rel||'_'||role_name||'_update', rel);
        EXECUTE format(
          'CREATE POLICY %I ON teaching_preparation.%I FOR UPDATE TO %I USING (true) WITH CHECK (true)',
          rel||'_'||role_name||'_update', rel, role_name
        );
      END IF;

      EXECUTE format('REVOKE DELETE, TRUNCATE ON TABLE teaching_preparation.%I FROM %I', rel, role_name);
    END LOOP;
  END LOOP;
END $$;

DROP POLICY IF EXISTS prepared_artifact_payloads_protected_service_select
  ON teaching_protected.prepared_artifact_payloads;
CREATE POLICY prepared_artifact_payloads_protected_service_select
  ON teaching_protected.prepared_artifact_payloads
  FOR SELECT TO teaching_protected_service USING (true);

DROP POLICY IF EXISTS prepared_artifact_payloads_protected_service_insert
  ON teaching_protected.prepared_artifact_payloads;
CREATE POLICY prepared_artifact_payloads_protected_service_insert
  ON teaching_protected.prepared_artifact_payloads
  FOR INSERT TO teaching_protected_service WITH CHECK (true);

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE teaching_protected.prepared_artifact_payloads
FROM teaching_protected_service, teaching_domain_service;

-- Ordinary domain service stays excluded from protected payload bodies.
REVOKE ALL ON TABLE teaching_protected.prepared_artifact_payloads FROM teaching_domain_service;

COMMIT;

-- Recovery: revoke the two role memberships from service_role and drop only the
-- *_domain_service_* / *_teaching_*service_* policies created here. Do not weaken
-- browser RLS or expose teaching_protected during recovery.
