BEGIN;

CREATE OR REPLACE FUNCTION public.teaching_d20_fill_gradebook_assessment_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.source_kind = 'ASSESSMENT' THEN
    IF NEW.source_result_id IS NULL THEN
      RAISE EXCEPTION 'D20 Assessment Gradebook rows require source_result_id';
    END IF;

    SELECT r.assessment_id, r.assessment_attempt_id, r.assessment_package_id
      INTO NEW.source_assessment_id, NEW.source_assessment_attempt_id, NEW.source_assessment_package_id
      FROM public.teaching_assessment_results r
     WHERE r.student_id = NEW.student_id
       AND r.assessment_result_id = NEW.source_result_id;

    IF NEW.source_assessment_id IS NULL
       OR NEW.source_assessment_attempt_id IS NULL
       OR NEW.source_assessment_package_id IS NULL THEN
      RAISE EXCEPTION 'D20 Assessment Gradebook lineage could not be resolved';
    END IF;

    IF NEW.source_ref <> NEW.source_assessment_attempt_id THEN
      RAISE EXCEPTION 'D20 Assessment Gradebook source_ref must equal the authoritative Attempt id';
    END IF;
  ELSE
    NEW.source_assessment_id := NULL;
    NEW.source_assessment_attempt_id := NULL;
    NEW.source_assessment_package_id := NULL;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS teaching_d20_gradebook_assessment_lineage_trg
  ON public.teaching_gradebook_entries;
CREATE TRIGGER teaching_d20_gradebook_assessment_lineage_trg
BEFORE INSERT ON public.teaching_gradebook_entries
FOR EACH ROW
EXECUTE FUNCTION public.teaching_d20_fill_gradebook_assessment_lineage();

-- Every Assessment ledger row therefore carries explicit immutable lineage to
-- the D17 Assessment, Attempt and locked Package in addition to the D20 result.
CREATE INDEX IF NOT EXISTS teaching_gradebook_entries_assessment_result_lineage_idx
  ON public.teaching_gradebook_entries(student_id,source_result_id,source_assessment_id,source_assessment_attempt_id,source_assessment_package_id);

REVOKE ALL ON FUNCTION public.teaching_d20_fill_gradebook_assessment_lineage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teaching_d20_fill_gradebook_assessment_lineage() TO service_role;

COMMIT;
