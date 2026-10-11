-- Additive inactive candidate. Complete archives remain; the three-Class
-- retrieval horizon is not a deletion rule.
BEGIN;
ALTER TABLE public.teaching_classroom_task_evaluation_jobs ADD COLUMN completed_at timestamptz, ADD COLUMN completed_after_closure boolean NOT NULL DEFAULT false;
ALTER TABLE public.teaching_classroom_delivery ADD CONSTRAINT classroom_delivery_session_owner_unique UNIQUE(session_id,student_id);
CREATE TABLE public.teaching_classroom_reconciliation_versions(
 record_id text PRIMARY KEY,student_id text NOT NULL,session_id text NOT NULL,
 version_no integer NOT NULL CHECK(version_no>0),content_hash text NOT NULL,
 record jsonb NOT NULL CHECK(jsonb_typeof(record)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(session_id,version_no),UNIQUE(session_id,content_hash),
 FOREIGN KEY(session_id,student_id) REFERENCES public.teaching_classroom_delivery(session_id,student_id)
);
CREATE TABLE public.teaching_classroom_follow_up_links(
 link_id text PRIMARY KEY,student_id text NOT NULL,source_session_id text NOT NULL,message_id text NOT NULL,
 target_session_id text NOT NULL,operation_key text NOT NULL,request_hash text NOT NULL,
 state text NOT NULL DEFAULT 'LINKED_UNRESOLVED' CHECK(state IN('LINKED_UNRESOLVED','RESOLVED')),
 reply_portion_id text,receipt jsonb,resolved_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(source_session_id<>target_session_id),
 CHECK((state='RESOLVED')=(reply_portion_id IS NOT NULL AND receipt IS NOT NULL AND resolved_at IS NOT NULL)),
 UNIQUE(target_session_id,operation_key),UNIQUE(source_session_id,message_id,target_session_id),
 FOREIGN KEY(source_session_id,student_id) REFERENCES public.teaching_classroom_delivery(session_id,student_id),
 FOREIGN KEY(target_session_id,student_id) REFERENCES public.teaching_classroom_delivery(session_id,student_id),
 FOREIGN KEY(message_id,source_session_id) REFERENCES public.teaching_classroom_messages(message_id,session_id),
 FOREIGN KEY(reply_portion_id,target_session_id) REFERENCES public.teaching_classroom_portions(portion_id,session_id)
);
CREATE INDEX classroom_follow_up_pending_idx ON public.teaching_classroom_follow_up_links(student_id,target_session_id,state);
CREATE INDEX classroom_recent_closed_idx ON public.teaching_class_sessions(student_id,course_id,ended_at DESC,class_session_id DESC) WHERE lifecycle_state='CLOSED';
CREATE TRIGGER classroom_reconciliation_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_reconciliation_versions FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_message_immutable();
CREATE FUNCTION public.teaching_classroom_follow_up_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state='RESOLVED' OR (to_jsonb(NEW)-'state'-'reply_portion_id'-'receipt'-'resolved_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'reply_portion_id'-'receipt'-'resolved_at') THEN RAISE EXCEPTION 'CLASSROOM_FOLLOW_UP_IMMUTABLE'; END IF;
 IF NEW.state<>'RESOLVED' THEN RAISE EXCEPTION 'CLASSROOM_FOLLOW_UP_TRANSITION_INVALID'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.teaching_classroom_follow_up_immutable() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teaching_classroom_follow_up_immutable() TO service_role;
CREATE TRIGGER classroom_follow_up_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_follow_up_links FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_follow_up_immutable();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['teaching_classroom_reconciliation_versions','teaching_classroom_follow_up_links'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',name);
  EXECUTE format('CREATE POLICY classroom_continuity_service_only ON public.%I TO service_role USING(true) WITH CHECK(true)',name);
 END LOOP;
END $$;
COMMIT;
