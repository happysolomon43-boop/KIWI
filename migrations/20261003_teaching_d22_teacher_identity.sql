-- KIWI Teaching D22 — Teacher Identity & Interaction Style
-- Scope: TCH-0462..TCH-0478 only.
-- Teacher Identity owns persistent presentation identity. D10 Request remains the
-- authoritative teacher-change decision/application owner. Academic truth owners
-- (D08/D09/D13/D15/D17/D20/D21) are not changed by this migration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.teaching_teacher_identity_versions (
  teacher_identity_version_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  teacher_identity_id text NOT NULL REFERENCES public.teaching_teacher_identities(teacher_identity_id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no >= 1),
  style_envelope_schema_version text NOT NULL CHECK (style_envelope_schema_version = 'tpf08.teacher-style-envelope.v1'),
  warmth text NOT NULL CHECK (warmth IN ('low','moderate','high')),
  directness text NOT NULL CHECK (directness IN ('low','moderate','high')),
  formality text NOT NULL CHECK (formality IN ('low','moderate','high')),
  expressiveness text NOT NULL CHECK (expressiveness IN ('low','moderate','high')),
  humor_frequency text NOT NULL CHECK (humor_frequency IN ('none','low','moderate')),
  encouragement_intensity text NOT NULL CHECK (encouragement_intensity IN ('low','moderate','high')),
  challenge_style text NOT NULL CHECK (challenge_style IN ('gentle','balanced','direct')),
  accountability_style text NOT NULL CHECK (accountability_style IN ('soft','balanced','firm')),
  conversationality text NOT NULL CHECK (conversationality IN ('low','moderate','high')),
  presentation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(presentation_metadata)='object'),
  generation_mode text NOT NULL CHECK (generation_mode IN ('D22_DETERMINISTIC_POLICY','TPF18_VALIDATED_CANDIDATE','LEGACY_BACKFILL','APPROVED_POOL','CONTINUITY_REUSE')),
  broad_style_preference text CHECK (broad_style_preference IS NULL OR broad_style_preference IN ('surprise_me','more_direct','more_relaxed','more_formal','more_energetic')),
  influence_trace jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(influence_trace)='array'),
  prompt_family_id text CHECK (prompt_family_id IS NULL OR prompt_family_id='TPF-18'),
  prompt_family_version text CHECK (prompt_family_version IS NULL OR prompt_family_version='1.0'),
  prompt_sha256 text CHECK (prompt_sha256 IS NULL OR prompt_sha256='1ea28ec7d84ded6092949bd0656f83450178386d5990077f02d033208feec7d5'),
  supersedes_teacher_identity_version_id text REFERENCES public.teaching_teacher_identity_versions(teacher_identity_version_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(teacher_identity_id,version_no),
  CHECK (
    (prompt_family_id IS NULL AND prompt_family_version IS NULL AND prompt_sha256 IS NULL)
    OR (prompt_family_id='TPF-18' AND prompt_family_version='1.0' AND prompt_sha256='1ea28ec7d84ded6092949bd0656f83450178386d5990077f02d033208feec7d5')
  )
);

CREATE INDEX IF NOT EXISTS teaching_teacher_identity_versions_student_idx
  ON public.teaching_teacher_identity_versions(student_id,teacher_identity_id,version_no DESC);
CREATE INDEX IF NOT EXISTS teaching_teacher_identity_versions_supersedes_idx
  ON public.teaching_teacher_identity_versions(supersedes_teacher_identity_version_id)
  WHERE supersedes_teacher_identity_version_id IS NOT NULL;

-- Familiarity is authoritative relationship state tied to an assignment, not a
-- personality trait inferred from Course age, message count, or apparent rapport.
CREATE TABLE IF NOT EXISTS public.teaching_teacher_familiarity_states (
  familiarity_state_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  teacher_assignment_id text NOT NULL REFERENCES public.teaching_course_teacher_assignments(teacher_assignment_id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no >= 1),
  familiarity_level text NOT NULL CHECK (familiarity_level IN ('new','established','familiar')),
  source_kind text NOT NULL CHECK (source_kind IN ('INITIAL_ASSIGNMENT','CONTINUITY_CARRY_FORWARD','AUTHORIZED_RELATIONSHIP_UPDATE','LEGACY_BACKFILL')),
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(teacher_assignment_id,version_no)
);
CREATE INDEX IF NOT EXISTS teaching_teacher_familiarity_states_current_idx
  ON public.teaching_teacher_familiarity_states(student_id,teacher_assignment_id,version_no DESC);

CREATE INDEX IF NOT EXISTS teaching_interaction_preferences_current_d22_idx
  ON public.teaching_interaction_preferences(student_id,course_id,effective_at DESC,created_at DESC)
  WHERE superseded_at IS NULL;

