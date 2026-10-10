-- Additive D14 Notebook metadata. Existing personal/Board readers remain valid.
ALTER TABLE public.teaching_student_notebook_items ADD COLUMN source_ref jsonb;
ALTER TABLE public.teaching_student_notebook_items ADD CONSTRAINT classroom_notebook_ref_shape CHECK(source_ref IS NULL OR (jsonb_typeof(source_ref)='object' AND source_ref ?& ARRAY['kind','id','version','anchor'] AND source_ref->>'kind' IN ('chapter','portion','message') AND length(source_ref->>'id')>0 AND length(source_ref->>'version')>0));
-- Existing service-only RLS/grants continue to apply; no browser DML added.
