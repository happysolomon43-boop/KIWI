-- KIWI Teaching D12 — Response Evaluation, Hinting & Pedagogy
-- Exact delivery scope: TCH-0192–TCH-0215.
-- D11 remains live-Class owner. D13 remains durable SKM/misconception-state owner.

BEGIN;

ALTER TABLE public.teaching_student_responses
  ADD COLUMN IF NOT EXISTS learning_unit_id text REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS controller_version bigint CHECK (controller_version IS NULL OR controller_version >= 0),
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS teaching_student_responses_idempotency_uidx
  ON public.teaching_student_responses(student_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_student_responses_learning_unit_idx
  ON public.teaching_student_responses(learning_unit_id,server_received_at DESC)
  WHERE learning_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_student_responses_session_idx
  ON public.teaching_student_responses(class_session_id,server_received_at DESC);

CREATE TABLE public.teaching_response_evaluations (
  evaluation_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  response_id text NOT NULL REFERENCES public.teaching_student_responses(response_id) ON DELETE RESTRICT,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE RESTRICT,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE RESTRICT,
  learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  controller_version bigint NOT NULL CHECK (controller_version >= 0),
  evaluation_version integer NOT NULL CHECK (evaluation_version >= 1),
  evaluation_state text NOT NULL CHECK (evaluation_state IN ('VALIDATED','ROUTE_HELD','REVIEW_NEEDED','REJECTED')),
  capability_id text NOT NULL CHECK (length(btrim(capability_id)) > 0),
  prompt_family_id text NOT NULL CHECK (length(btrim(prompt_family_id)) > 0),
  prompt_family_version text NOT NULL CHECK (length(btrim(prompt_family_version)) > 0),
  contract_version text NOT NULL CHECK (length(btrim(contract_version)) > 0),
  evaluation_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evaluation_payload)='object'),
  evaluator_confidence text CHECK (evaluator_confidence IS NULL OR evaluator_confidence IN ('high','medium','low')),
  evidence_strength text NOT NULL DEFAULT 'UNKNOWN' CHECK (evidence_strength IN ('UNKNOWN','FULL','LIMITED','ASSISTED','CONTAMINATED')),
  assistance_state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(assistance_state)='object'),
  exposure_state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(exposure_state)='object'),
  candidate_misconception jsonb CHECK (candidate_misconception IS NULL OR jsonb_typeof(candidate_misconception)='object'),
  prerequisite_hypothesis jsonb CHECK (prerequisite_hypothesis IS NULL OR jsonb_typeof(prerequisite_hypothesis)='object'),
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  execution_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,response_id,evaluation_version),
  UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_response_evaluations_response_idx ON public.teaching_response_evaluations(response_id,evaluation_version DESC);
CREATE INDEX teaching_response_evaluations_class_idx ON public.teaching_response_evaluations(class_id,created_at DESC);
CREATE INDEX teaching_response_evaluations_session_idx ON public.teaching_response_evaluations(class_session_id,created_at DESC);
CREATE INDEX teaching_response_evaluations_learning_unit_idx ON public.teaching_response_evaluations(learning_unit_id,created_at DESC);
CREATE TRIGGER teaching_response_evaluations_immutable BEFORE UPDATE OR DELETE ON public.teaching_response_evaluations
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

