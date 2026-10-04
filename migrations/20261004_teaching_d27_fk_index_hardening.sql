-- D27 follow-up after live advisor inspection: cover non-leading Class/Learning Unit foreign keys.
BEGIN;
CREATE INDEX IF NOT EXISTS teaching_study_card_references_class_fk_idx ON public.teaching_study_card_references(class_id);
CREATE INDEX IF NOT EXISTS teaching_study_card_references_learning_unit_fk_idx ON public.teaching_study_card_references(learning_unit_id);
CREATE INDEX IF NOT EXISTS teaching_study_card_candidates_class_fk_idx ON public.teaching_study_card_candidates(class_id);
CREATE INDEX IF NOT EXISTS teaching_study_card_candidates_learning_unit_fk_idx ON public.teaching_study_card_candidates(learning_unit_id);
COMMIT;
