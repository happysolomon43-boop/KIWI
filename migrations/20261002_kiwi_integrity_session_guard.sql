-- KIWI Integrity Session Guard + Submission Verification Gate amendment.
-- This migration deliberately extends existing D16 Work and legacy KIWI Exam owners;
-- it does not create a competing Assignment or Exam Attempt source of truth.

ALTER TABLE public.teaching_assignment_submissions
  DROP CONSTRAINT IF EXISTS teaching_assignment_submissions_submission_kind_check;
ALTER TABLE public.teaching_assignment_submissions
  ADD CONSTRAINT teaching_assignment_submissions_submission_kind_check
  CHECK (submission_kind IN ('DRAFT','PENDING_FINAL','FINAL','PENDING_CORRECTION','CORRECTION','VERIFICATION'));

-- Production Study/CBT has a richer legacy exam_sessions shape than the isolated
-- Teaching integration database. Add only the shared fields required by the
-- Integrity Session Guard so both environments converge without replacing Exam truth.
ALTER TABLE public.exam_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.exam_sessions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'in_progress';
ALTER TABLE public.exam_sessions ADD COLUMN IF NOT EXISTS is_reckoning boolean NOT NULL DEFAULT false;
ALTER TABLE public.exam_sessions ADD COLUMN IF NOT EXISTS integrity_policy_version text;
ALTER TABLE public.exam_sessions ADD COLUMN IF NOT EXISTS integrity_session_state text NOT NULL DEFAULT 'NONE';
ALTER TABLE public.exam_sessions ADD COLUMN IF NOT EXISTS integrity_departure_count integer NOT NULL DEFAULT 0 CHECK (integrity_departure_count >= 0);
ALTER TABLE public.exam_sessions ADD COLUMN IF NOT EXISTS integrity_warning_at timestamptz;
ALTER TABLE public.exam_sessions ADD COLUMN IF NOT EXISTS integrity_locked_at timestamptz;
ALTER TABLE public.exam_sessions ADD COLUMN IF NOT EXISTS integrity_lock_reason text;
ALTER TABLE public.exam_sessions ADD COLUMN IF NOT EXISTS verification_pending boolean NOT NULL DEFAULT false;

CREATE TABLE public.kiwi_integrity_sessions (
  integrity_session_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('TEACHING_ASSIGNMENT','KIWI_EXAM','TEACHING_ASSESSMENT_ATTEMPT','VERIFICATION')),
  owner_ref text NOT NULL,
  profile text NOT NULL CHECK (profile IN ('LEARNING','OPEN_WORK','INDEPENDENT_WORK','CONTROLLED_TAKE_HOME','SCHEDULED_TEST','HIGH_STAKES_EXAM')),
  policy_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','WARNING','LOCKED','CLOSED','SYSTEM_PROTECTED')),
  confirmed_departure_count integer NOT NULL DEFAULT 0 CHECK (confirmed_departure_count >= 0),
  warning_issued_at timestamptz,
  locked_at timestamptz,
  lock_outcome text,
  current_device_ref text,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,owner_type,owner_ref,policy_version)
);
CREATE INDEX kiwi_integrity_sessions_owner_idx ON public.kiwi_integrity_sessions(user_id,owner_type,owner_ref,status);
CREATE INDEX kiwi_integrity_sessions_active_idx ON public.kiwi_integrity_sessions(user_id,status,updated_at DESC);

CREATE TABLE public.kiwi_integrity_session_events (
  integrity_event_id text PRIMARY KEY,
  integrity_session_id text NOT NULL REFERENCES public.kiwi_integrity_sessions(integrity_session_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_event_id text,
  raw_kind text NOT NULL,
  normalized_kind text NOT NULL,
  counts_as_departure boolean NOT NULL DEFAULT false,
  permitted boolean NOT NULL DEFAULT false,
  kiwi_caused boolean NOT NULL DEFAULT false,
  observed_at timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_metadata)='object'),
  policy_version text NOT NULL,
  UNIQUE(user_id,integrity_session_id,client_event_id)
);
CREATE INDEX kiwi_integrity_events_session_idx ON public.kiwi_integrity_session_events(user_id,integrity_session_id,accepted_at DESC);
CREATE INDEX kiwi_integrity_events_departure_idx ON public.kiwi_integrity_session_events(integrity_session_id,counts_as_departure,accepted_at DESC);

