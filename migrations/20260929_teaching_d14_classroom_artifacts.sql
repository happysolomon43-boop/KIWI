-- D14 owns student notebook and classroom interaction projections. D11 remains
-- the Controller/Class closure authority; D04 remains the Board/Evidence store.
CREATE TABLE public.teaching_student_notebook_items (
  notebook_item_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
  board_item_id text REFERENCES public.teaching_board_items(board_item_id) ON DELETE SET NULL,
  content text NOT NULL CHECK (length(content) <= 10000),
  source_kind text NOT NULL CHECK (source_kind IN ('PERSONAL','BOARD_REFERENCE')),
  version_no bigint NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_student_notebook_class_idx ON public.teaching_student_notebook_items(student_id,class_id,created_at);
CREATE INDEX teaching_student_notebook_class_fk_idx ON public.teaching_student_notebook_items(class_id);
CREATE INDEX teaching_student_notebook_board_fk_idx ON public.teaching_student_notebook_items(board_item_id);

CREATE TABLE public.teaching_classroom_interactions (
  interaction_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
  class_session_id text REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE RESTRICT,
  controller_version bigint,
  interaction_kind text NOT NULL CHECK (interaction_kind IN ('JOIN','ASK_TEACHER','NEED_HELP','READY','FINISHED','BREAK_REQUEST','EARLY_DISMISSAL_REQUEST','TECHNICAL_ISSUE','LEAVE')),
  body text CHECK (body IS NULL OR length(body) <= 2000),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_classroom_interactions_class_idx ON public.teaching_classroom_interactions(student_id,class_id,created_at);
CREATE INDEX teaching_classroom_interactions_class_fk_idx ON public.teaching_classroom_interactions(class_id);
CREATE INDEX teaching_classroom_interactions_session_fk_idx ON public.teaching_classroom_interactions(class_session_id);

CREATE TABLE public.teaching_teacher_communications (
  communication_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE RESTRICT,
  controller_version bigint NOT NULL,
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
  visibility text NOT NULL CHECK (visibility IN ('STUDENT','PRIVATE_INTERNAL')),
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_teacher_communications_class_idx ON public.teaching_teacher_communications(student_id,class_id,created_at DESC);
CREATE INDEX teaching_teacher_communications_class_fk_idx ON public.teaching_teacher_communications(class_id);
CREATE INDEX teaching_teacher_communications_session_fk_idx ON public.teaching_teacher_communications(class_session_id);

CREATE TABLE public.teaching_class_study_note_versions (
  note_version_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE RESTRICT,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  state text NOT NULL CHECK (state IN ('ROUTE_HELD','PREPARED_NOT_PUBLISHABLE','RECONCILIATION_HELD','DRAFT_READY_FOR_VALIDATION','VALIDATED_PRIVATE','SUPERSEDED')),
  stage text NOT NULL CHECK (stage IN ('PRE_CLASS','POST_CLASS')),
  binding jsonb NOT NULL CHECK (jsonb_typeof(binding)='object'),
  note_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(note_payload)='object'),
  validation jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation)='object'),
  closure_fact_id text REFERENCES public.teaching_class_closure_facts(closure_fact_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,class_id,version_no), UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_class_study_note_class_idx ON public.teaching_class_study_note_versions(student_id,class_id,version_no DESC);
CREATE INDEX teaching_class_study_note_class_fk_idx ON public.teaching_class_study_note_versions(class_id);
CREATE INDEX teaching_class_study_note_closure_fk_idx ON public.teaching_class_study_note_versions(closure_fact_id);

ALTER TABLE public.teaching_student_notebook_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_classroom_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_class_study_note_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_teacher_communications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teaching_student_notebook_items,public.teaching_classroom_interactions,public.teaching_class_study_note_versions,public.teaching_teacher_communications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.teaching_student_notebook_items TO service_role;
GRANT SELECT,INSERT ON public.teaching_classroom_interactions,public.teaching_class_study_note_versions TO service_role;
GRANT SELECT,INSERT ON public.teaching_teacher_communications TO service_role;

COMMENT ON TABLE public.teaching_class_study_note_versions IS 'D14 private TPF-20 preparation and reconciliation artifacts. D27 owns real card-set/publication integration; no student-facing publication from this table.';