CREATE TABLE public.teaching_pedagogy_decisions (
  pedagogy_decision_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  response_evaluation_id text REFERENCES public.teaching_response_evaluations(evaluation_id) ON DELETE RESTRICT,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE RESTRICT,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE RESTRICT,
  learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  controller_version bigint NOT NULL CHECK (controller_version >= 0),
  capability_id text NOT NULL CHECK (length(btrim(capability_id)) > 0),
  prompt_family_id text NOT NULL CHECK (length(btrim(prompt_family_id)) > 0),
  prompt_family_version text NOT NULL CHECK (length(btrim(prompt_family_version)) > 0),
  task_mode text NOT NULL CHECK (length(btrim(task_mode)) > 0),
  decision_state text NOT NULL CHECK (decision_state IN ('VALIDATED','DETERMINISTIC_BOUND','ROUTE_HELD','REVIEW_NEEDED','REPLAN_NEEDED','REJECTED')),
  assistance_ceiling text NOT NULL CHECK (assistance_ceiling IN ('none','attention','directional','conceptual','partial_step','strong_scaffold','worked_example','full_instruction')),
  assistance_level text NOT NULL CHECK (assistance_level IN ('none','attention','directional','conceptual','partial_step','strong_scaffold','worked_example','full_instruction')),
  decision_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(decision_payload)='object'),
  strategy_class text,
  blocked_proposal boolean NOT NULL DEFAULT false,
  replan_recommended boolean NOT NULL DEFAULT false,
  durable_state_committed boolean NOT NULL DEFAULT false CHECK (durable_state_committed=false),
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  execution_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_pedagogy_decisions_evaluation_idx ON public.teaching_pedagogy_decisions(response_evaluation_id,created_at DESC);
CREATE INDEX teaching_pedagogy_decisions_class_idx ON public.teaching_pedagogy_decisions(class_id,created_at DESC);
CREATE INDEX teaching_pedagogy_decisions_session_idx ON public.teaching_pedagogy_decisions(class_session_id,created_at DESC);
CREATE INDEX teaching_pedagogy_decisions_learning_unit_idx ON public.teaching_pedagogy_decisions(learning_unit_id,created_at DESC);
CREATE TRIGGER teaching_pedagogy_decisions_immutable BEFORE UPDATE OR DELETE ON public.teaching_pedagogy_decisions
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

CREATE TABLE public.teaching_learning_unit_pedagogy_profiles (
  pedagogy_profile_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
  course_plan_id text NOT NULL REFERENCES public.teaching_course_plans(course_plan_id) ON DELETE RESTRICT,
  profile_version integer NOT NULL CHECK (profile_version >= 1),
  profile_state text NOT NULL CHECK (profile_state IN ('VALIDATED','REVIEW_NEEDED')),
  knowledge_type text NOT NULL CHECK (knowledge_type IN ('factual','conceptual','procedural','analytical','interpretive','applied','communicative','experimental_practical','mixed')),
  primary_student_actions jsonb NOT NULL CHECK (jsonb_typeof(primary_student_actions)='array'),
  answer_space text NOT NULL CHECK (answer_space IN ('single_objective','multiple_valid_approaches','open_interpretation','bounded_constructed','mixed')),
  representations jsonb NOT NULL CHECK (jsonb_typeof(representations)='array'),
  profile_payload jsonb NOT NULL CHECK (jsonb_typeof(profile_payload)='object'),
  subject_template_authoritative boolean NOT NULL DEFAULT false CHECK (subject_template_authoritative=false),
  capability_id text NOT NULL,
  prompt_family_id text NOT NULL,
  prompt_family_version text NOT NULL,
  contract_version text NOT NULL,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  execution_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,learning_unit_id,profile_version),
  UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_learning_unit_pedagogy_profiles_lu_idx ON public.teaching_learning_unit_pedagogy_profiles(learning_unit_id,profile_version DESC);
CREATE INDEX teaching_learning_unit_pedagogy_profiles_plan_idx ON public.teaching_learning_unit_pedagogy_profiles(course_plan_id,created_at DESC);
CREATE TRIGGER teaching_learning_unit_pedagogy_profiles_immutable BEFORE UPDATE OR DELETE ON public.teaching_learning_unit_pedagogy_profiles
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

CREATE TABLE public.teaching_teacher_corrections (
  teacher_correction_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE RESTRICT,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE RESTRICT,
  source_response_evaluation_id text REFERENCES public.teaching_response_evaluations(evaluation_id) ON DELETE RESTRICT,
  controller_version bigint NOT NULL CHECK (controller_version >= 0),
  correction_state text NOT NULL CHECK (correction_state IN ('TEACHER_CORRECT','TEACHER_ERROR_CONFIRMED','UNRESOLVED','ROUTE_HELD','REVIEW_NEEDED')),
  correction_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(correction_payload)='object'),
  evidence_recheck_required boolean NOT NULL DEFAULT false,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  execution_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_teacher_corrections_class_idx ON public.teaching_teacher_corrections(class_id,created_at DESC);
CREATE INDEX teaching_teacher_corrections_session_idx ON public.teaching_teacher_corrections(class_session_id,created_at DESC);
CREATE INDEX teaching_teacher_corrections_evaluation_idx ON public.teaching_teacher_corrections(source_response_evaluation_id,created_at DESC);
CREATE TRIGGER teaching_teacher_corrections_immutable BEFORE UPDATE OR DELETE ON public.teaching_teacher_corrections
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

