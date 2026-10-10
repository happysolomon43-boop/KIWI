-- Inactive D14 delivery extension. D11 remains the academic/time owner.
BEGIN;
ALTER TABLE public.teaching_class_sessions ADD CONSTRAINT classroom_delivery_session_owner_key UNIQUE(class_session_id,student_id,class_id);
CREATE TABLE public.teaching_classroom_delivery (
 session_id text PRIMARY KEY,
 student_id text NOT NULL,
 class_id text NOT NULL,
 binding_version bigint NOT NULL,
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>0),
 delivery_epoch bigint NOT NULL DEFAULT 1 CHECK(delivery_epoch>0),
 control_epoch bigint NOT NULL DEFAULT 0 CHECK(control_epoch>=0),
 delivery_state text NOT NULL DEFAULT 'READY' CHECK(delivery_state IN('READY','PREPARING','PRESENTING','PAUSED','RECOVERING','CLOSING','COMPLETED')),
 policy_version text NOT NULL,
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),
 authority jsonb NOT NULL CHECK(jsonb_typeof(authority)='object'),
 pace text NOT NULL,
 client_id text,
 lease_token_hash text,
 lease_expires_at timestamptz,
 last_published bigint NOT NULL DEFAULT 0 CHECK(last_published>=0),
 last_confirmed bigint NOT NULL DEFAULT 0 CHECK(last_confirmed>=0 AND last_confirmed<=last_published),
 cursor bigint NOT NULL DEFAULT 0 CHECK(cursor>=0),
 next_release_at timestamptz,
 resume_anchor text NOT NULL,
 stop_reason text,
 final_position jsonb,
 UNIQUE(session_id,student_id,class_id),
 FOREIGN KEY(session_id,student_id,class_id) REFERENCES public.teaching_class_sessions(class_session_id,student_id,class_id) ON DELETE RESTRICT,
 FOREIGN KEY(class_id,binding_version) REFERENCES public.teaching_classroom_preparation_binding_history(class_id,binding_version) ON DELETE RESTRICT
);
CREATE INDEX classroom_delivery_due_idx ON public.teaching_classroom_delivery(next_release_at) WHERE next_release_at IS NOT NULL;
CREATE INDEX classroom_delivery_owner_idx ON public.teaching_classroom_delivery(student_id,class_id);
CREATE TABLE public.teaching_classroom_sequences (
 sequence_id text PRIMARY KEY,
 session_id text NOT NULL REFERENCES public.teaching_classroom_delivery(session_id) ON DELETE RESTRICT,
 operation_key text NOT NULL,
 request_hash text NOT NULL,
 authority jsonb NOT NULL,
 directive jsonb NOT NULL,
 payload jsonb NOT NULL,
 delivery_epoch bigint NOT NULL,
 status text NOT NULL CHECK(status IN('PREPARED','EXHAUSTED','SUPERSEDED')),
 reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,operation_key),
 UNIQUE(sequence_id,session_id)
);
CREATE INDEX classroom_sequences_session_idx ON public.teaching_classroom_sequences(session_id,status);
CREATE TABLE public.teaching_classroom_portions (
 portion_id text PRIMARY KEY,
 session_id text NOT NULL,
 sequence_id text NOT NULL,
 ordinal bigint NOT NULL CHECK(ordinal>0),
 payload jsonb NOT NULL,
 public_payload jsonb NOT NULL,
 representation_state text CHECK(representation_state IN ('TEXT','BOARD','TEXT_FALLBACK')),
 board_item_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 asset_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(asset_ids)='array'),
 status text NOT NULL CHECK(status IN('PREPARED','PUBLISHED','CONFIRMED','SUPERSEDED')),
 published_at timestamptz,
 confirmed_at timestamptz,
 FOREIGN KEY(sequence_id,session_id) REFERENCES public.teaching_classroom_sequences(sequence_id,session_id) ON DELETE RESTRICT,
 UNIQUE(session_id,ordinal),
 UNIQUE(portion_id,session_id)
);
CREATE INDEX classroom_portions_pending_idx ON public.teaching_classroom_portions(session_id,ordinal) WHERE status='PREPARED';
CREATE TABLE public.teaching_classroom_conversation (
 event_id text PRIMARY KEY,
 session_id text NOT NULL REFERENCES public.teaching_classroom_delivery(session_id) ON DELETE RESTRICT,
 server_sequence bigint NOT NULL CHECK(server_sequence>0),
 portion_id text,
 payload jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,server_sequence),
 UNIQUE(portion_id),
 FOREIGN KEY(portion_id,session_id) REFERENCES public.teaching_classroom_portions(portion_id,session_id) ON DELETE RESTRICT
);
CREATE TABLE public.teaching_classroom_delivery_receipts (
 receipt_id text PRIMARY KEY,
 session_id text NOT NULL,
 portion_id text NOT NULL,
 control_epoch bigint NOT NULL,
 client_id text NOT NULL,
 operation_key text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,operation_key),
 UNIQUE(portion_id,control_epoch),
 FOREIGN KEY(portion_id,session_id) REFERENCES public.teaching_classroom_portions(portion_id,session_id) ON DELETE RESTRICT
);
CREATE INDEX classroom_receipts_session_idx ON public.teaching_classroom_delivery_receipts(session_id,received_at);
CREATE TABLE public.teaching_classroom_delivery_commands (
 session_id text NOT NULL REFERENCES public.teaching_classroom_delivery(session_id) ON DELETE RESTRICT,
 operation_key text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,operation_key)
);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['teaching_classroom_delivery','teaching_classroom_sequences','teaching_classroom_portions','teaching_classroom_conversation','teaching_classroom_delivery_receipts','teaching_classroom_delivery_commands'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',name);
  EXECUTE format('CREATE POLICY classroom_service_only ON public.%I TO service_role USING(true) WITH CHECK(true)',name);
 END LOOP;
END $$;
CREATE FUNCTION public.teaching_classroom_delivery_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CLASSROOM_DELIVERY_RECORD_IMMUTABLE'; END IF;
 IF TG_TABLE_NAME='teaching_classroom_delivery' THEN
  IF (NEW.session_id,NEW.student_id,NEW.class_id,NEW.binding_version,NEW.policy_version,NEW.policy,NEW.authority) IS DISTINCT FROM (OLD.session_id,OLD.student_id,OLD.class_id,OLD.binding_version,OLD.policy_version,OLD.policy,OLD.authority) THEN RAISE EXCEPTION 'CLASSROOM_DELIVERY_PIN_IMMUTABLE'; END IF;
  IF NEW.state_version<OLD.state_version OR NEW.delivery_epoch<OLD.delivery_epoch OR NEW.control_epoch<OLD.control_epoch OR NEW.cursor<OLD.cursor OR NEW.last_published<OLD.last_published OR NEW.last_confirmed<OLD.last_confirmed THEN RAISE EXCEPTION 'CLASSROOM_DELIVERY_PROGRESS_REGRESSION'; END IF;RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='teaching_classroom_sequences' AND (to_jsonb(NEW)-'status'-'reason') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status'-'reason') THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='teaching_classroom_portions' AND (to_jsonb(NEW)-'status'-'published_at'-'confirmed_at'-'board_item_ids'-'representation_state') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status'-'published_at'-'confirmed_at'-'board_item_ids'-'representation_state') THEN
  IF (OLD.status,NEW.status) NOT IN (('PREPARED','PUBLISHED'),('PREPARED','SUPERSEDED'),('PUBLISHED','CONFIRMED')) THEN RAISE EXCEPTION 'CLASSROOM_PORTION_TRANSITION_INVALID'; END IF;
  IF OLD.status<>'PREPARED' AND (NEW.published_at,NEW.board_item_ids,NEW.representation_state) IS DISTINCT FROM (OLD.published_at,OLD.board_item_ids,OLD.representation_state) THEN RAISE EXCEPTION 'CLASSROOM_PORTION_PUBLICATION_IMMUTABLE'; END IF;RETURN NEW;END IF;
 RAISE EXCEPTION 'CLASSROOM_DELIVERY_CONTENT_IMMUTABLE';
END $$;
REVOKE ALL ON FUNCTION public.teaching_classroom_delivery_immutable() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teaching_classroom_delivery_immutable() TO service_role;
CREATE TRIGGER classroom_delivery_pin_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_delivery FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_delivery_immutable();
CREATE TRIGGER classroom_sequence_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_sequences FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_delivery_immutable();
CREATE TRIGGER classroom_portion_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_portions FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_delivery_immutable();
CREATE TRIGGER classroom_conversation_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_conversation FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_delivery_immutable();
CREATE TRIGGER classroom_receipt_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_delivery_receipts FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_delivery_immutable();
CREATE TRIGGER classroom_command_immutable BEFORE UPDATE OR DELETE ON public.teaching_classroom_delivery_commands FOR EACH ROW EXECUTE FUNCTION public.teaching_classroom_delivery_immutable();
COMMIT;
