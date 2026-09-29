-- KIWI Teaching D09 — Semester, Scheduling, Pacing & Time
-- Additive Scheduler/Calendar persistence. No D10 activation state machine is introduced.
BEGIN;

ALTER TABLE public.teaching_semesters
  ADD COLUMN IF NOT EXISTS state_version bigint NOT NULL DEFAULT 1 CHECK (state_version>=1);

CREATE TABLE public.teaching_schedule_profiles (
  profile_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  semester_id text NOT NULL REFERENCES public.teaching_semesters(semester_id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no>=1),
  semester_state_version bigint NOT NULL CHECK (semester_state_version>=1),
  timezone text NOT NULL CHECK (length(btrim(timezone))>0),
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preferences)='object'),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings)='object'),
  headroom_policy_version text NOT NULL,
  supersedes_profile_id text REFERENCES public.teaching_schedule_profiles(profile_id) DEFERRABLE INITIALLY DEFERRED,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(semester_id,version_no)
);
CREATE INDEX teaching_schedule_profiles_current_idx ON public.teaching_schedule_profiles(student_id,semester_id,version_no DESC);

CREATE TABLE public.teaching_availability_windows (
  availability_window_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.teaching_schedule_profiles(profile_id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK(day_of_week between 0 and 6),
  local_start time NOT NULL,
  local_end time NOT NULL,
  kind text NOT NULL CHECK(kind IN ('AVAILABLE','RECOVERY_ONLY','HARD_UNAVAILABLE')),
  preference_weight integer NOT NULL DEFAULT 0 CHECK(preference_weight between -100 and 100),
  effective_start_date date,
  effective_end_date date,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(local_end>local_start),
  CHECK(effective_end_date IS NULL OR effective_start_date IS NULL OR effective_end_date>=effective_start_date)
);
CREATE INDEX teaching_availability_profile_idx ON public.teaching_availability_windows(profile_id,day_of_week,local_start);

CREATE TABLE public.teaching_schedule_blocks (
  schedule_block_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.teaching_schedule_profiles(profile_id) ON DELETE CASCADE,
  course_id text REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  block_kind text NOT NULL CHECK(block_kind IN ('HARD_UNAVAILABLE','BREAK','HOLIDAY','TRAVEL','PROTECTED_REVISION','PROTECTED_ASSESSMENT')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  label text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ends_at>starts_at)
);
CREATE INDEX teaching_schedule_blocks_window_idx ON public.teaching_schedule_blocks(student_id,starts_at,ends_at);

CREATE TABLE public.teaching_schedule_deadlines (
  schedule_deadline_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.teaching_schedule_profiles(profile_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  deadline_kind text NOT NULL CHECK(deadline_kind IN ('HARD','FLEXIBLE')),
  deadline_at timestamptz NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teaching_schedule_deadlines_course_idx ON public.teaching_schedule_deadlines(student_id,course_id,deadline_at);

CREATE TABLE public.teaching_schedule_reserves (
  schedule_reserve_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.teaching_schedule_profiles(profile_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  reserve_kind text NOT NULL CHECK(reserve_kind IN ('REVISION','ASSESSMENT')),
  minutes integer NOT NULL CHECK(minutes>=0),
  protected_start_at timestamptz,
  protected_end_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(protected_end_at IS NULL OR protected_start_at IS NULL OR protected_end_at>protected_start_at)
);
CREATE INDEX teaching_schedule_reserves_course_idx ON public.teaching_schedule_reserves(student_id,course_id,profile_id);

CREATE TABLE public.teaching_timetable_versions (
  timetable_version_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  semester_id text NOT NULL REFERENCES public.teaching_semesters(semester_id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.teaching_schedule_profiles(profile_id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK(version_no>=1),
  timetable_state text NOT NULL CHECK(timetable_state IN ('PROPOSED','EDITED_PROPOSAL','APPROVED','SUPERSEDED','STALE')),
  state_digest text NOT NULL,
  source_kind text NOT NULL,
  course_plan_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(course_plan_refs)='array'),
  supersedes_timetable_version_id text REFERENCES public.teaching_timetable_versions(timetable_version_id) DEFERRABLE INITIALLY DEFERRED,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(semester_id,version_no)
);
CREATE INDEX teaching_timetable_current_idx ON public.teaching_timetable_versions(student_id,semester_id,version_no DESC,timetable_state);

CREATE TABLE public.teaching_timetable_slots (
  timetable_slot_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  timetable_version_id text NOT NULL REFERENCES public.teaching_timetable_versions(timetable_version_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  slot_kind text NOT NULL CHECK(slot_kind IN ('CLASS','REVISION_RESERVE','ASSESSMENT_RESERVE','RECOVERY')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  horizon_stage text NOT NULL CHECK(horizon_stage IN ('IMMINENT','NEAR_TERM','DISTANT')),
  learning_unit_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(learning_unit_refs)='array'),
  planned_minutes integer NOT NULL CHECK(planned_minutes>0),
  exception_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(exception_codes)='array'),
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ends_at>starts_at)
);
CREATE INDEX teaching_timetable_slots_time_idx ON public.teaching_timetable_slots(student_id,starts_at,ends_at);
CREATE INDEX teaching_timetable_slots_course_idx ON public.teaching_timetable_slots(student_id,course_id,starts_at);

CREATE TABLE public.teaching_schedule_feasibility (
  feasibility_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  semester_id text NOT NULL REFERENCES public.teaching_semesters(semester_id) ON DELETE CASCADE,
  timetable_version_id text NOT NULL REFERENCES public.teaching_timetable_versions(timetable_version_id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.teaching_schedule_profiles(profile_id) ON DELETE RESTRICT,
  state_digest text NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('FEASIBLE','AT_RISK','INFEASIBLE','STALE')),
  headroom_policy_version text NOT NULL,
  target_headroom_ratio numeric(5,4) NOT NULL CHECK(target_headroom_ratio between 0 and 1),
  minimum_headroom_ratio numeric(5,4) NOT NULL CHECK(minimum_headroom_ratio between 0 and 1),
  capacity_metrics jsonb NOT NULL CHECK(jsonb_typeof(capacity_metrics)='object'),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(reasons)='array'),
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(alternatives)='array'),
  course_summaries jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(course_summaries)='array'),
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teaching_schedule_feasibility_current_idx ON public.teaching_schedule_feasibility(student_id,semester_id,evaluated_at DESC);

CREATE TABLE public.teaching_schedule_debt_entries (
  schedule_debt_entry_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  semester_id text NOT NULL REFERENCES public.teaching_semesters(semester_id) ON DELETE RESTRICT,
  course_id text REFERENCES public.teaching_courses(course_id) ON DELETE RESTRICT,
  timetable_version_id text REFERENCES public.teaching_timetable_versions(timetable_version_id) ON DELETE RESTRICT,
  delta_minutes integer NOT NULL CHECK(delta_minutes<>0),
  cause_code text NOT NULL,
  source_ref text NOT NULL,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teaching_schedule_debt_semester_idx ON public.teaching_schedule_debt_entries(student_id,semester_id,recorded_at);

CREATE OR REPLACE FUNCTION public.teaching_guard_d09_timetable_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.timetable_version_id IS DISTINCT FROM OLD.timetable_version_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.semester_id IS DISTINCT FROM OLD.semester_id
     OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.state_digest IS DISTINCT FROM OLD.state_digest
     OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.course_plan_refs IS DISTINCT FROM OLD.course_plan_refs
     OR NEW.supersedes_timetable_version_id IS DISTINCT FROM OLD.supersedes_timetable_version_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN RAISE EXCEPTION 'Teaching timetable versions are immutable except for governed timetable_state transitions.';
  END IF;
  IF OLD.timetable_state IN ('SUPERSEDED','STALE') AND NEW.timetable_state IS DISTINCT FROM OLD.timetable_state
  THEN RAISE EXCEPTION 'Historical/stale timetable versions cannot be reactivated.';
  END IF;
  IF OLD.timetable_state='APPROVED' AND NEW.timetable_state NOT IN ('APPROVED','SUPERSEDED','STALE')
  THEN RAISE EXCEPTION 'Approved timetable cannot be demoted to a proposal state.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teaching_d09_timetable_update_guard
BEFORE UPDATE ON public.teaching_timetable_versions
FOR EACH ROW EXECUTE FUNCTION public.teaching_guard_d09_timetable_update();

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'teaching_schedule_profiles','teaching_availability_windows','teaching_schedule_blocks','teaching_schedule_deadlines',
    'teaching_schedule_reserves','teaching_timetable_versions','teaching_timetable_slots','teaching_schedule_feasibility',
    'teaching_schedule_debt_entries'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service', rel);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated,service_role,teaching_domain_service', rel);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((select auth.uid())::text=student_id)',rel||'_student_select',rel);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO teaching_domain_service USING (true)',rel||'_domain_service_select',rel);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO teaching_domain_service WITH CHECK (true)',rel||'_domain_service_insert',rel);
  END LOOP;
END $$;

GRANT INSERT ON
  public.teaching_schedule_profiles,public.teaching_availability_windows,public.teaching_schedule_blocks,
  public.teaching_schedule_deadlines,public.teaching_schedule_reserves,public.teaching_timetable_versions,
  public.teaching_timetable_slots,public.teaching_schedule_feasibility,public.teaching_schedule_debt_entries
TO service_role,teaching_domain_service;
GRANT UPDATE ON public.teaching_timetable_versions TO service_role,teaching_domain_service;
CREATE POLICY teaching_timetable_versions_domain_service_update
  ON public.teaching_timetable_versions FOR UPDATE TO teaching_domain_service USING(true) WITH CHECK(true);

REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON
  public.teaching_schedule_profiles,public.teaching_availability_windows,public.teaching_schedule_blocks,
  public.teaching_schedule_deadlines,public.teaching_schedule_reserves,public.teaching_timetable_versions,
  public.teaching_timetable_slots,public.teaching_schedule_feasibility,public.teaching_schedule_debt_entries
FROM authenticated;

CREATE TRIGGER teaching_schedule_profiles_immutable BEFORE UPDATE OR DELETE ON public.teaching_schedule_profiles
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
CREATE TRIGGER teaching_availability_windows_immutable BEFORE UPDATE OR DELETE ON public.teaching_availability_windows
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
CREATE TRIGGER teaching_schedule_blocks_immutable BEFORE UPDATE OR DELETE ON public.teaching_schedule_blocks
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
CREATE TRIGGER teaching_schedule_deadlines_immutable BEFORE UPDATE OR DELETE ON public.teaching_schedule_deadlines
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
CREATE TRIGGER teaching_schedule_reserves_immutable BEFORE UPDATE OR DELETE ON public.teaching_schedule_reserves
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
CREATE TRIGGER teaching_timetable_slots_immutable BEFORE UPDATE OR DELETE ON public.teaching_timetable_slots
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
CREATE TRIGGER teaching_schedule_feasibility_immutable BEFORE UPDATE OR DELETE ON public.teaching_schedule_feasibility
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();
CREATE TRIGGER teaching_schedule_debt_immutable BEFORE UPDATE OR DELETE ON public.teaching_schedule_debt_entries
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

COMMIT;

-- Recovery contract:
-- Before D09 records exist, remove D09 tables in reverse dependency order and remove
-- teaching_semesters.state_version. Once D09 records exist, use a forward corrective
-- migration. Never delete timetable/debt history to make an infeasible schedule appear
-- feasible, never grant browser mutation rights, and never rewrite Course Plan scope.
