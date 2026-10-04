-- KIWI Teaching D27 — owner-preserving external integration boundary.
-- Stores event/audit identity, existing-card references and unpromoted candidates only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.teaching_integration_events(
 event_id text PRIMARY KEY,
 student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 event_type text NOT NULL CHECK(event_type IN('learning_unit_verified','misconception_detected','assessment_completed','course_completed','remediation_required')),
 schema_version integer NOT NULL CHECK(schema_version=1),
 source_owner text NOT NULL, source_entity_type text NOT NULL, source_entity_id text NOT NULL, source_version text NOT NULL,
 occurred_at timestamptz NOT NULL, correlation_id text, causation_id text,
 idempotency_key text NOT NULL, policy_version text NOT NULL, privacy_class text NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(payload)='object'),
 status text NOT NULL CHECK(status IN('PENDING','DELIVERED','REJECTED','DEAD_LETTER')),
 replay_count integer NOT NULL DEFAULT 0 CHECK(replay_count>=0), last_replayed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(student_id,idempotency_key)
);
COMMENT ON TABLE public.teaching_integration_events IS 'D27 versioned high-level event outbox. Payloads are routing context, never a duplicate academic truth store.';
CREATE INDEX IF NOT EXISTS teaching_integration_events_pending_idx ON public.teaching_integration_events(status,created_at) WHERE status='PENDING';

CREATE TABLE IF NOT EXISTS public.teaching_integration_audit(
 audit_id text PRIMARY KEY,
 student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 integration_name text NOT NULL CHECK(integration_name IN('SUBJECT','EXAM','NOTIFICATIONS','KS','MASTERY','STUDY_FSRS','BRAIN','BIOME','ACHIEVEMENTS')),
 action text NOT NULL, source_ref jsonb NOT NULL DEFAULT '{}'::jsonb, target_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
 feature_flag boolean NOT NULL DEFAULT false, decision text NOT NULL, outcome text NOT NULL, error_code text,
 occurred_at timestamptz NOT NULL,
 CHECK(jsonb_typeof(source_ref)='object' AND jsonb_typeof(target_ref)='object')
);
COMMENT ON TABLE public.teaching_integration_audit IS 'D27 adapter decision/result audit. Target systems remain authoritative for their own committed state.';
CREATE INDEX IF NOT EXISTS teaching_integration_audit_student_time_idx ON public.teaching_integration_audit(student_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.teaching_study_card_references(
 reference_id text PRIMARY KEY,
 student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
 class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
 learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
 subject_id text NOT NULL, card_id text NOT NULL, card_version text NOT NULL,
 knowledge_type text NOT NULL CHECK(knowledge_type IN('DECLARATIVE','CONCEPTUAL','PROCEDURAL','ANALYTICAL','INTERPRETIVE','PRODUCTION')),
 relevance_reason text NOT NULL, source_version text NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(student_id,class_id,learning_unit_id,card_id)
);
COMMENT ON TABLE public.teaching_study_card_references IS 'D27 virtual Class Review Set references. No source card content, deck membership, FSRS state, history or deletion truth is copied.';
CREATE INDEX IF NOT EXISTS teaching_study_card_references_course_idx ON public.teaching_study_card_references(course_id,class_id,learning_unit_id);

CREATE TABLE IF NOT EXISTS public.teaching_study_card_candidates(
 candidate_id text PRIMARY KEY,
 student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
 class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
 learning_unit_id text NOT NULL REFERENCES public.teaching_learning_units(learning_unit_id) ON DELETE RESTRICT,
 subject_id text NOT NULL,
 knowledge_type text NOT NULL CHECK(knowledge_type IN('DECLARATIVE','CONCEPTUAL')),
 front_content text NOT NULL, back_content text NOT NULL, content_hash text NOT NULL,
 provenance_refs jsonb NOT NULL CHECK(jsonb_typeof(provenance_refs)='array'),
 source_version text NOT NULL, validation jsonb NOT NULL CHECK(jsonb_typeof(validation)='object'),
 status text NOT NULL CHECK(status IN('VALIDATED','DISMISSED','PROMOTED','SUPERSEDED')),
 promoted_card_id text, promoted_at timestamptz,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(student_id,learning_unit_id,content_hash),
 CHECK((status='PROMOTED')=(promoted_card_id IS NOT NULL AND promoted_at IS NOT NULL))
);
COMMENT ON TABLE public.teaching_study_card_candidates IS 'D27 validated unpromoted candidates. KIWI Study owns card identity after explicit promotion; candidates carry no FSRS state.';
CREATE INDEX IF NOT EXISTS teaching_study_card_candidates_course_idx ON public.teaching_study_card_candidates(course_id,class_id,learning_unit_id,status);

ALTER TABLE public.teaching_integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_integration_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_study_card_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_study_card_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teaching_integration_events,public.teaching_integration_audit,public.teaching_study_card_references,public.teaching_study_card_candidates FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.teaching_integration_events,public.teaching_integration_audit,public.teaching_study_card_references,public.teaching_study_card_candidates TO service_role;

COMMIT;
