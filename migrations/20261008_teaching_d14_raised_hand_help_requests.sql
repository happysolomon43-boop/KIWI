-- D14-303: a raised hand is a durable, idempotent classroom intent, not
-- unstructured chat and never an authoritative academic response.
CREATE TABLE IF NOT EXISTS public.teaching_classroom_help_requests (
  help_request_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE RESTRICT,
  interaction_id text NOT NULL UNIQUE REFERENCES public.teaching_classroom_interactions(interaction_id) ON DELETE RESTRICT,
  controller_version bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('RAISED','PROCESSING','DEFERRED','ANSWERED','DECLINED','CANCELLED','UNAVAILABLE')),
  decision_reason text CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  response_communication_id text REFERENCES public.teaching_teacher_communications(communication_id) ON DELETE RESTRICT,
  next_review_at timestamptz,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teaching_help_answer_requires_comm CHECK (status <> 'ANSWERED' OR response_communication_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS teaching_help_student_class_idx
  ON public.teaching_classroom_help_requests(student_id,class_id,created_at DESC);
CREATE INDEX IF NOT EXISTS teaching_help_due_idx
  ON public.teaching_classroom_help_requests(next_review_at)
  WHERE status='DEFERRED';
CREATE INDEX IF NOT EXISTS teaching_help_class_session_fk_idx
  ON public.teaching_classroom_help_requests(class_session_id);
ALTER TABLE public.teaching_classroom_help_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teaching_classroom_help_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.teaching_classroom_help_requests TO service_role;
COMMENT ON TABLE public.teaching_classroom_help_requests IS
  'Durable raised-hand intent, controlled by D14. AI generation is advisory; D11 controller and D14 Teacher publication fences retain all academic authority. No model reasoning or protected assessment answers are stored.';
