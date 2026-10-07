-- TPF-02 v1.2 decomposition/hierarchy projection.
-- The canonical audit JSON remains authoritative; this column preserves the
-- validated Topic -> Subtopic -> Learning Unit relationship in the normalized
-- D07 projection used for auditability and downstream inspection.

ALTER TABLE public.teaching_curriculum_audit_learning_units
  ADD COLUMN IF NOT EXISTS subtopic_id text;

COMMENT ON COLUMN public.teaching_curriculum_audit_learning_units.subtopic_id IS
  'TPF-02 v1.2 validated Subtopic id. Null only when the primary Topic has no Subtopics or the audit has no Topic layer.';
