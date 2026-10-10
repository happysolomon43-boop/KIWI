BEGIN;
CREATE TABLE public.teaching_classroom_task_turns(
 turn_id text PRIMARY KEY,task_id text NOT NULL,session_id text NOT NULL,operation_key text NOT NULL,
 adjustment_state text NOT NULL DEFAULT 'PENDING' CHECK(adjustment_state IN('PENDING','APPLIED','HELD')),adjustment_outcome jsonb,
 kind text NOT NULL CHECK(kind IN('feedback','assistance','clarification')),
 state text NOT NULL DEFAULT 'PREPARED' CHECK(state IN('PREPARED','RELEASED','CONFIRMED','SUPERSEDED')),
 output jsonb NOT NULL,directive jsonb NOT NULL,receipt jsonb NOT NULL,selected_action jsonb NOT NULL,
 assistance_level text NOT NULL,content_hash text NOT NULL,authority jsonb NOT NULL,delivery_epoch integer NOT NULL,
 sequence_id text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(session_id,operation_key),
 FOREIGN KEY(task_id,session_id) REFERENCES public.teaching_classroom_tasks(task_id,session_id),
 FOREIGN KEY(sequence_id,session_id) REFERENCES public.teaching_classroom_sequences(sequence_id,session_id)
);
CREATE UNIQUE INDEX classroom_task_one_pending_turn ON public.teaching_classroom_task_turns(task_id) WHERE state IN('PREPARED','RELEASED');
CREATE TABLE public.teaching_classroom_task_support_requests(
 request_id text PRIMARY KEY,task_id text NOT NULL,session_id text NOT NULL,operation_key text NOT NULL,
 request_hash text NOT NULL,kind text NOT NULL CHECK(kind IN('help','clarification')),text text NOT NULL,
 receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(session_id,operation_key),
 FOREIGN KEY(task_id,session_id) REFERENCES public.teaching_classroom_tasks(task_id,session_id)
);
CREATE TRIGGER classroom_task_support_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_task_support_requests FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_message_immutable();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['teaching_classroom_task_turns','teaching_classroom_task_support_requests'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',name);
 EXECUTE format('CREATE POLICY classroom_task_handling_service_only ON public.%I TO service_role USING(true) WITH CHECK(true)',name);
 END LOOP;
END $$;
COMMIT;
