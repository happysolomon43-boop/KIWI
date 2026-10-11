-- Additive service-only D31 release coordination. No initial admission authority.
CREATE TABLE public.teaching_classroom_release_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL DEFAULT 'STOPPED' CHECK(state IN ('STOPPED','COHORT','GENERAL','ROLLBACK')),
 manifest_hash text CHECK(manifest_hash IS NULL OR manifest_hash ~ '^[a-f0-9]{64}$'),
 manifest jsonb,
 cohort_student_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(cohort_student_ids)='array'),
 supported_manifest_hashes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(supported_manifest_hashes)='array'),
 reason_ref text NOT NULL DEFAULT 'DELIVERIES_1_TO_7_ACCEPTANCE_PENDING',
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(state NOT IN ('COHORT','GENERAL') OR (manifest_hash IS NOT NULL AND jsonb_typeof(manifest)='object'))
);
INSERT INTO public.teaching_classroom_release_control(singleton) VALUES(true);
CREATE TABLE public.teaching_classroom_release_operations (
 operation_key text PRIMARY KEY,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 decision jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.teaching_class_sessions ADD COLUMN classroom_release_manifest_hash text
 CHECK(classroom_release_manifest_hash IS NULL OR classroom_release_manifest_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE public.teaching_classroom_release_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_classroom_release_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teaching_classroom_release_control,public.teaching_classroom_release_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.teaching_classroom_release_control,public.teaching_classroom_release_operations TO service_role;
CREATE POLICY classroom_release_service ON public.teaching_classroom_release_control TO service_role USING(true) WITH CHECK(true);
CREATE POLICY classroom_release_service ON public.teaching_classroom_release_operations TO service_role USING(true) WITH CHECK(true);
