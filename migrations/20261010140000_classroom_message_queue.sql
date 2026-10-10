-- Additive candidate persistence; no browser writes, no active prompt cutover.
BEGIN;
CREATE TABLE public.teaching_classroom_messages (
 message_id text PRIMARY KEY, session_id text NOT NULL, student_id text NOT NULL, class_id text NOT NULL,
 operation_key text NOT NULL, request_hash text NOT NULL, content text NOT NULL CHECK(length(btrim(content))>0),
 client_intent text NOT NULL, admitted_lane text NOT NULL CHECK(admitted_lane IN('conversation','clarification','technical_report','correction_report')),
 source_ref jsonb, context_anchor text NOT NULL, reply_to text, accepted_at timestamptz NOT NULL DEFAULT now(), receipt jsonb NOT NULL,
 UNIQUE(session_id,operation_key), UNIQUE(message_id,session_id),
 FOREIGN KEY(session_id,student_id,class_id) REFERENCES public.teaching_classroom_delivery(session_id,student_id,class_id) ON DELETE RESTRICT,
 FOREIGN KEY(reply_to,session_id) REFERENCES public.teaching_classroom_messages(message_id,session_id) ON DELETE RESTRICT
);
CREATE TABLE public.teaching_classroom_allowance_charges (
 message_id text PRIMARY KEY, session_id text NOT NULL, policy_version text NOT NULL, charged_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(message_id,session_id) REFERENCES public.teaching_classroom_messages(message_id,session_id) ON DELETE RESTRICT
);
CREATE INDEX classroom_allowance_session_idx ON public.teaching_classroom_allowance_charges(session_id);
CREATE TABLE public.teaching_classroom_message_queue (
 message_id text PRIMARY KEY, session_id text NOT NULL,
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN('waiting','ready','needing clarification','answered','unresolved at closure')),
 classification text, disposition text, group_id text, commitment_kind text CHECK(commitment_kind IN('boundary','unit','closure','follow_up_proposal','immediate')),
 commitment_anchor text, committed_at timestamptz, resume_anchor text, release_hold boolean NOT NULL DEFAULT false,
 reply_sequence_id text, reply_event_id text, clarification_open boolean NOT NULL DEFAULT false,
 processing_state text NOT NULL DEFAULT 'PENDING' CHECK(processing_state IN('PENDING','PROCESSING','RETRY','DONE','HELD')),
 answer_attempts integer NOT NULL DEFAULT 0 CHECK(answer_attempts>=0),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), lease_token text, lease_expires_at timestamptz, next_attempt_at timestamptz,
 failure_code text, accepted_proposal jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(message_id,session_id) REFERENCES public.teaching_classroom_messages(message_id,session_id) ON DELETE RESTRICT,
 FOREIGN KEY(group_id,session_id) REFERENCES public.teaching_classroom_messages(message_id,session_id) ON DELETE RESTRICT,
 FOREIGN KEY(reply_sequence_id,session_id) REFERENCES public.teaching_classroom_sequences(sequence_id,session_id) ON DELETE RESTRICT,
 FOREIGN KEY(reply_event_id) REFERENCES public.teaching_classroom_conversation(event_id) ON DELETE RESTRICT
);
CREATE INDEX classroom_queue_fair_idx ON public.teaching_classroom_message_queue(session_id,state,committed_at,message_id);
CREATE INDEX classroom_queue_retry_idx ON public.teaching_classroom_message_queue(next_attempt_at) WHERE processing_state IN('PENDING','RETRY','PROCESSING');
CREATE TABLE public.teaching_classroom_message_proposals (
 proposal_id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, lease_token text NOT NULL,
 proposal jsonb NOT NULL, accepted boolean NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(message_id,lease_token), FOREIGN KEY(message_id,session_id) REFERENCES public.teaching_classroom_messages(message_id,session_id) ON DELETE RESTRICT
);
CREATE FUNCTION public.teaching_classroom_message_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Accepted message and allowance provenance is immutable'; END $$;
CREATE TRIGGER classroom_message_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_messages FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_message_immutable();
CREATE TRIGGER classroom_charge_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_allowance_charges FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_message_immutable();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['teaching_classroom_messages','teaching_classroom_allowance_charges','teaching_classroom_message_queue','teaching_classroom_message_proposals'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',name);
  EXECUTE format('CREATE POLICY classroom_message_service_only ON public.%I TO service_role USING(true) WITH CHECK(true)',name);
 END LOOP;
END $$;
COMMIT;
