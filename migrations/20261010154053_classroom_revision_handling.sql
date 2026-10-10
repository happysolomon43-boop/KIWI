BEGIN;
CREATE TABLE public.teaching_classroom_revisions(
 revision_id text PRIMARY KEY,session_id text NOT NULL,operation_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN('correction','replan')),state text NOT NULL CHECK(state IN('HELD','UNRESOLVED','READY','CONFIRMED','APPLIED','SUPERSEDED')),
 request_hash text NOT NULL,original_portion_id text,payload jsonb NOT NULL,receipt jsonb NOT NULL,
 authority jsonb NOT NULL,delivery_epoch integer NOT NULL,sequence_id text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(session_id,operation_key),FOREIGN KEY(session_id) REFERENCES public.teaching_classroom_delivery(session_id),
 FOREIGN KEY(original_portion_id,session_id) REFERENCES public.teaching_classroom_portions(portion_id,session_id),
 FOREIGN KEY(sequence_id,session_id) REFERENCES public.teaching_classroom_sequences(sequence_id,session_id)
);
CREATE INDEX classroom_revision_pending_idx ON public.teaching_classroom_revisions(session_id,state) WHERE state IN('HELD','UNRESOLVED','READY');
ALTER TABLE public.teaching_classroom_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teaching_classroom_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.teaching_classroom_revisions TO service_role;
CREATE POLICY classroom_revision_service_only ON public.teaching_classroom_revisions TO service_role USING(true) WITH CHECK(true);
-- Accepted D11 replans advance only the plan/blueprint binding; chapter and policy pins remain protected.
CREATE OR REPLACE FUNCTION public.teaching_classroom_session_pin() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.classroom_engine,NEW.classroom_chapter_artifact_id,NEW.classroom_binding_version) IS DISTINCT FROM (OLD.classroom_engine,OLD.classroom_chapter_artifact_id,OLD.classroom_binding_version) THEN
  IF NEW.classroom_engine<>OLD.classroom_engine OR NEW.classroom_chapter_artifact_id IS DISTINCT FROM OLD.classroom_chapter_artifact_id OR NEW.classroom_binding_version<>OLD.classroom_binding_version+1 OR NEW.state_version<>OLD.state_version+1 OR OLD.lifecycle_state<>'ACTIVE' OR NOT EXISTS(
   SELECT 1 FROM public.teaching_classroom_preparation_binding_history h JOIN public.teaching_lesson_blueprints b ON b.lesson_blueprint_id=NEW.lesson_blueprint_id AND b.student_id=NEW.student_id AND b.class_id=NEW.class_id
   WHERE h.class_id=NEW.class_id AND h.student_id=NEW.student_id AND h.binding_version=NEW.classroom_binding_version
    AND (h.snapshot->'live_replan'->>'previous_binding_version')::bigint=OLD.classroom_binding_version
    AND h.snapshot->'live_replan'->>'previous_blueprint_id'=OLD.lesson_blueprint_id
    AND (h.snapshot->'live_replan'->>'controller_version')::bigint=OLD.state_version
    AND h.snapshot->'live_replan'->>'execution_id'=b.generation_provenance->>'executionId'
    AND b.generation_provenance->>'familyId'='TPF-05' AND b.generation_provenance->>'mode' IN ('live_lesson_replan','lateness_replan')
    AND b.validation_metadata->>'accepted'='true' AND b.validation_metadata->>'independent'='true'
    AND b.validation_metadata->>'reservePolicyAdoptionRef' IS NOT NULL
  ) THEN RAISE EXCEPTION 'CLASSROOM_SESSION_PIN_IMMUTABLE'; END IF;
 END IF;
 IF NEW.classroom_engine='CLASSROOM_V1' AND NOT EXISTS(SELECT 1 FROM public.teaching_classroom_preparation_binding_history h WHERE h.class_id=NEW.class_id AND h.student_id=NEW.student_id AND h.binding_version=NEW.classroom_binding_version AND h.snapshot->>'chapter_artifact_id'=NEW.classroom_chapter_artifact_id AND h.snapshot->>'lesson_blueprint_id'=NEW.lesson_blueprint_id) THEN RAISE EXCEPTION 'CLASSROOM_SESSION_PIN_MISMATCH'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.teaching_classroom_delivery_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CLASSROOM_DELIVERY_RECORD_IMMUTABLE'; END IF;
 IF TG_TABLE_NAME='teaching_classroom_delivery' THEN
  IF (NEW.session_id,NEW.student_id,NEW.class_id,NEW.binding_version,NEW.policy_version,NEW.policy,NEW.authority) IS DISTINCT FROM (OLD.session_id,OLD.student_id,OLD.class_id,OLD.binding_version,OLD.policy_version,OLD.policy,OLD.authority) THEN
   IF (NEW.session_id,NEW.student_id,NEW.class_id,NEW.policy_version,NEW.policy) IS DISTINCT FROM (OLD.session_id,OLD.student_id,OLD.class_id,OLD.policy_version,OLD.policy)
    OR NEW.binding_version<>OLD.binding_version+1 OR NOT EXISTS(
     SELECT 1 FROM public.teaching_class_sessions cs JOIN public.teaching_classroom_revisions r ON r.session_id=cs.class_session_id
     WHERE cs.class_session_id=NEW.session_id AND cs.student_id=NEW.student_id AND cs.classroom_binding_version=NEW.binding_version
      AND r.kind='replan' AND r.state='APPLIED' AND r.delivery_epoch=NEW.delivery_epoch
      AND r.payload->>'new_blueprint_id'=cs.lesson_blueprint_id AND r.receipt->>'accepted'='true' AND r.receipt->>'independent'='true'
      AND NEW.authority->>'blueprintId'=cs.lesson_blueprint_id AND NEW.authority->>'chapterId'=cs.classroom_chapter_artifact_id
      AND (NEW.authority->>'controllerVersion')::bigint=cs.state_version
    ) THEN RAISE EXCEPTION 'CLASSROOM_DELIVERY_PIN_IMMUTABLE'; END IF;
  END IF;
  IF NEW.state_version<OLD.state_version OR NEW.delivery_epoch<OLD.delivery_epoch OR NEW.control_epoch<OLD.control_epoch OR NEW.cursor<OLD.cursor OR NEW.last_published<OLD.last_published OR NEW.last_confirmed<OLD.last_confirmed THEN RAISE EXCEPTION 'CLASSROOM_DELIVERY_PROGRESS_REGRESSION'; END IF;RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='teaching_classroom_sequences' AND (to_jsonb(NEW)-'status'-'reason') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status'-'reason') THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='teaching_classroom_portions' AND (to_jsonb(NEW)-'status'-'published_at'-'confirmed_at'-'board_item_ids'-'representation_state') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status'-'published_at'-'confirmed_at'-'board_item_ids'-'representation_state') THEN
  IF (OLD.status,NEW.status) NOT IN (('PREPARED','PUBLISHED'),('PREPARED','SUPERSEDED'),('PUBLISHED','CONFIRMED')) THEN RAISE EXCEPTION 'CLASSROOM_PORTION_TRANSITION_INVALID'; END IF;
  IF OLD.status<>'PREPARED' AND (NEW.published_at,NEW.board_item_ids,NEW.representation_state) IS DISTINCT FROM (OLD.published_at,OLD.board_item_ids,OLD.representation_state) THEN RAISE EXCEPTION 'CLASSROOM_PORTION_PUBLICATION_IMMUTABLE'; END IF;RETURN NEW;END IF;
 RAISE EXCEPTION 'CLASSROOM_DELIVERY_CONTENT_IMMUTABLE';
END $$;

CREATE FUNCTION public.teaching_classroom_revision_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'state'-'sequence_id') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'sequence_id') THEN RAISE EXCEPTION 'CLASSROOM_REVISION_CONTENT_IMMUTABLE'; END IF;
 IF OLD.sequence_id IS NOT NULL AND NEW.sequence_id IS DISTINCT FROM OLD.sequence_id THEN RAISE EXCEPTION 'CLASSROOM_REVISION_BINDING_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.teaching_classroom_revision_immutable() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teaching_classroom_revision_immutable() TO service_role;
CREATE TRIGGER classroom_revision_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_revisions FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_revision_immutable();
COMMIT;
