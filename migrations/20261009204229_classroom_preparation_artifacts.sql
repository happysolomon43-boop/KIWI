-- Classroom remodeling Delivery 2. Additive typed extensions of existing PPL
-- versions; no new worker, Controller, scheduling or publication authority.
BEGIN;
CREATE UNIQUE INDEX teaching_classes_classroom_owner_key ON public.teaching_classes(class_id,student_id,course_id);
CREATE UNIQUE INDEX teaching_course_plans_classroom_owner_key ON public.teaching_course_plans(course_plan_id,student_id,course_id);
CREATE UNIQUE INDEX teaching_blueprints_classroom_owner_key ON public.teaching_lesson_blueprints(lesson_blueprint_id,student_id,class_id,course_plan_id);
CREATE UNIQUE INDEX teaching_ppl_versions_classroom_owner_key ON teaching_preparation.artifact_versions(artifact_version_id,student_id);

CREATE TABLE public.teaching_classroom_academic_artifacts (
 artifact_version_id text PRIMARY KEY,
 student_id text NOT NULL,
 class_id text NOT NULL,
 course_id text NOT NULL,
 course_plan_id text NOT NULL,
 artifact_kind text NOT NULL CHECK (artifact_kind IN ('chapter','plan','guide','opening')),
 logical_id text NOT NULL CHECK (length(btrim(logical_id))>0),
 logical_version text NOT NULL CHECK (length(btrim(logical_version))>0),
 revision_no integer NOT NULL CHECK (revision_no>0),
 operation_key text NOT NULL CHECK (length(btrim(operation_key))>0),
 request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
 parent_artifact_version_id text,
 task_mode text NOT NULL,
 prompt_sha256 text NOT NULL CHECK (prompt_sha256 ~ '^[a-f0-9]{64}$'),
 schema_version text NOT NULL,
 completeness text NOT NULL CHECK (completeness IN ('complete','partial','blocked')),
 validation_state text NOT NULL DEFAULT 'CANDIDATE' CHECK (validation_state IN ('CANDIDATE','VALIDATED','REJECTED')),
 validation_receipt jsonb,
 content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
 public_payload jsonb NOT NULL CHECK (jsonb_typeof(public_payload)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (artifact_version_id,student_id) REFERENCES teaching_preparation.artifact_versions(artifact_version_id,student_id) ON DELETE RESTRICT,
 FOREIGN KEY (class_id,student_id,course_id) REFERENCES public.teaching_classes(class_id,student_id,course_id) ON DELETE RESTRICT,
 FOREIGN KEY (course_plan_id,student_id,course_id) REFERENCES public.teaching_course_plans(course_plan_id,student_id,course_id) ON DELETE RESTRICT,
 UNIQUE (artifact_version_id,student_id,class_id,course_plan_id),
 UNIQUE (class_id,artifact_kind,logical_id,logical_version,revision_no),
 UNIQUE (class_id,artifact_kind,operation_key),
 FOREIGN KEY (parent_artifact_version_id,student_id,class_id,course_plan_id) REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id,student_id,class_id,course_plan_id) ON DELETE RESTRICT,
 CHECK (artifact_kind='chapter' OR public_payload='{}'::jsonb),
 CHECK (validation_state<>'VALIDATED' OR coalesce((completeness='complete' AND jsonb_typeof(validation_receipt)='object' AND validation_receipt->>'contentHash'=content_sha256 AND validation_receipt->>'independent'='true' AND validation_receipt->>'routeQualified'='true' AND length(btrim(validation_receipt->>'reviewId'))>0),false))
);
CREATE INDEX teaching_classroom_artifacts_plan_idx ON public.teaching_classroom_academic_artifacts(course_plan_id,student_id,course_id);
CREATE INDEX teaching_classroom_artifacts_parent_idx ON public.teaching_classroom_academic_artifacts(parent_artifact_version_id,student_id,class_id,course_plan_id);
CREATE INDEX teaching_classroom_artifacts_ppl_owner_idx ON public.teaching_classroom_academic_artifacts(artifact_version_id,student_id);
CREATE TABLE public.teaching_classroom_academic_private (
 artifact_version_id text PRIMARY KEY REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id) ON DELETE RESTRICT,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
 generation_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(generation_context)='object')
);
CREATE TABLE public.teaching_classroom_source_elements (
 artifact_version_id text NOT NULL REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id) ON DELETE RESTRICT,
 anchor text NOT NULL,
 parent_anchor text,
 parent_kind text GENERATED ALWAYS AS (CASE WHEN parent_anchor IS NULL THEN NULL ELSE 'chapter_unit' END) STORED,
 element_kind text NOT NULL CHECK (element_kind IN ('chapter_unit','source_element')),
 sequence_no integer NOT NULL CHECK (sequence_no>=0),
 content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
 public_payload jsonb NOT NULL CHECK (jsonb_typeof(public_payload)='object'),
 PRIMARY KEY (artifact_version_id,anchor),
 UNIQUE (artifact_version_id,anchor,element_kind),
 FOREIGN KEY (artifact_version_id,parent_anchor) REFERENCES public.teaching_classroom_source_elements(artifact_version_id,anchor) ON DELETE RESTRICT,
 FOREIGN KEY (artifact_version_id,parent_anchor,parent_kind) REFERENCES public.teaching_classroom_source_elements(artifact_version_id,anchor,element_kind) ON DELETE RESTRICT,
 CHECK ((element_kind='chapter_unit' AND parent_anchor IS NULL) OR (element_kind='source_element' AND parent_anchor IS NOT NULL))
);
CREATE INDEX teaching_classroom_elements_parent_idx ON public.teaching_classroom_source_elements(artifact_version_id,parent_anchor);
CREATE UNIQUE INDEX teaching_classroom_elements_order_key ON public.teaching_classroom_source_elements(artifact_version_id,coalesce(parent_anchor,''),sequence_no);
CREATE INDEX teaching_classroom_elements_parent_kind_idx ON public.teaching_classroom_source_elements(artifact_version_id,parent_anchor,parent_kind);
CREATE TABLE public.teaching_classroom_artifact_dependencies (
 artifact_version_id text NOT NULL REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id) ON DELETE RESTRICT,
 dependency_kind text NOT NULL CHECK (dependency_kind IN ('source','objective','scope','chapter','plan','guide','schedule','evidence','schema','route','asset')),
 aggregate_ref text NOT NULL CHECK (length(btrim(aggregate_ref))>0),
 version_ref text NOT NULL CHECK (length(btrim(version_ref))>0),
 dependency_artifact_version_id text REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id) ON DELETE RESTRICT,
 PRIMARY KEY (artifact_version_id,dependency_kind,aggregate_ref),
 CHECK (dependency_artifact_version_id IS NULL OR dependency_artifact_version_id<>artifact_version_id)
);
CREATE INDEX teaching_classroom_dependencies_aggregate_idx ON public.teaching_classroom_artifact_dependencies(dependency_kind,aggregate_ref,version_ref);
CREATE INDEX teaching_classroom_dependencies_artifact_idx ON public.teaching_classroom_artifact_dependencies(dependency_artifact_version_id);
CREATE TABLE public.teaching_classroom_preparation_bindings (
 class_id text PRIMARY KEY,
 student_id text NOT NULL,
 course_id text NOT NULL,
 course_plan_id text NOT NULL,
 lesson_blueprint_id text NOT NULL,
 chapter_artifact_id text NOT NULL,
 plan_artifact_id text NOT NULL,
 guide_artifact_id text NOT NULL,
 opening_artifact_id text NOT NULL,
 schedule_version bigint NOT NULL CHECK (schedule_version>=1),
 course_plan_version bigint NOT NULL CHECK (course_plan_version>=1),
 readiness_receipt jsonb NOT NULL CHECK (jsonb_typeof(readiness_receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (class_id,student_id,course_id) REFERENCES public.teaching_classes(class_id,student_id,course_id) ON DELETE RESTRICT,
 FOREIGN KEY (course_plan_id,student_id,course_id) REFERENCES public.teaching_course_plans(course_plan_id,student_id,course_id) ON DELETE RESTRICT,
 FOREIGN KEY (lesson_blueprint_id,student_id,class_id,course_plan_id) REFERENCES public.teaching_lesson_blueprints(lesson_blueprint_id,student_id,class_id,course_plan_id) ON DELETE RESTRICT,
 FOREIGN KEY (chapter_artifact_id,student_id,class_id,course_plan_id) REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id,student_id,class_id,course_plan_id) ON DELETE RESTRICT,
 FOREIGN KEY (plan_artifact_id,student_id,class_id,course_plan_id) REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id,student_id,class_id,course_plan_id) ON DELETE RESTRICT,
 FOREIGN KEY (guide_artifact_id,student_id,class_id,course_plan_id) REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id,student_id,class_id,course_plan_id) ON DELETE RESTRICT,
 FOREIGN KEY (opening_artifact_id,student_id,class_id,course_plan_id) REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id,student_id,class_id,course_plan_id) ON DELETE RESTRICT
);
CREATE INDEX teaching_classroom_bindings_plan_idx ON public.teaching_classroom_preparation_bindings(course_plan_id,student_id,course_id);
CREATE INDEX teaching_classroom_bindings_blueprint_idx ON public.teaching_classroom_preparation_bindings(lesson_blueprint_id,student_id,class_id,course_plan_id);
CREATE INDEX teaching_classroom_bindings_chapter_idx ON public.teaching_classroom_preparation_bindings(chapter_artifact_id,student_id,class_id,course_plan_id);
CREATE INDEX teaching_classroom_bindings_plan_artifact_idx ON public.teaching_classroom_preparation_bindings(plan_artifact_id,student_id,class_id,course_plan_id);
CREATE INDEX teaching_classroom_bindings_guide_idx ON public.teaching_classroom_preparation_bindings(guide_artifact_id,student_id,class_id,course_plan_id);
CREATE INDEX teaching_classroom_bindings_opening_idx ON public.teaching_classroom_preparation_bindings(opening_artifact_id,student_id,class_id,course_plan_id);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['teaching_classroom_academic_artifacts','teaching_classroom_academic_private','teaching_classroom_source_elements','teaching_classroom_artifact_dependencies','teaching_classroom_preparation_bindings'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',name);
  EXECUTE format('CREATE POLICY classroom_service_only ON public.%I TO service_role USING (true) WITH CHECK (true)',name);
 END LOOP;
END $$;
CREATE FUNCTION public.teaching_classroom_immutable_content() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='teaching_classroom_academic_artifacts' THEN
  IF OLD.validation_state='VALIDATED' AND NEW.validation_receipt IS DISTINCT FROM OLD.validation_receipt THEN RAISE EXCEPTION 'CLASSROOM_ACCEPTED_REVIEW_IMMUTABLE'; END IF;
  IF (to_jsonb(NEW)-'validation_state'-'validation_receipt') IS DISTINCT FROM (to_jsonb(OLD)-'validation_state'-'validation_receipt') THEN RAISE EXCEPTION 'CLASSROOM_ARTIFACT_CONTENT_IMMUTABLE'; END IF;
 ELSE
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'CLASSROOM_ARTIFACT_CONTENT_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.teaching_classroom_immutable_content() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teaching_classroom_immutable_content() TO service_role;
CREATE TRIGGER classroom_artifact_immutable BEFORE UPDATE ON public.teaching_classroom_academic_artifacts FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_immutable_content();
CREATE TRIGGER classroom_private_immutable BEFORE UPDATE ON public.teaching_classroom_academic_private FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_immutable_content();
CREATE TRIGGER classroom_element_immutable BEFORE UPDATE ON public.teaching_classroom_source_elements FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_immutable_content();
CREATE TRIGGER classroom_dependency_immutable BEFORE UPDATE ON public.teaching_classroom_artifact_dependencies FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_immutable_content();
COMMIT;
