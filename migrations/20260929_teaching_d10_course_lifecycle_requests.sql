-- KIWI Teaching D10 — Course Activation, Lifecycle & Formal Requests
-- Forward-safe migration. D10 remains deterministic and preserves D08/D09 authority.

ALTER TABLE public.teaching_courses
  ADD COLUMN IF NOT EXISTS status_overlays text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS progression_outcome text,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS academic_record_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_id text;

ALTER TABLE public.teaching_courses DROP CONSTRAINT IF EXISTS teaching_course_lifecycle_d10;
ALTER TABLE public.teaching_courses ADD CONSTRAINT teaching_course_lifecycle_d10
  CHECK (lifecycle_state IN ('DRAFT','READY','ACTIVE','PAUSED','TEACHING_ENDED','FINALIZING','INCOMPLETE','COMPLETED','ARCHIVED'));

ALTER TABLE public.teaching_courses DROP CONSTRAINT IF EXISTS teaching_course_progression_outcome_d10;
ALTER TABLE public.teaching_courses ADD CONSTRAINT teaching_course_progression_outcome_d10
  CHECK (progression_outcome IS NULL OR progression_outcome IN ('PASS','PASS_REMEDIATION_REQUIRED','RESIT_REQUIRED','RECOVERY_REQUIRED','REPEAT_REQUIRED','INCOMPLETE'));

ALTER TABLE public.teaching_classes
  ADD COLUMN IF NOT EXISTS source_timetable_version_id text,
  ADD COLUMN IF NOT EXISTS source_timetable_slot_id text,
  ADD COLUMN IF NOT EXISTS activation_id text,
  ADD COLUMN IF NOT EXISTS source_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS teaching_classes_timetable_slot_uidx
  ON public.teaching_classes(student_id,source_timetable_slot_id)
  WHERE source_timetable_slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_classes_source_timetable_idx
  ON public.teaching_classes(student_id,source_timetable_version_id,scheduled_start_at);

CREATE TABLE IF NOT EXISTS public.teaching_grading_policy_versions (
  grading_policy_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  version_no bigint NOT NULL CHECK(version_no>=1),
  policy_kind text NOT NULL CHECK(policy_kind IN ('KIWI_DEFAULT','EXTERNAL')),
  policy_version_ref text NOT NULL,
  category_weights jsonb NOT NULL CHECK(jsonb_typeof(category_weights)='object'),
  rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(rules)='object'),
  locked_at timestamptz,
  supersedes_grading_policy_id text REFERENCES public.teaching_grading_policy_versions(grading_policy_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id,version_no)
);
CREATE INDEX IF NOT EXISTS teaching_grading_policy_course_idx ON public.teaching_grading_policy_versions(student_id,course_id,version_no DESC);

