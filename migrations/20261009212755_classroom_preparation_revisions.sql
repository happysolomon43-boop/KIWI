-- Additive revision/inheritance provenance. No active session or legacy route
-- is migrated, and all new state remains service-owned.
BEGIN;
ALTER TABLE public.teaching_classroom_academic_artifacts
 DROP CONSTRAINT teaching_classroom_academic_artifacts_artifact_kind_check,
 ADD CONSTRAINT teaching_classroom_academic_artifacts_artifact_kind_check CHECK (artifact_kind IN ('chapter','plan','guide','opening','context','generation')),
 ADD COLUMN origin_artifact_version_id text,
 ADD CONSTRAINT classroom_artifact_course_owner_key UNIQUE (artifact_version_id,student_id,course_id),
 ADD CONSTRAINT classroom_artifact_origin_fk FOREIGN KEY (origin_artifact_version_id,student_id,course_id)
 REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id,student_id,course_id) ON DELETE RESTRICT;
CREATE INDEX classroom_artifact_origin_idx ON public.teaching_classroom_academic_artifacts(origin_artifact_version_id,student_id,course_id);
ALTER TABLE public.teaching_classroom_preparation_bindings
 ADD COLUMN binding_version bigint NOT NULL DEFAULT 1 CHECK (binding_version>=1);
CREATE TABLE public.teaching_classroom_preparation_binding_history (
 class_id text NOT NULL,
 student_id text NOT NULL,
 course_id text NOT NULL,
 binding_version bigint NOT NULL,
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (class_id,binding_version),
 FOREIGN KEY (class_id,student_id,course_id) REFERENCES public.teaching_classes(class_id,student_id,course_id) ON DELETE RESTRICT
);
CREATE INDEX classroom_binding_history_owner_idx ON public.teaching_classroom_preparation_binding_history(student_id,class_id,binding_version);
CREATE TABLE public.teaching_classroom_anchor_remaps (
 artifact_version_id text NOT NULL REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id) ON DELETE RESTRICT,
 prior_artifact_version_id text NOT NULL,
 prior_anchor text NOT NULL,
 target_anchors jsonb NOT NULL CHECK (jsonb_typeof(target_anchors)='array'),
 reason text NOT NULL CHECK (length(btrim(reason))>0),
 PRIMARY KEY (artifact_version_id,prior_artifact_version_id,prior_anchor),
 FOREIGN KEY (prior_artifact_version_id,prior_anchor) REFERENCES public.teaching_classroom_source_elements(artifact_version_id,anchor) ON DELETE RESTRICT,
 CHECK (artifact_version_id<>prior_artifact_version_id)
);
CREATE INDEX classroom_anchor_remaps_prior_idx ON public.teaching_classroom_anchor_remaps(prior_artifact_version_id,prior_anchor);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['teaching_classroom_preparation_binding_history','teaching_classroom_anchor_remaps'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO service_role',name);
  EXECUTE format('CREATE POLICY classroom_service_only ON public.%I TO service_role USING (true) WITH CHECK (true)',name);
 END LOOP;
END $$;
CREATE FUNCTION public.teaching_classroom_binding_journal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.binding_version<>OLD.binding_version+1 OR NEW.student_id<>OLD.student_id OR NEW.course_id<>OLD.course_id OR NEW.class_id<>OLD.class_id THEN RAISE EXCEPTION 'CLASSROOM_BINDING_REVISION_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM public.teaching_class_sessions WHERE class_id=OLD.class_id AND student_id=OLD.student_id) THEN RAISE EXCEPTION 'CLASSROOM_SESSION_BINDING_PINNED'; END IF;
 END IF;
 INSERT INTO public.teaching_classroom_preparation_binding_history(class_id,student_id,course_id,binding_version,snapshot)
 VALUES(NEW.class_id,NEW.student_id,NEW.course_id,NEW.binding_version,to_jsonb(NEW));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.teaching_classroom_binding_journal() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teaching_classroom_binding_journal() TO service_role;
CREATE TRIGGER classroom_binding_journal AFTER INSERT OR UPDATE ON public.teaching_classroom_preparation_bindings FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_binding_journal();
CREATE TRIGGER classroom_history_immutable BEFORE UPDATE ON public.teaching_classroom_preparation_binding_history FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_immutable_content();
CREATE TRIGGER classroom_remaps_immutable BEFORE UPDATE ON public.teaching_classroom_anchor_remaps FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_immutable_content();
-- Existing accepted bindings, if any, receive a historical reader entry.
INSERT INTO public.teaching_classroom_preparation_binding_history(class_id,student_id,course_id,binding_version,snapshot)
 SELECT class_id,student_id,course_id,binding_version,to_jsonb(b) FROM public.teaching_classroom_preparation_bindings b ON CONFLICT DO NOTHING;
ALTER TABLE public.teaching_class_sessions
 ADD COLUMN classroom_engine text NOT NULL DEFAULT 'LEGACY' CHECK (classroom_engine IN ('LEGACY','CLASSROOM_V1')),
 ADD COLUMN classroom_chapter_artifact_id text,
 ADD COLUMN classroom_binding_version bigint,
 ADD CONSTRAINT classroom_session_chapter_owner_fk FOREIGN KEY (classroom_chapter_artifact_id,student_id,class_id,course_plan_id) REFERENCES public.teaching_classroom_academic_artifacts(artifact_version_id,student_id,class_id,course_plan_id) ON DELETE RESTRICT,
 ADD CONSTRAINT classroom_session_binding_fk FOREIGN KEY (class_id,classroom_binding_version) REFERENCES public.teaching_classroom_preparation_binding_history(class_id,binding_version) ON DELETE RESTRICT,
 ADD CONSTRAINT classroom_session_pin_required CHECK (classroom_engine<>'CLASSROOM_V1' OR (classroom_chapter_artifact_id IS NOT NULL AND classroom_binding_version IS NOT NULL));
CREATE INDEX classroom_session_chapter_idx ON public.teaching_class_sessions(classroom_chapter_artifact_id,student_id,class_id,course_plan_id);
CREATE INDEX classroom_session_binding_idx ON public.teaching_class_sessions(class_id,classroom_binding_version);
CREATE FUNCTION public.teaching_classroom_session_pin() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.classroom_engine,NEW.classroom_chapter_artifact_id,NEW.classroom_binding_version) IS DISTINCT FROM (OLD.classroom_engine,OLD.classroom_chapter_artifact_id,OLD.classroom_binding_version) THEN RAISE EXCEPTION 'CLASSROOM_SESSION_PIN_IMMUTABLE'; END IF;
 IF NEW.classroom_engine='CLASSROOM_V1' AND NOT EXISTS(SELECT 1 FROM public.teaching_classroom_preparation_binding_history h WHERE h.class_id=NEW.class_id AND h.student_id=NEW.student_id AND h.binding_version=NEW.classroom_binding_version AND h.snapshot->>'chapter_artifact_id'=NEW.classroom_chapter_artifact_id AND h.snapshot->>'lesson_blueprint_id'=NEW.lesson_blueprint_id) THEN RAISE EXCEPTION 'CLASSROOM_SESSION_PIN_MISMATCH'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.teaching_classroom_session_pin() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teaching_classroom_session_pin() TO service_role;
CREATE TRIGGER classroom_session_pin BEFORE INSERT OR UPDATE ON public.teaching_class_sessions FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_session_pin();
COMMIT;