CREATE TABLE public.kiwi_verification_sessions (
  verification_session_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('TEACHING_ASSIGNMENT','KIWI_EXAM','TEACHING_ASSESSMENT_ATTEMPT')),
  owner_ref text NOT NULL,
  source_ref text,
  route text NOT NULL CHECK (route IN ('VERIFY_NOW','VERIFY_NEXT_CLASS','VERIFY_WITH_FRESH_EQUIVALENT_WORK','VERIFY_POST_ATTEMPT')),
  status text NOT NULL CHECK (status IN ('PENDING_ITEM','ACTIVE','PASSED','FAILED','REFUSED','REVIEW_NEEDED','EXPIRED','SYSTEM_DEFERRED')),
  target_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(target_capabilities)='array'),
  max_questions integer NOT NULL DEFAULT 3 CHECK (max_questions BETWEEN 1 AND 3),
  question_count integer NOT NULL DEFAULT 0 CHECK (question_count BETWEEN 0 AND 3),
  policy_version text NOT NULL,
  integrity_session_id text REFERENCES public.kiwi_integrity_sessions(integrity_session_id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kiwi_verification_sessions_owner_idx ON public.kiwi_verification_sessions(user_id,owner_type,owner_ref,status);
CREATE INDEX kiwi_verification_sessions_integrity_fk_idx ON public.kiwi_verification_sessions(integrity_session_id);

CREATE TABLE public.teaching_submission_verification_gates (
  submission_gate_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assignment_id text NOT NULL REFERENCES public.teaching_assignments(assignment_id) ON DELETE CASCADE,
  receipt_submission_id text NOT NULL REFERENCES public.teaching_assignment_submissions(assignment_submission_id) ON DELETE RESTRICT,
  correction_of_submission_id text REFERENCES public.teaching_assignment_submissions(assignment_submission_id) ON DELETE RESTRICT,
  policy_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('RECEIVED','CHECKING','VERIFICATION_REQUIRED','VERIFICATION_ACTIVE','FINALIZED','UNRESOLVED','SYSTEM_DEFERRED')),
  verification_route text NOT NULL CHECK (verification_route IN ('NO_VERIFICATION','VERIFY_NOW','VERIFY_NEXT_CLASS','VERIFY_WITH_FRESH_EQUIVALENT_WORK','VERIFY_POST_ATTEMPT','SYSTEM_DEFERRED')),
  accepted_event_at timestamptz NOT NULL,
  blocking_deadline_at timestamptz,
  final_submission_id text REFERENCES public.teaching_assignment_submissions(assignment_submission_id) ON DELETE RESTRICT,
  verification_session_id text REFERENCES public.kiwi_verification_sessions(verification_session_id) ON DELETE SET NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes)='array'),
  system_deferred_reason text,
  idempotency_key text NOT NULL,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,idempotency_key),
  UNIQUE(user_id,receipt_submission_id)
);
CREATE INDEX teaching_submission_gates_assignment_idx ON public.teaching_submission_verification_gates(user_id,assignment_id,created_at DESC);
CREATE INDEX teaching_submission_gates_assignment_fk_idx ON public.teaching_submission_verification_gates(assignment_id);
CREATE INDEX teaching_submission_gates_receipt_fk_idx ON public.teaching_submission_verification_gates(receipt_submission_id);
CREATE INDEX teaching_submission_gates_correction_fk_idx ON public.teaching_submission_verification_gates(correction_of_submission_id);
CREATE INDEX teaching_submission_gates_final_fk_idx ON public.teaching_submission_verification_gates(final_submission_id);
CREATE INDEX teaching_submission_gates_verification_fk_idx ON public.teaching_submission_verification_gates(verification_session_id);

