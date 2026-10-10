BEGIN;
CREATE TABLE public.teaching_classroom_revisions(
 revision_id text PRIMARY KEY,session_id text NOT NULL,operation_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN('correction','replan')),state text NOT NULL CHECK(state IN('HELD','UNRESOLVED','READY','CONFIRMED','APPLIED','SUPERSEDED')),
 request_hash text NOT NULL,original_portion_id text,payload jsonb NOT NULL,receipt jsonb NOT NULL,
 authority jsonb NOT NULL,delivery_epoch integer NOT NULL,sequence_id text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,operation_key),FOREIGN KEY(session_id) REFERENCES public.teaching_classroom_delivery(session_id),
 FOREIGN KEY(original_portion_id,session_id) REFERENCES public.teaching_classroom_portions(portion_id,session_id),
 FOREIGN KEY(sequence_id,session_id) REFERENCES public.teaching_classroom_sequences(sequence_id,session_id)
);
CREATE INDEX classroom_revision_pending_idx ON public.teaching_classroom_revisions(session_id,state) WHERE state IN('HELD','UNRESOLVED','READY');
ALTER TABLE public.teaching_classroom_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teaching_classroom_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.teaching_classroom_revisions TO service_role;
CREATE POLICY classroom_revision_service_only ON public.teaching_classroom_revisions TO service_role USING(true) WITH CHECK(true);
COMMIT;
