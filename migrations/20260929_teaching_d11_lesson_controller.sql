-- KIWI Teaching D11 — Lesson Blueprint & Teaching Controller
-- Forward-only extension of the D04 kernel. D08/D09/D10 remain the owners of
-- Course scope, schedule/time obligation and Course/Class activation lineage.

ALTER TABLE public.teaching_lesson_blueprints
  ADD COLUMN IF NOT EXISTS blueprint_state text NOT NULL DEFAULT 'VALIDATED',
  ADD COLUMN IF NOT EXISTS source_course_state_version bigint,
  ADD COLUMN IF NOT EXISTS source_course_plan_version bigint,
  ADD COLUMN IF NOT EXISTS source_class_schedule_version bigint,
  ADD COLUMN IF NOT EXISTS source_timetable_version_id text,
  ADD COLUMN IF NOT EXISTS blueprint_contract_version text NOT NULL DEFAULT 'd11.lesson-blueprint.v1',
  ADD COLUMN IF NOT EXISTS blueprint_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS generation_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS supersedes_lesson_blueprint_id text;

ALTER TABLE public.teaching_lesson_blueprints
  DROP CONSTRAINT IF EXISTS teaching_lesson_blueprints_d11_state_check;
ALTER TABLE public.teaching_lesson_blueprints
  ADD CONSTRAINT teaching_lesson_blueprints_d11_state_check
  CHECK (blueprint_state IN ('VALIDATED','SUPERSEDED'));
ALTER TABLE public.teaching_lesson_blueprints
  DROP CONSTRAINT IF EXISTS teaching_lesson_blueprints_d11_payload_check;
ALTER TABLE public.teaching_lesson_blueprints
  ADD CONSTRAINT teaching_lesson_blueprints_d11_payload_check
  CHECK (
    jsonb_typeof(blueprint_payload)='object'
    AND jsonb_typeof(validation_metadata)='object'
    AND jsonb_typeof(generation_provenance)='object'
  );
ALTER TABLE public.teaching_lesson_blueprints
  DROP CONSTRAINT IF EXISTS teaching_lesson_blueprints_d11_timetable_fk;
ALTER TABLE public.teaching_lesson_blueprints
  ADD CONSTRAINT teaching_lesson_blueprints_d11_timetable_fk
  FOREIGN KEY (source_timetable_version_id)
  REFERENCES public.teaching_timetable_versions(timetable_version_id) ON DELETE RESTRICT;
ALTER TABLE public.teaching_lesson_blueprints
  DROP CONSTRAINT IF EXISTS teaching_lesson_blueprints_d11_supersedes_fk;
