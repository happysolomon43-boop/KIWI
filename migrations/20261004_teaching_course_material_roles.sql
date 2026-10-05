BEGIN;

ALTER TABLE public.teaching_source_content_items
  DROP CONSTRAINT IF EXISTS teaching_source_kind_d07;

ALTER TABLE public.teaching_source_content_items
  ADD CONSTRAINT teaching_source_kind_d07 CHECK (source_kind IN (
    'PRIMARY_KIWI_SUBJECT',
    'PRIMARY_STUDY_NOTE',
    'KIWI_SUBJECT_FLASHCARDS',
    'STUDENT_SUPPLEMENT',
    'AUTHORITATIVE_SCHOOL_SCOPE',
    'AI_SUPPLEMENTATION'
  ));

COMMENT ON CONSTRAINT teaching_source_kind_d07 ON public.teaching_source_content_items IS
  'Separates an optional original study note from KIWI flashcards and other supplemental Course material.';

COMMIT;
