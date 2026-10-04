-- KIWI Teaching D26 — coordination, notification delivery audit, Review Needs and Recovery Cases.
-- Additive only. Existing owners retain Calendar, Attendance, Work, Assessment, Gradebook, SKM and Progression truth.
BEGIN;

CREATE TABLE IF NOT EXISTS public.teaching_notification_deliveries(
 delivery_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 dedupe_key text NOT NULL UNIQUE, notification_kind text NOT NULL,
 source_owner text NOT NULL, source_entity_type text NOT NULL, source_entity_id text NOT NULL, source_version text NOT NULL,
 deep_link text NOT NULL, delivered_at timestamptz NOT NULL, provider_ref text,
 attempt_count integer NOT NULL DEFAULT 1 CHECK(attempt_count>0), last_attempt_at timestamptz
);
COMMENT ON TABLE public.teaching_notification_deliveries IS 'D26 delivery/idempotency audit for shared KIWI notifications. Delivery is never attendance, mark, attempt, deadline or other academic evidence.';
CREATE INDEX IF NOT EXISTS teaching_notification_deliveries_student_time_idx ON public.teaching_notification_deliveries(student_id,delivered_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_review_needs(
 review_need_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
 learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
 misconception_key text NOT NULL, severity text NOT NULL CHECK(severity IN('LOW','MEDIUM','HIGH','CRITICAL')),
 self_report_only boolean NOT NULL DEFAULT false, source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
 status text NOT NULL CHECK(status IN('OPEN','ACTIVE','RESOLVED','CLOSED')), version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 first_detected_at timestamptz NOT NULL, last_detected_at timestamptz NOT NULL,
 CHECK(jsonb_typeof(source_refs)='array')
);
COMMENT ON TABLE public.teaching_review_needs IS 'D26 deduplicated Learning Unit/misconception coordination. It does not mutate or duplicate D13 mastery/SKM truth.';
CREATE UNIQUE INDEX IF NOT EXISTS teaching_review_needs_open_dedupe_idx ON public.teaching_review_needs(student_id,learning_unit_id,misconception_key) WHERE status IN('OPEN','ACTIVE');

CREATE TABLE IF NOT EXISTS public.teaching_recovery_cases(
 case_id text PRIMARY KEY, student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
 idempotency_key text NOT NULL, state text NOT NULL CHECK(state IN('DETECTED','CLASSIFIED','AWAITING_STUDENT_ACTION','RECOVERY_PROPOSED','SCHEDULED','IN_PROGRESS','AWAITING_VERIFICATION','RESOLVED','ESCALATED','CLOSED')),
 classification text NOT NULL, cause text NOT NULL, policy_at_event text NOT NULL,
 missing_instruction text, missing_evidence text, next_action text NOT NULL, repair_proposal text,
 student_action text, verification_criteria jsonb, version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(student_id,idempotency_key)
);
COMMENT ON TABLE public.teaching_recovery_cases IS 'D26 workflow/reference record only. Never copies or owns marks, attendance, attempts, timetable, SKM or progression truth.';
CREATE INDEX IF NOT EXISTS teaching_recovery_cases_student_state_idx ON public.teaching_recovery_cases(student_id,state,updated_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_recovery_case_sources(
 case_id text NOT NULL REFERENCES public.teaching_recovery_cases(case_id) ON DELETE CASCADE,
 source_owner text NOT NULL CHECK(source_owner IN('D09_SCHEDULER','D10_REQUESTS','D13_SKM','D14_CLASSROOM','D15_ATTENDANCE','D16_WORK','D17_ASSESSMENT','D18_ASSESSMENT_SHELL','D19_ASSESSMENT_TYPES','D20_GRADEBOOK','D21_PROGRESSION','D25_RELIABILITY')),
 source_entity_type text NOT NULL, source_entity_id text NOT NULL, source_version text NOT NULL, source_event_id text,
 PRIMARY KEY(case_id,source_owner,source_entity_type,source_entity_id,source_version)
);

CREATE TABLE IF NOT EXISTS public.teaching_recovery_case_history(
 history_id text PRIMARY KEY, case_id text NOT NULL REFERENCES public.teaching_recovery_cases(case_id) ON DELETE CASCADE,
 from_state text, to_state text NOT NULL, reason text NOT NULL, occurred_at timestamptz NOT NULL, version bigint NOT NULL CHECK(version>0),
 UNIQUE(case_id,version)
);

ALTER TABLE public.teaching_notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_review_needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_recovery_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_recovery_case_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_recovery_case_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teaching_notification_deliveries,public.teaching_review_needs,public.teaching_recovery_cases,public.teaching_recovery_case_sources,public.teaching_recovery_case_history FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.teaching_notification_deliveries,public.teaching_review_needs,public.teaching_recovery_cases,public.teaching_recovery_case_sources,public.teaching_recovery_case_history TO service_role;

COMMIT;

-- Rollback (only after stopping D26 workers and exporting audit data):
-- DROP TABLE public.teaching_recovery_case_history,public.teaching_recovery_case_sources,public.teaching_recovery_cases,public.teaching_review_needs,public.teaching_notification_deliveries;