CREATE TABLE IF NOT EXISTS public.teaching_course_teacher_assignments (
  teacher_assignment_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  teacher_identity_id text NOT NULL REFERENCES public.teaching_teacher_identities(teacher_identity_id) ON DELETE RESTRICT,
  version_no bigint NOT NULL CHECK(version_no>=1),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  source_request_id text,
  supersedes_teacher_assignment_id text REFERENCES public.teaching_course_teacher_assignments(teacher_assignment_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id,version_no),
  CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE INDEX IF NOT EXISTS teaching_course_teacher_assignment_current_idx
  ON public.teaching_course_teacher_assignments(student_id,course_id,effective_from DESC);

CREATE TABLE IF NOT EXISTS public.teaching_course_activations (
  activation_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  course_id text NOT NULL UNIQUE REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  semester_id text NOT NULL REFERENCES public.teaching_semesters(semester_id) ON DELETE RESTRICT,
  course_state_version bigint NOT NULL,
  semester_state_version bigint NOT NULL,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE RESTRICT,
  course_plan_version bigint NOT NULL,
  course_plan_source_snapshot_ref text NOT NULL,
  grading_policy_id text NOT NULL REFERENCES public.teaching_grading_policy_versions(grading_policy_id) ON DELETE RESTRICT,
  grading_policy_version bigint NOT NULL,
  timetable_version_id text NOT NULL REFERENCES public.teaching_timetable_versions(timetable_version_id) ON DELETE RESTRICT,
  timetable_version bigint NOT NULL,
  teacher_assignment_id text NOT NULL REFERENCES public.teaching_course_teacher_assignments(teacher_assignment_id) ON DELETE RESTRICT,
  teacher_identity_id text NOT NULL REFERENCES public.teaching_teacher_identities(teacher_identity_id) ON DELETE RESTRICT,
  admission_policy_version text NOT NULL,
  concurrent_count_before integer NOT NULL CHECK(concurrent_count_before>=0),
  activated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teaching_course_activations_student_idx ON public.teaching_course_activations(student_id,activated_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_course_lifecycle_history (
  lifecycle_event_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  from_state text NOT NULL,
  to_state text NOT NULL,
  state_version bigint NOT NULL,
  actor_authority text NOT NULL,
  reason text,
  source_request_id text,
  policy_version text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teaching_course_lifecycle_history_idx ON public.teaching_course_lifecycle_history(student_id,course_id,occurred_at);

CREATE TABLE IF NOT EXISTS public.teaching_course_closure_records (
  closure_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  lifecycle_state_at_closure text NOT NULL,
  closure_kind text NOT NULL CHECK(closure_kind IN ('INCOMPLETE_ADMINISTRATIVE_ARCHIVE','CANCELLATION')),
  reason text NOT NULL,
  source_request_id text,
  closed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teaching_course_closure_idx ON public.teaching_course_closure_records(student_id,course_id,closed_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_course_admission_policies (
  policy_version text PRIMARY KEY,
  maximum_concurrent_courses integer NOT NULL CHECK(maximum_concurrent_courses>=1),
  counted_states text[] NOT NULL,
  rollout jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(rollout)='object'),
  enabled boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.teaching_course_admission_policies(policy_version,maximum_concurrent_courses,counted_states,rollout,effective_from)
VALUES('four-course-launch.v1',4,ARRAY['READY','ACTIVE','PAUSED','INCOMPLETE']::text[],'{"schema_maximum":false,"one_student_identity":true,"eight_course_stress_required":true}'::jsonb,'2026-09-29T00:00:00Z')
ON CONFLICT(policy_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.teaching_course_admission_decisions (
  admission_decision_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  decision_kind text NOT NULL CHECK(decision_kind IN ('READY','ACTIVATION','RESUME','CLOSURE')),
  policy_version text NOT NULL REFERENCES public.teaching_course_admission_policies(policy_version) ON DELETE RESTRICT,
  maximum_concurrent_courses integer NOT NULL,
  concurrent_count_before integer NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('ALLOW','BLOCK','RELEASE')),
  reason text,
  source_request_id text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teaching_course_admission_decisions_idx ON public.teaching_course_admission_decisions(student_id,course_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_requests (
  request_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  request_type text NOT NULL CHECK(request_type IN (
    'SINGLE_CLASS_RESCHEDULE','PERMANENT_AVAILABILITY_CHANGE','ACADEMIC_BREAK','EMERGENCY_ABSENCE',
    'COURSE_PAUSE','COURSE_RESUME','REDUCED_LOAD_WEEK','TEACHER_CHANGE','ASSIGNMENT_EXTENSION',
    'EARLY_DISMISSAL','ATTENDANCE_REVIEW_CORRECTION','COURSE_CANCELLATION'
  )),
  requester_type text NOT NULL CHECK(requester_type IN ('STUDENT','SYSTEM','ADMIN')),
  requester_id text,
  target_owner text NOT NULL,
  target_type text NOT NULL,
  target_ref text NOT NULL,
  target_version_ref text,
  lifecycle_state text NOT NULL DEFAULT 'DRAFT' CHECK(lifecycle_state IN (
    'DRAFT','SUBMITTED','REVIEWING','APPROVED','APPROVED_WITH_ADJUSTMENT','ALTERNATIVE_PROPOSED',
    'REJECTED','WITHDRAWN','APPLIED','CLOSED'
  )),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
  requested_change jsonb NOT NULL CHECK(jsonb_typeof(requested_change)='object'),
  explanation text,
  decision jsonb CHECK(decision IS NULL OR jsonb_typeof(decision)='object'),
  effective_at timestamptz,
  alternative_proposal jsonb CHECK(alternative_proposal IS NULL OR jsonb_typeof(alternative_proposal)='object'),
  alternative_version bigint,
  student_response text CHECK(student_response IS NULL OR student_response IN ('ACCEPTED','DECLINED')),
  responded_at timestamptz,
  application_ref text,
  applied_at timestamptz,
  close_reason text,
  closed_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_requests_idempotency_uidx
  ON public.teaching_requests(student_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_requests_student_state_idx ON public.teaching_requests(student_id,lifecycle_state,updated_at DESC);
CREATE INDEX IF NOT EXISTS teaching_requests_course_idx ON public.teaching_requests(student_id,course_id,created_at DESC);
CREATE INDEX IF NOT EXISTS teaching_requests_target_idx ON public.teaching_requests(student_id,target_owner,target_ref);

CREATE TABLE IF NOT EXISTS public.teaching_request_history (
  request_history_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  request_id text NOT NULL REFERENCES public.teaching_requests(request_id) ON DELETE RESTRICT,
  request_version bigint NOT NULL,
  from_state text,
  to_state text NOT NULL,
  actor_type text NOT NULL,
  actor_authority text NOT NULL,
  reason text,
  explanation text,
  target_version_ref text,
  application_ref text,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(safe_metadata)='object'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teaching_request_history_idx ON public.teaching_request_history(student_id,request_id,request_version);

CREATE TABLE IF NOT EXISTS public.teaching_request_applications (
  request_application_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  request_id text NOT NULL UNIQUE REFERENCES public.teaching_requests(request_id) ON DELETE RESTRICT,
  request_version bigint NOT NULL,
  target_owner text NOT NULL,
  target_ref text NOT NULL,
  target_version_before text,
  target_version_after text,
  application_ref text NOT NULL UNIQUE,
  applied_at timestamptz NOT NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(safe_metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teaching_request_applications_student_idx ON public.teaching_request_applications(student_id,applied_at DESC);

CREATE OR REPLACE FUNCTION public.teaching_guard_d10_course_lifecycle()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    IF NOT (
      (OLD.lifecycle_state='DRAFT' AND NEW.lifecycle_state='READY') OR
      (OLD.lifecycle_state='READY' AND NEW.lifecycle_state='ACTIVE') OR
      (OLD.lifecycle_state='ACTIVE' AND NEW.lifecycle_state IN ('PAUSED','TEACHING_ENDED')) OR
      (OLD.lifecycle_state='PAUSED' AND NEW.lifecycle_state IN ('ACTIVE','TEACHING_ENDED')) OR
      (OLD.lifecycle_state='TEACHING_ENDED' AND NEW.lifecycle_state='FINALIZING') OR
      (OLD.lifecycle_state='FINALIZING' AND NEW.lifecycle_state IN ('INCOMPLETE','COMPLETED')) OR
      (OLD.lifecycle_state='INCOMPLETE' AND NEW.lifecycle_state='FINALIZING') OR
      (OLD.lifecycle_state='COMPLETED' AND NEW.lifecycle_state='ARCHIVED')
    ) THEN RAISE EXCEPTION 'Invalid Teaching Course lifecycle transition % -> %',OLD.lifecycle_state,NEW.lifecycle_state;
    END IF;
    IF NEW.state_version <> OLD.state_version + 1 THEN
      RAISE EXCEPTION 'Course lifecycle transitions must increment state_version exactly once.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS teaching_d10_course_lifecycle_guard ON public.teaching_courses;
CREATE TRIGGER teaching_d10_course_lifecycle_guard
BEFORE UPDATE ON public.teaching_courses FOR EACH ROW EXECUTE FUNCTION public.teaching_guard_d10_course_lifecycle();

CREATE OR REPLACE FUNCTION public.teaching_guard_d10_request_update()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.request_type IS DISTINCT FROM OLD.request_type
     OR NEW.requester_type IS DISTINCT FROM OLD.requester_type OR NEW.requester_id IS DISTINCT FROM OLD.requester_id
     OR NEW.target_owner IS DISTINCT FROM OLD.target_owner OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.target_ref IS DISTINCT FROM OLD.target_ref OR NEW.target_version_ref IS DISTINCT FROM OLD.target_version_ref
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN RAISE EXCEPTION 'Teaching Request identity/target binding is immutable.'; END IF;
  IF OLD.lifecycle_state<>'DRAFT' AND NEW.requested_change IS DISTINCT FROM OLD.requested_change
  THEN RAISE EXCEPTION 'Submitted Teaching Request content is immutable.'; END IF;
  IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    allowed := CASE OLD.lifecycle_state
      WHEN 'DRAFT' THEN NEW.lifecycle_state IN ('SUBMITTED','WITHDRAWN')
      WHEN 'SUBMITTED' THEN NEW.lifecycle_state IN ('REVIEWING','WITHDRAWN')
      WHEN 'REVIEWING' THEN NEW.lifecycle_state IN ('APPROVED','APPROVED_WITH_ADJUSTMENT','ALTERNATIVE_PROPOSED','REJECTED','WITHDRAWN')
      WHEN 'APPROVED' THEN NEW.lifecycle_state IN ('APPLIED','CLOSED')
      WHEN 'APPROVED_WITH_ADJUSTMENT' THEN NEW.lifecycle_state IN ('APPLIED','CLOSED')
      WHEN 'ALTERNATIVE_PROPOSED' THEN NEW.lifecycle_state IN ('APPROVED_WITH_ADJUSTMENT','CLOSED','WITHDRAWN')
      WHEN 'REJECTED' THEN NEW.lifecycle_state='CLOSED'
      WHEN 'WITHDRAWN' THEN NEW.lifecycle_state='CLOSED'
      WHEN 'APPLIED' THEN NEW.lifecycle_state='CLOSED'
      ELSE false END;
    IF NOT allowed THEN RAISE EXCEPTION 'Invalid Teaching Request transition % -> %',OLD.lifecycle_state,NEW.lifecycle_state; END IF;
    IF NEW.state_version <> OLD.state_version + 1 THEN RAISE EXCEPTION 'Request transitions must increment state_version exactly once.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS teaching_d10_request_guard ON public.teaching_requests;
CREATE TRIGGER teaching_d10_request_guard
BEFORE UPDATE ON public.teaching_requests FOR EACH ROW EXECUTE FUNCTION public.teaching_guard_d10_request_update();

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_grading_policy_versions','teaching_course_teacher_assignments','teaching_course_activations',
    'teaching_course_lifecycle_history','teaching_course_closure_records','teaching_course_admission_decisions',
    'teaching_requests','teaching_request_history','teaching_request_applications'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service',rel);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated,service_role,teaching_domain_service',rel);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((select auth.uid())::text=student_id)',rel||'_student_select',rel);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO teaching_domain_service USING (true)',rel||'_domain_select',rel);
  END LOOP;
END $$;

ALTER TABLE public.teaching_course_admission_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.teaching_course_admission_policies FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service;
GRANT SELECT ON TABLE public.teaching_course_admission_policies TO service_role,teaching_domain_service;
CREATE POLICY teaching_course_admission_policies_domain_select ON public.teaching_course_admission_policies
  FOR SELECT TO teaching_domain_service USING (true);

GRANT INSERT,UPDATE ON
  public.teaching_grading_policy_versions,public.teaching_course_teacher_assignments,public.teaching_requests
TO service_role,teaching_domain_service;
GRANT INSERT ON
  public.teaching_course_activations,public.teaching_course_lifecycle_history,public.teaching_course_closure_records,
  public.teaching_course_admission_decisions,public.teaching_request_history,public.teaching_request_applications
TO service_role,teaching_domain_service;
GRANT SELECT ON public.teaching_course_admission_policies TO service_role,teaching_domain_service;

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_course_activations','teaching_course_lifecycle_history','teaching_course_closure_records',
    'teaching_course_admission_decisions','teaching_request_history','teaching_request_applications'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',rel||'_immutable',rel);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation()',rel||'_immutable',rel);
  END LOOP;
END $$;

-- Browser clients remain read-only for all authoritative D10 state.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON
  public.teaching_courses,public.teaching_classes,public.teaching_grading_policy_versions,
  public.teaching_course_teacher_assignments,public.teaching_course_activations,public.teaching_course_lifecycle_history,
  public.teaching_course_closure_records,public.teaching_course_admission_decisions,public.teaching_requests,
  public.teaching_request_history,public.teaching_request_applications
FROM authenticated,anon,public;
