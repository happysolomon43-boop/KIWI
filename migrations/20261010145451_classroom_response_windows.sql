BEGIN;
ALTER TABLE public.teaching_classroom_delivery DROP CONSTRAINT teaching_classroom_delivery_delivery_state_check;
ALTER TABLE public.teaching_classroom_delivery ADD CONSTRAINT teaching_classroom_delivery_delivery_state_check CHECK(delivery_state IN('READY','PREPARING','PRESENTING','PAUSED','RECOVERING','CLOSING','COMPLETED','WAITING_FOR_RESPONSE','WAITING_FOR_INTERPRETATION'));
CREATE TABLE public.teaching_classroom_tasks (
 task_id text PRIMARY KEY, session_id text NOT NULL, student_id text NOT NULL,class_id text NOT NULL,
 operation_key text NOT NULL,task_version text NOT NULL,task_payload jsonb NOT NULL,design_proposal jsonb NOT NULL,
 validation_receipt jsonb NOT NULL,authority jsonb NOT NULL,content_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,session_id),UNIQUE(session_id,operation_key),
 FOREIGN KEY(session_id,student_id,class_id) REFERENCES public.teaching_classroom_delivery(session_id,student_id,class_id) ON DELETE RESTRICT
);
CREATE TABLE public.teaching_classroom_task_windows (
 window_id text PRIMARY KEY,task_id text NOT NULL UNIQUE,session_id text NOT NULL,version_no integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'PENDING_DELIVERY' CHECK(state IN('PENDING_DELIVERY','OPEN','RESPONSE_ACCEPTED','EXPIRED_NO_RESPONSE','CLOSED_BY_CLASS','CANCELLED_SYSTEM')),
 duration_ms bigint NOT NULL CHECK(duration_ms>0),opened_at timestamptz,deadline_at timestamptz,class_end_at timestamptz NOT NULL,
 handling_complete boolean NOT NULL DEFAULT false, extension_count integer NOT NULL DEFAULT 0 CHECK(extension_count>=0),activation_receipt_id text,sequence_id text,system_reason text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(task_id,session_id) REFERENCES public.teaching_classroom_tasks(task_id,session_id),
 FOREIGN KEY(sequence_id,session_id) REFERENCES public.teaching_classroom_sequences(sequence_id,session_id),
 CHECK(deadline_at IS NULL OR (opened_at IS NOT NULL AND deadline_at>opened_at AND deadline_at<=class_end_at))
);
CREATE UNIQUE INDEX classroom_one_blocking_task_idx ON public.teaching_classroom_task_windows(session_id) WHERE state IN('PENDING_DELIVERY','OPEN','RESPONSE_ACCEPTED') AND handling_complete=false;
CREATE TABLE public.teaching_classroom_task_operations (
 session_id text NOT NULL,operation_key text NOT NULL,request_hash text NOT NULL,outcome jsonb NOT NULL,
 PRIMARY KEY(session_id,operation_key),FOREIGN KEY(session_id) REFERENCES public.teaching_classroom_delivery(session_id)
);
CREATE TABLE public.teaching_classroom_task_admissions (
 admission_id text PRIMARY KEY,response_id text NOT NULL UNIQUE,task_id text NOT NULL,session_id text NOT NULL,
 accepted_at timestamptz NOT NULL,context_snapshot jsonb NOT NULL,exposure_snapshot jsonb NOT NULL,receipt jsonb NOT NULL,
 FOREIGN KEY(response_id) REFERENCES public.teaching_student_responses(response_id),
 FOREIGN KEY(task_id,session_id) REFERENCES public.teaching_classroom_tasks(task_id,session_id)
);
CREATE TABLE public.teaching_classroom_task_exposure (
 exposure_id text PRIMARY KEY,task_id text NOT NULL,session_id text NOT NULL,operation_key text NOT NULL,
 exposure_payload jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now(),UNIQUE(task_id,operation_key),
 FOREIGN KEY(task_id,session_id) REFERENCES public.teaching_classroom_tasks(task_id,session_id)
);
CREATE TABLE public.teaching_classroom_task_evaluation_jobs (
 admission_id text PRIMARY KEY,state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','PROCESSING','RETRY','HELD','COMPLETED')),
 attempts integer NOT NULL DEFAULT 0,lease_token text,lease_expires_at timestamptz,next_attempt_at timestamptz,
 evaluation_id text,acceptance_receipt jsonb,selected_action jsonb,public_feedback jsonb,failure_code text,
 FOREIGN KEY(admission_id) REFERENCES public.teaching_classroom_task_admissions(admission_id),
 FOREIGN KEY(evaluation_id) REFERENCES public.teaching_response_evaluations(evaluation_id)
);
CREATE INDEX classroom_task_evaluation_retry_idx ON public.teaching_classroom_task_evaluation_jobs(state,next_attempt_at,lease_expires_at) WHERE state IN('PENDING','PROCESSING','RETRY');
CREATE INDEX classroom_task_window_expiry_idx ON public.teaching_classroom_task_windows(deadline_at) WHERE state='OPEN' AND handling_complete=false;
CREATE TRIGGER classroom_task_operation_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_task_operations FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_message_immutable();
CREATE TRIGGER classroom_task_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_tasks FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_message_immutable();
CREATE TRIGGER classroom_admission_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_task_admissions FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_message_immutable();
CREATE TRIGGER classroom_exposure_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_task_exposure FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_message_immutable();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['teaching_classroom_tasks','teaching_classroom_task_windows','teaching_classroom_task_operations','teaching_classroom_task_admissions','teaching_classroom_task_exposure','teaching_classroom_task_evaluation_jobs'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',name);
 EXECUTE format('CREATE POLICY classroom_task_service_only ON public.%I TO service_role USING(true) WITH CHECK(true)',name);
 END LOOP;
END $$;
COMMIT;
