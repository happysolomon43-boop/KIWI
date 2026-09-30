-- D15 Attendance Ledger. Attendance is a separate authoritative domain from
-- Class lifecycle, participation/classwork, SKM, Assessment Attempts and Gradebook marks.
-- Rows are immutable versions; corrections append a superseding version.

CREATE TABLE public.teaching_attendance_records (
  attendance_record_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
  attendance_obligation_id text NOT NULL,
  academic_obligation_ref text NOT NULL,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  schedule_version bigint NOT NULL CHECK (schedule_version >= 1),
  source_timetable_version_id text REFERENCES public.teaching_timetable_versions(timetable_version_id) ON DELETE SET NULL,
  source_timetable_slot_id text REFERENCES public.teaching_timetable_slots(timetable_slot_id) ON DELETE SET NULL,
  scheduled_start_at timestamptz NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  obligation_state text NOT NULL CHECK (obligation_state IN ('REQUIRED','NO_OBLIGATION')),
  obligation_disposition text,
  outcome text NOT NULL CHECK (outcome IN (
    'PENDING','ON_TIME','LATE','PARTIAL','UNEXCUSED_ABSENCE','EXCUSED_ABSENCE',
    'APPROVED_LEAVE','INTERRUPTED','SYSTEM_PROTECTED','NO_OBLIGATION','RESCHEDULED'
  )),
  presence_state text NOT NULL CHECK (presence_state IN ('UNESTABLISHED','PRESENT','MEANINGFUL','INTERRUPTED')),
  arrived_at timestamptz,
  exited_at timestamptz,
  grace_minutes integer NOT NULL CHECK (grace_minutes >= 0),
  late_minutes integer CHECK (late_minutes IS NULL OR late_minutes >= 0),
  material_lateness boolean NOT NULL DEFAULT false,
  missed_minutes integer NOT NULL DEFAULT 0 CHECK (missed_minutes >= 0),
  behavior_relevant boolean NOT NULL DEFAULT false,
  interruption_kind text,
  recovery_state text NOT NULL CHECK (recovery_state IN ('NONE','DIAGNOSIS_REQUIRED','SCHEDULER_REVIEW_REQUIRED')),
  participation_evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(participation_evidence)='array'),
  policy_snapshot jsonb NOT NULL CHECK (jsonb_typeof(policy_snapshot)='object'),
  recovery_facts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(recovery_facts)='object'),
  source_event_id text,
  source_request_id text REFERENCES public.teaching_requests(request_id) ON DELETE SET NULL,
  correction_kind text,
  correction_reason text,
  supersedes_record_id text REFERENCES public.teaching_attendance_records(attendance_record_id) ON DELETE RESTRICT,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  idempotency_key text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,attendance_obligation_id,version_no),
  UNIQUE(student_id,idempotency_key),
  CHECK (scheduled_end_at > scheduled_start_at),
  CHECK (version_no = 1 OR supersedes_record_id IS NOT NULL),
  CHECK (correction_kind IS NULL OR supersedes_record_id IS NOT NULL)
);
CREATE INDEX teaching_attendance_records_course_idx ON public.teaching_attendance_records(student_id,course_id,scheduled_start_at DESC,version_no DESC);
CREATE INDEX teaching_attendance_records_class_idx ON public.teaching_attendance_records(student_id,class_id,version_no DESC);
CREATE INDEX teaching_attendance_records_obligation_idx ON public.teaching_attendance_records(student_id,attendance_obligation_id,version_no DESC);
CREATE INDEX teaching_attendance_records_academic_obligation_idx ON public.teaching_attendance_records(student_id,academic_obligation_ref,recorded_at DESC);
CREATE INDEX teaching_attendance_records_course_fk_idx ON public.teaching_attendance_records(course_id);
CREATE INDEX teaching_attendance_records_class_fk_idx ON public.teaching_attendance_records(class_id);
CREATE INDEX teaching_attendance_records_timetable_fk_idx ON public.teaching_attendance_records(source_timetable_version_id);
CREATE INDEX teaching_attendance_records_slot_fk_idx ON public.teaching_attendance_records(source_timetable_slot_id);
CREATE INDEX teaching_attendance_records_request_fk_idx ON public.teaching_attendance_records(source_request_id);
CREATE INDEX teaching_attendance_records_supersedes_fk_idx ON public.teaching_attendance_records(supersedes_record_id);

CREATE TABLE public.teaching_attendance_concerns (
  attendance_concern_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  policy_version text NOT NULL,
  concern_state text NOT NULL CHECK (concern_state IN ('OPEN','RESOLVED')),
  incident_record_refs jsonb NOT NULL CHECK (jsonb_typeof(incident_record_refs)='array'),
  evaluated_obligations integer NOT NULL CHECK (evaluated_obligations >= 0),
  incident_count integer NOT NULL CHECK (incident_count >= 0),
  actions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(actions)='array'),
  explanation_facts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(explanation_facts)='object'),
  subject_mark_reduction boolean NOT NULL DEFAULT false CHECK (subject_mark_reduction = false),
  idempotency_key text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_attendance_concerns_course_idx ON public.teaching_attendance_concerns(student_id,course_id,opened_at DESC);
CREATE INDEX teaching_attendance_concerns_course_fk_idx ON public.teaching_attendance_concerns(course_id);

CREATE TABLE public.teaching_attendance_system_interruptions (
  interruption_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
  incident_ref text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  source_authority text NOT NULL CHECK (source_authority IN ('KIWI_RUNTIME','PLATFORM_OPERATIONS')),
  verified boolean NOT NULL DEFAULT true CHECK (verified = true),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,class_id,incident_ref),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX teaching_attendance_system_interruptions_class_idx ON public.teaching_attendance_system_interruptions(student_id,class_id,starts_at DESC);
CREATE INDEX teaching_attendance_system_interruptions_class_fk_idx ON public.teaching_attendance_system_interruptions(class_id);

ALTER TABLE public.teaching_attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_attendance_concerns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_attendance_system_interruptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.teaching_attendance_records,public.teaching_attendance_concerns,public.teaching_attendance_system_interruptions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.teaching_attendance_records,public.teaching_attendance_concerns,public.teaching_attendance_system_interruptions TO service_role;

COMMENT ON TABLE public.teaching_attendance_records IS 'D15 immutable versioned Attendance Ledger. Latest version is authoritative attendance/punctuality truth; no row may author Gradebook, SKM, Assessment Attempt, or Class Controller state.';
COMMENT ON TABLE public.teaching_attendance_concerns IS 'D15 support/escalation facts under versioned attendance-concern policy. Never a subject-mark deduction or character score.';
COMMENT ON TABLE public.teaching_attendance_system_interruptions IS 'Trusted server/operations evidence for KIWI-caused interruption protection. No browser-facing write grant.';