-- Existing D10 deterministic shells become valid D22 structured profiles without
-- inventing biography or subject-derived personality.
INSERT INTO public.teaching_teacher_identity_versions(
  teacher_identity_version_id,student_id,teacher_identity_id,version_no,style_envelope_schema_version,
  warmth,directness,formality,expressiveness,humor_frequency,encouragement_intensity,
  challenge_style,accountability_style,conversationality,presentation_metadata,generation_mode,
  broad_style_preference,influence_trace
)
SELECT
  t.teacher_identity_id || ':d22:v1',t.student_id,t.teacher_identity_id,1,'tpf08.teacher-style-envelope.v1',
  'moderate','moderate','moderate','moderate','low','moderate','balanced','balanced','moderate',
  jsonb_build_object('display_name',t.display_name,'ai_disclosure',true),
  'LEGACY_BACKFILL',NULL,'["KIWI_DEFAULTS","PERSISTED_IDENTITY_STATE","PRODUCT_PRESENTATION_POLICY"]'::jsonb
FROM public.teaching_teacher_identities t
WHERE NOT EXISTS (
  SELECT 1 FROM public.teaching_teacher_identity_versions v WHERE v.teacher_identity_id=t.teacher_identity_id
);

INSERT INTO public.teaching_teacher_familiarity_states(
  familiarity_state_id,student_id,teacher_assignment_id,version_no,familiarity_level,source_kind,source_ref
)
SELECT
  a.teacher_assignment_id || ':d22:f1',a.student_id,a.teacher_assignment_id,1,'new','LEGACY_BACKFILL',a.source_request_id
FROM public.teaching_course_teacher_assignments a
WHERE a.effective_to IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.teaching_teacher_familiarity_states f WHERE f.teacher_assignment_id=a.teacher_assignment_id
  );

UPDATE public.teaching_teacher_identities
SET style_envelope_version='tpf08.teacher-style-envelope.v1',updated_at=now()
WHERE style_envelope_version IS DISTINCT FROM 'tpf08.teacher-style-envelope.v1';

-- Version/familiarity rows are append-only. A later version supersedes by lineage;
-- historical identity/familiarity evidence is never rewritten.
DROP TRIGGER IF EXISTS teaching_teacher_identity_versions_immutable ON public.teaching_teacher_identity_versions;
CREATE TRIGGER teaching_teacher_identity_versions_immutable
BEFORE UPDATE OR DELETE ON public.teaching_teacher_identity_versions
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

DROP TRIGGER IF EXISTS teaching_teacher_familiarity_states_immutable ON public.teaching_teacher_familiarity_states;
CREATE TRIGGER teaching_teacher_familiarity_states_immutable
BEFORE UPDATE OR DELETE ON public.teaching_teacher_familiarity_states
FOR EACH ROW EXECUTE FUNCTION public.teaching_reject_immutable_row_mutation();

ALTER TABLE public.teaching_teacher_identity_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_teacher_familiarity_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.teaching_teacher_identity_versions FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service;
REVOKE ALL ON TABLE public.teaching_teacher_familiarity_states FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service;

GRANT SELECT ON TABLE public.teaching_teacher_identity_versions TO authenticated,service_role,teaching_domain_service;
GRANT SELECT ON TABLE public.teaching_teacher_familiarity_states TO authenticated,service_role,teaching_domain_service;
GRANT INSERT ON TABLE public.teaching_teacher_identity_versions TO service_role,teaching_domain_service;
GRANT INSERT ON TABLE public.teaching_teacher_familiarity_states TO service_role,teaching_domain_service;

DROP POLICY IF EXISTS teaching_teacher_identity_versions_student_select ON public.teaching_teacher_identity_versions;
CREATE POLICY teaching_teacher_identity_versions_student_select
ON public.teaching_teacher_identity_versions FOR SELECT TO authenticated
USING ((select auth.uid())::text=student_id);

DROP POLICY IF EXISTS teaching_teacher_identity_versions_domain_select ON public.teaching_teacher_identity_versions;
CREATE POLICY teaching_teacher_identity_versions_domain_select
ON public.teaching_teacher_identity_versions FOR SELECT TO teaching_domain_service USING (true);
DROP POLICY IF EXISTS teaching_teacher_identity_versions_domain_insert ON public.teaching_teacher_identity_versions;
CREATE POLICY teaching_teacher_identity_versions_domain_insert
ON public.teaching_teacher_identity_versions FOR INSERT TO teaching_domain_service WITH CHECK (true);

DROP POLICY IF EXISTS teaching_teacher_familiarity_states_student_select ON public.teaching_teacher_familiarity_states;
CREATE POLICY teaching_teacher_familiarity_states_student_select
ON public.teaching_teacher_familiarity_states FOR SELECT TO authenticated
USING ((select auth.uid())::text=student_id);
DROP POLICY IF EXISTS teaching_teacher_familiarity_states_domain_select ON public.teaching_teacher_familiarity_states;
CREATE POLICY teaching_teacher_familiarity_states_domain_select
ON public.teaching_teacher_familiarity_states FOR SELECT TO teaching_domain_service USING (true);
DROP POLICY IF EXISTS teaching_teacher_familiarity_states_domain_insert ON public.teaching_teacher_familiarity_states;
CREATE POLICY teaching_teacher_familiarity_states_domain_insert
ON public.teaching_teacher_familiarity_states FOR INSERT TO teaching_domain_service WITH CHECK (true);

COMMIT;