CREATE TABLE public.teaching_evidence_recheck_handoffs (
  evidence_recheck_handoff_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  teacher_correction_id text NOT NULL REFERENCES public.teaching_teacher_corrections(teacher_correction_id) ON DELETE RESTRICT,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE RESTRICT,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE RESTRICT,
  source_response_evaluation_id text REFERENCES public.teaching_response_evaluations(evaluation_id) ON DELETE RESTRICT,
  target_owner text NOT NULL CHECK (length(btrim(target_owner)) > 0),
  handoff_state text NOT NULL DEFAULT 'PENDING_OWNER' CHECK (handoff_state='PENDING_OWNER'),
  handoff_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(handoff_payload)='object'),
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_evidence_recheck_handoffs_correction_idx ON public.teaching_evidence_recheck_handoffs(teacher_correction_id);
CREATE INDEX teaching_evidence_recheck_handoffs_class_idx ON public.teaching_evidence_recheck_handoffs(class_id,created_at DESC);
CREATE INDEX teaching_evidence_recheck_handoffs_session_idx ON public.teaching_evidence_recheck_handoffs(class_session_id,created_at DESC);
CREATE INDEX teaching_evidence_recheck_handoffs_evaluation_idx ON public.teaching_evidence_recheck_handoffs(source_response_evaluation_id,created_at DESC);
CREATE TRIGGER teaching_evidence_recheck_handoffs_immutable BEFORE UPDATE OR DELETE ON public.teaching_evidence_recheck_handoffs
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

ALTER TABLE public.teaching_response_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_pedagogy_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_learning_unit_pedagogy_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_teacher_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_evidence_recheck_handoffs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.teaching_response_evaluations FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.teaching_pedagogy_decisions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.teaching_learning_unit_pedagogy_profiles FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.teaching_teacher_corrections FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.teaching_evidence_recheck_handoffs FROM PUBLIC,anon,authenticated;

GRANT SELECT,INSERT ON public.teaching_response_evaluations TO service_role,teaching_domain_service;
GRANT SELECT,INSERT ON public.teaching_pedagogy_decisions TO service_role,teaching_domain_service;
GRANT SELECT,INSERT ON public.teaching_learning_unit_pedagogy_profiles TO service_role,teaching_domain_service;
GRANT SELECT,INSERT ON public.teaching_teacher_corrections TO service_role,teaching_domain_service;
GRANT SELECT,INSERT ON public.teaching_evidence_recheck_handoffs TO service_role,teaching_domain_service;

CREATE POLICY teaching_response_evaluations_domain_service_select ON public.teaching_response_evaluations FOR SELECT TO teaching_domain_service USING (true);
CREATE POLICY teaching_response_evaluations_domain_service_insert ON public.teaching_response_evaluations FOR INSERT TO teaching_domain_service WITH CHECK (true);
CREATE POLICY teaching_pedagogy_decisions_domain_service_select ON public.teaching_pedagogy_decisions FOR SELECT TO teaching_domain_service USING (true);
CREATE POLICY teaching_pedagogy_decisions_domain_service_insert ON public.teaching_pedagogy_decisions FOR INSERT TO teaching_domain_service WITH CHECK (true);
CREATE POLICY teaching_learning_unit_pedagogy_profiles_domain_service_select ON public.teaching_learning_unit_pedagogy_profiles FOR SELECT TO teaching_domain_service USING (true);
CREATE POLICY teaching_learning_unit_pedagogy_profiles_domain_service_insert ON public.teaching_learning_unit_pedagogy_profiles FOR INSERT TO teaching_domain_service WITH CHECK (true);
CREATE POLICY teaching_teacher_corrections_domain_service_select ON public.teaching_teacher_corrections FOR SELECT TO teaching_domain_service USING (true);
CREATE POLICY teaching_teacher_corrections_domain_service_insert ON public.teaching_teacher_corrections FOR INSERT TO teaching_domain_service WITH CHECK (true);
CREATE POLICY teaching_evidence_recheck_handoffs_domain_service_select ON public.teaching_evidence_recheck_handoffs FOR SELECT TO teaching_domain_service USING (true);
CREATE POLICY teaching_evidence_recheck_handoffs_domain_service_insert ON public.teaching_evidence_recheck_handoffs FOR INSERT TO teaching_domain_service WITH CHECK (true);

COMMIT;