CREATE TABLE public.kiwi_verification_items (
  verification_item_id text PRIMARY KEY,
  verification_session_id text NOT NULL REFERENCES public.kiwi_verification_sessions(verification_session_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL CHECK (sequence_no BETWEEN 1 AND 3),
  timing_class text NOT NULL CHECK (timing_class IN ('MICRO_RECOGNITION','SHORT_EXPLANATION','ONE_STEP_CALCULATION','TINY_CONSTRUCTED_RESPONSE','CODE_WALKTHROUGH')),
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 10 AND 300),
  prompt_payload jsonb NOT NULL CHECK (jsonb_typeof(prompt_payload)='object'),
  protected_validation_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(protected_validation_payload)='object'),
  target_capability text,
  started_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(verification_session_id,sequence_no)
);
CREATE INDEX kiwi_verification_items_session_idx ON public.kiwi_verification_items(user_id,verification_session_id,sequence_no);
CREATE INDEX kiwi_verification_items_verification_fk_idx ON public.kiwi_verification_items(verification_session_id);

CREATE TABLE public.kiwi_verification_responses (
  verification_response_id text PRIMARY KEY,
  verification_session_id text NOT NULL REFERENCES public.kiwi_verification_sessions(verification_session_id) ON DELETE CASCADE,
  verification_item_id text NOT NULL REFERENCES public.kiwi_verification_items(verification_item_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_payload)='object'),
  accepted_event_at timestamptz NOT NULL,
  expired_before_acceptance boolean NOT NULL DEFAULT false,
  evaluation_state text NOT NULL DEFAULT 'PENDING' CHECK (evaluation_state IN ('PENDING','PASS','FAIL','REVIEW_NEEDED','INVALID')),
  evidence_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence_payload)='object'),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,idempotency_key),
  UNIQUE(user_id,verification_item_id)
);
CREATE INDEX kiwi_verification_responses_session_idx ON public.kiwi_verification_responses(user_id,verification_session_id,created_at DESC);
CREATE INDEX kiwi_verification_responses_verification_fk_idx ON public.kiwi_verification_responses(verification_session_id);
CREATE INDEX kiwi_verification_responses_item_fk_idx ON public.kiwi_verification_responses(verification_item_id);

ALTER TABLE public.kiwi_integrity_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiwi_integrity_session_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_submission_verification_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiwi_verification_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiwi_verification_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiwi_verification_responses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.kiwi_integrity_sessions,public.kiwi_integrity_session_events,
  public.teaching_submission_verification_gates,public.kiwi_verification_sessions,
  public.kiwi_verification_items,public.kiwi_verification_responses
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.kiwi_integrity_sessions,public.teaching_submission_verification_gates,
  public.kiwi_verification_sessions TO service_role;
GRANT SELECT,INSERT ON public.kiwi_verification_items TO service_role;
GRANT UPDATE (started_at,expires_at) ON public.kiwi_verification_items TO service_role;
GRANT SELECT,INSERT ON public.kiwi_integrity_session_events,public.kiwi_verification_responses TO service_role;

COMMENT ON TABLE public.kiwi_integrity_sessions IS 'Global KIWI controlled-session state. Records observable rule/session facts; it is not a cheating or intent detector.';
COMMENT ON TABLE public.kiwi_integrity_session_events IS 'Append-only normalized session facts. One physical departure is deduplicated; telemetry is contextual/rule evidence, never automatic misconduct proof.';
COMMENT ON TABLE public.teaching_submission_verification_gates IS 'D16 submission receipt-to-finalization gate. accepted_event_at preserves deadline truth before analysis/verification completes.';
COMMENT ON TABLE public.kiwi_verification_sessions IS 'Cross-KIWI proportional capability verification session. Formal active assessments route verification post-attempt.';
COMMENT ON TABLE public.kiwi_verification_items IS 'Protected fresh verification items with server-authoritative timing classes. Direct browser table access is forbidden.';
COMMENT ON TABLE public.kiwi_verification_responses IS 'Append-only verification responses accepted against server time. Failure does not itself prove prior misconduct.';