ALTER TABLE public.teaching_lesson_blueprints
  ADD CONSTRAINT teaching_lesson_blueprints_d11_supersedes_fk
  FOREIGN KEY (supersedes_lesson_blueprint_id)
  REFERENCES public.teaching_lesson_blueprints(lesson_blueprint_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS teaching_lesson_blueprints_d11_current_idx
  ON public.teaching_lesson_blueprints(student_id,class_id,version_no DESC,blueprint_state);

ALTER TABLE public.teaching_class_sessions
  ADD COLUMN IF NOT EXISTS course_id text,
  ADD COLUMN IF NOT EXISTS course_plan_id text,
  ADD COLUMN IF NOT EXISTS source_course_state_version bigint,
  ADD COLUMN IF NOT EXISTS source_course_plan_version bigint,
  ADD COLUMN IF NOT EXISTS source_class_schedule_version bigint,
  ADD COLUMN IF NOT EXISTS source_timetable_version_id text,
  ADD COLUMN IF NOT EXISTS scheduled_start_at_snapshot timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_end_at_snapshot timestamptz,
  ADD COLUMN IF NOT EXISTS timezone_snapshot text,
  ADD COLUMN IF NOT EXISTS event_cursor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cycle_phase text NOT NULL DEFAULT 'TEACH',
  ADD COLUMN IF NOT EXISTS current_learning_evidence_descriptor text,
  ADD COLUMN IF NOT EXISTS current_assistance_level text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS resume_instructional_substate text,
  ADD COLUMN IF NOT EXISTS break_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS break_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS overtime_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS overtime_ceiling_at timestamptz,
  ADD COLUMN IF NOT EXISTS closure_reason text,
  ADD COLUMN IF NOT EXISTS progress_state jsonb NOT NULL DEFAULT '{"completed_segment_refs":[],"completed_objective_refs":[],"evidence_event_refs":[],"independent_evidence_objective_refs":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS controller_contract_version text NOT NULL DEFAULT 'd11.controller.v1';

ALTER TABLE public.teaching_class_sessions
  DROP CONSTRAINT IF EXISTS teaching_class_sessions_d11_course_fk;
ALTER TABLE public.teaching_class_sessions
  ADD CONSTRAINT teaching_class_sessions_d11_course_fk
  FOREIGN KEY (course_id) REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT;
ALTER TABLE public.teaching_class_sessions
  DROP CONSTRAINT IF EXISTS teaching_class_sessions_d11_plan_fk;
ALTER TABLE public.teaching_class_sessions
  ADD CONSTRAINT teaching_class_sessions_d11_plan_fk
  FOREIGN KEY (course_plan_id) REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE RESTRICT;
ALTER TABLE public.teaching_class_sessions
  DROP CONSTRAINT IF EXISTS teaching_class_sessions_d11_timetable_fk;
ALTER TABLE public.teaching_class_sessions
  ADD CONSTRAINT teaching_class_sessions_d11_timetable_fk
  FOREIGN KEY (source_timetable_version_id)
  REFERENCES public.teaching_timetable_versions(timetable_version_id) ON DELETE RESTRICT;
ALTER TABLE public.teaching_class_sessions
  DROP CONSTRAINT IF EXISTS teaching_class_sessions_d11_lifecycle_check;
ALTER TABLE public.teaching_class_sessions
  ADD CONSTRAINT teaching_class_sessions_d11_lifecycle_check
  CHECK (lifecycle_state IN ('ACTIVE','INTERRUPTED','CLOSED'));
ALTER TABLE public.teaching_class_sessions
  DROP CONSTRAINT IF EXISTS teaching_class_sessions_d11_substate_check;
ALTER TABLE public.teaching_class_sessions
  ADD CONSTRAINT teaching_class_sessions_d11_substate_check
  CHECK (instructional_substate IS NULL OR instructional_substate IN (
    'OPENING','DIAGNOSTIC','INSTRUCTION','GUIDED_PRACTICE','INDEPENDENT_PRACTICE',
    'CLASSWORK','REMEDIATION','BREAK','ASSESSMENT','CLOSURE','INTERRUPTED'
  ));
ALTER TABLE public.teaching_class_sessions
  DROP CONSTRAINT IF EXISTS teaching_class_sessions_d11_resume_substate_check;
ALTER TABLE public.teaching_class_sessions
  ADD CONSTRAINT teaching_class_sessions_d11_resume_substate_check
  CHECK (resume_instructional_substate IS NULL OR resume_instructional_substate IN (
    'OPENING','DIAGNOSTIC','INSTRUCTION','GUIDED_PRACTICE','INDEPENDENT_PRACTICE',
    'CLASSWORK','REMEDIATION'
  ));
ALTER TABLE public.teaching_class_sessions
  DROP CONSTRAINT IF EXISTS teaching_class_sessions_d11_cycle_check;
ALTER TABLE public.teaching_class_sessions
  ADD CONSTRAINT teaching_class_sessions_d11_cycle_check
  CHECK (
    cycle_phase IN ('TEACH','ELICIT_CHECK','DIAGNOSE','RESPOND','VERIFY')
    AND (current_learning_evidence_descriptor IS NULL OR current_learning_evidence_descriptor IN (
      'DEMONSTRATION','GUIDED','INDEPENDENT_FAMILIAR','INDEPENDENT_VARIED',
      'METHOD_SELECTION','DELAYED_RETRIEVAL','INTEGRATION_TRANSFER'
    ))
    AND current_assistance_level IN ('NONE','LIGHT','GUIDED','MODELED')
  );

ALTER TABLE public.teaching_class_sessions
  DROP CONSTRAINT IF EXISTS teaching_class_sessions_d11_progress_check;
ALTER TABLE public.teaching_class_sessions
  ADD CONSTRAINT teaching_class_sessions_d11_progress_check
  CHECK (
    event_cursor >= 0
    AND jsonb_typeof(progress_state)='object'
    AND (break_ends_at IS NULL OR break_started_at IS NULL OR break_ends_at > break_started_at)
    AND (
      overtime_ceiling_at IS NULL OR scheduled_end_at_snapshot IS NULL
      OR overtime_ceiling_at <= scheduled_end_at_snapshot + interval '15 minutes'
    )
    AND (
      break_ends_at IS NULL OR scheduled_end_at_snapshot IS NULL
      OR break_ends_at <= scheduled_end_at_snapshot
    )
  );
CREATE UNIQUE INDEX IF NOT EXISTS teaching_class_sessions_d11_class_uidx
  ON public.teaching_class_sessions(student_id,class_id);
CREATE INDEX IF NOT EXISTS teaching_class_sessions_d11_active_idx
  ON public.teaching_class_sessions(student_id,lifecycle_state,updated_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_class_controller_history (
  controller_history_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE RESTRICT,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE RESTRICT,
  controller_version bigint NOT NULL CHECK(controller_version>=0),
  event_cursor bigint NOT NULL CHECK(event_cursor>=0),
  action_kind text NOT NULL,
  from_state text,
  to_state text,
  reason text,
  source_event_ref text,
  idempotency_key text,
  occurred_at timestamptz NOT NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(safe_metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_class_controller_history_idempotency_uidx
  ON public.teaching_class_controller_history(student_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_class_controller_history_session_idx
  ON public.teaching_class_controller_history(student_id,class_session_id,controller_version,event_cursor);

CREATE TABLE IF NOT EXISTS public.teaching_class_closure_facts (
  closure_fact_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  class_id text NOT NULL UNIQUE REFERENCES public.teaching_classes(class_id) ON DELETE RESTRICT,
  class_session_id text NOT NULL UNIQUE REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE RESTRICT,
  lesson_blueprint_id text REFERENCES public.teaching_lesson_blueprints(lesson_blueprint_id) ON DELETE RESTRICT,
  controller_version bigint NOT NULL,
  fact_pack_version text NOT NULL,
  fact_pack jsonb NOT NULL CHECK(jsonb_typeof(fact_pack)='object'),
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(provenance_refs)='array'),
  closed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teaching_class_closure_facts_course_idx
  ON public.teaching_class_closure_facts(student_id,course_id,closed_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_class_summaries (
  class_summary_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE RESTRICT,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE RESTRICT,
  closure_fact_id text NOT NULL REFERENCES public.teaching_class_closure_facts(closure_fact_id) ON DELETE RESTRICT,
  version_no bigint NOT NULL CHECK(version_no>=1),
  summary_state text NOT NULL CHECK(summary_state IN ('TRANSLATED','ROUTE_HELD','REVIEW_NEEDED')),
  summary_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(summary_payload)='object'),
  translation_provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(translation_provenance)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(class_session_id,version_no)
);
CREATE INDEX IF NOT EXISTS teaching_class_summaries_student_idx
  ON public.teaching_class_summaries(student_id,class_id,version_no DESC);

CREATE TABLE IF NOT EXISTS public.teaching_post_class_teacher_notes (
  teacher_note_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE RESTRICT,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE RESTRICT,
  closure_fact_id text NOT NULL REFERENCES public.teaching_class_closure_facts(closure_fact_id) ON DELETE RESTRICT,
  version_no bigint NOT NULL CHECK(version_no>=1),
  note_state text NOT NULL CHECK(note_state IN ('PRIVATE_NOTE','ROUTE_HELD','REVIEW_NEEDED')),
  note_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(note_payload)='object'),
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(provenance_refs)='array'),
  generation_provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(generation_provenance)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(class_session_id,version_no)
);
CREATE INDEX IF NOT EXISTS teaching_post_class_teacher_notes_course_idx
  ON public.teaching_post_class_teacher_notes(student_id,course_id,created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS teaching_preparation_d11_next_class_workspace_uidx
  ON teaching_preparation.workspaces(student_id,target_kind,target_ref)
  WHERE target_kind='next_class' AND lifecycle_state NOT IN ('SUPERSEDED','CANCELLED');

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_class_controller_history',
    'teaching_class_closure_facts',
    'teaching_class_summaries',
    'teaching_post_class_teacher_notes'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service',rel);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role,teaching_domain_service',rel);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO teaching_domain_service USING (true)',rel||'_domain_select',rel);
  END LOOP;
END $$;

GRANT SELECT ON public.teaching_class_summaries TO authenticated;
CREATE POLICY teaching_class_summaries_student_select
  ON public.teaching_class_summaries
  FOR SELECT TO authenticated
  USING ((select auth.uid())::text=student_id);

GRANT INSERT ON
  public.teaching_class_controller_history,
  public.teaching_class_closure_facts,
  public.teaching_class_summaries,
  public.teaching_post_class_teacher_notes
TO service_role,teaching_domain_service;

REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON
  public.teaching_lesson_blueprints,
  public.teaching_class_sessions,
  public.teaching_class_controller_history,
  public.teaching_class_closure_facts,
  public.teaching_class_summaries,
  public.teaching_post_class_teacher_notes
FROM authenticated,anon,public;

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_class_controller_history',
    'teaching_class_closure_facts',
    'teaching_class_summaries',
    'teaching_post_class_teacher_notes'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',rel||'_immutable',rel);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation()',
      rel||'_immutable',rel
    );
  END LOOP;
END $$;
