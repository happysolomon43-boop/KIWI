BEGIN;

-- KIWI Teaching D20 corrective academic-authority hardening.
-- This migration adds no new grading policy. It enforces frozen D20 contracts:
-- authoritative final-response integrity, bounded criterion credit, and
-- rubric-authorized follow-through/error-carried-forward only.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.teaching_marking_criterion_judgments'::regclass
      AND conname='teaching_marking_criterion_judgments_credit_upper_bound_check'
  ) THEN
    ALTER TABLE public.teaching_marking_criterion_judgments
      ADD CONSTRAINT teaching_marking_criterion_judgments_credit_upper_bound_check
      CHECK (proposed_credit IS NULL OR proposed_credit <= criterion_max_marks) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.teaching_marking_criterion_judgments
  VALIDATE CONSTRAINT teaching_marking_criterion_judgments_credit_upper_bound_check;

CREATE OR REPLACE FUNCTION public.teaching_d20_guard_result_snapshot_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE
  a record;
BEGIN
  SELECT attempt_state,result_state,assessment_package_id,finalization_version,final_snapshot_ref,final_snapshot
    INTO a
    FROM public.teaching_assessment_attempts
   WHERE student_id=NEW.student_id
     AND assessment_attempt_id=NEW.assessment_attempt_id;

  IF a IS NULL
     OR a.attempt_state NOT IN ('SUBMITTED','EXPIRED')
     OR a.result_state <> 'AWAITING_MARKING'
     OR COALESCE(a.finalization_version,0) < 1
     OR a.final_snapshot_ref IS NULL
     OR a.final_snapshot IS NULL
     OR jsonb_typeof(a.final_snapshot->'responses') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'D20 requires an authoritative finalized D17 response snapshot before result creation';
  END IF;

  IF NEW.assessment_package_id IS DISTINCT FROM a.assessment_package_id
     OR NEW.source_snapshot_ref IS DISTINCT FROM a.final_snapshot_ref THEN
    RAISE EXCEPTION 'D20 result source lineage does not match the authoritative finalized Attempt snapshot';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(a.final_snapshot->'responses') AS s(value)
     GROUP BY s.value->>'package_item_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'D20 authoritative final response snapshot contains duplicate item responses';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(a.final_snapshot->'responses') AS s(value)
      LEFT JOIN public.teaching_assessment_package_items pi
        ON pi.student_id=NEW.student_id
       AND pi.assessment_package_id=a.assessment_package_id
       AND pi.package_item_id=s.value->>'package_item_id'
     WHERE pi.package_item_id IS NULL
  ) THEN
    RAISE EXCEPTION 'D20 authoritative final response snapshot contains an unknown package item';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(a.final_snapshot->'responses') AS s(value)
      LEFT JOIN LATERAL (
        SELECT r.response_version,r.renderer_payload
          FROM public.teaching_assessment_responses r
         WHERE r.student_id=NEW.student_id
           AND r.assessment_attempt_id=NEW.assessment_attempt_id
           AND r.package_item_id=s.value->>'package_item_id'
         ORDER BY r.response_version DESC
         LIMIT 1
      ) current_response ON true
     WHERE current_response.response_version IS NULL
        OR current_response.response_version IS DISTINCT FROM (s.value->>'response_version')::integer
        OR current_response.renderer_payload IS DISTINCT FROM s.value->'renderer_payload'
  ) THEN
    RAISE EXCEPTION 'D20 current response evidence differs from the authoritative final snapshot';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        SELECT DISTINCT ON (r.package_item_id) r.package_item_id,r.response_version,r.renderer_payload
          FROM public.teaching_assessment_responses r
         WHERE r.student_id=NEW.student_id
           AND r.assessment_attempt_id=NEW.assessment_attempt_id
         ORDER BY r.package_item_id,r.response_version DESC
      ) current_response
     WHERE NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(a.final_snapshot->'responses') AS s(value)
        WHERE s.value->>'package_item_id'=current_response.package_item_id
     )
  ) THEN
    RAISE EXCEPTION 'D20 current response store contains evidence absent from the authoritative final snapshot';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS teaching_d20_result_snapshot_integrity_guard
  ON public.teaching_assessment_results;
CREATE TRIGGER teaching_d20_result_snapshot_integrity_guard
BEFORE INSERT ON public.teaching_assessment_results
FOR EACH ROW
EXECUTE FUNCTION public.teaching_d20_guard_result_snapshot_integrity();

CREATE OR REPLACE FUNCTION public.teaching_d20_guard_follow_through_authorization()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE
  protected_payload jsonb;
  rubric jsonb;
  criterion jsonb;
  policy text;
  conditions jsonb;
  answer_policy text;
BEGIN
  IF COALESCE(NEW.follow_through_applied,false)=false AND COALESCE(NEW.alternative_valid_route_used,false)=false THEN
    RETURN NEW;
  END IF;

  SELECT pi.protected_marking_payload
    INTO protected_payload
    FROM public.teaching_assessment_package_items pi
   WHERE pi.student_id=NEW.student_id
     AND pi.package_item_id=NEW.package_item_id;

  rubric:=COALESCE(
    protected_payload->'rubric',
    protected_payload->'rubric_contract',
    protected_payload->'mark_scheme',
    protected_payload->'markScheme'
  );

  IF rubric IS NULL OR jsonb_typeof(rubric->'criteria') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'D20 follow-through credit requires a locked structured rubric';
  END IF;

  SELECT c.value
    INTO criterion
    FROM jsonb_array_elements(rubric->'criteria') AS c(value)
   WHERE COALESCE(c.value->>'criterion_id',c.value->>'criterionId')=NEW.criterion_id
   LIMIT 1;

  IF criterion IS NULL THEN
    RAISE EXCEPTION 'D20 rubric-credit criterion is outside the locked rubric';
  END IF;

  IF COALESCE(NEW.alternative_valid_route_used,false)=true THEN
    answer_policy:=lower(COALESCE(criterion->>'answer_space_policy',criterion->>'answerSpacePolicy',''));
    IF answer_policy='exhaustive' THEN
      RAISE EXCEPTION 'D20 exhaustive-rubric omitted valid answer requires rubric-defect review, not alternative-route credit';
    END IF;
    IF answer_policy NOT IN ('illustrative','open_constrained') THEN
      RAISE EXCEPTION 'D20 alternative-route credit requires an explicit non-exhaustive answer-space policy';
    END IF;
  END IF;

  IF COALESCE(NEW.follow_through_applied,false)=false THEN
    RETURN NEW;
  END IF;

  policy:=lower(COALESCE(criterion->>'follow_through_policy',criterion->>'followThroughPolicy','not_applicable'));
  conditions:=COALESCE(criterion->'follow_through_conditions',criterion->'followThroughConditions','[]'::jsonb);

  IF policy NOT IN ('allowed','conditional') THEN
    RAISE EXCEPTION 'D20 follow-through/error-carried-forward credit is not authorized by the locked rubric';
  END IF;

  IF policy='conditional' AND (
    jsonb_typeof(conditions) IS DISTINCT FROM 'array'
    OR jsonb_array_length(conditions)=0
  ) THEN
    RAISE EXCEPTION 'D20 conditional follow-through requires predeclared locked-rubric conditions';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS teaching_d20_follow_through_authorization_guard
  ON public.teaching_marking_criterion_judgments;
CREATE TRIGGER teaching_d20_follow_through_authorization_guard
BEFORE INSERT ON public.teaching_marking_criterion_judgments
FOR EACH ROW
EXECUTE FUNCTION public.teaching_d20_guard_follow_through_authorization();

REVOKE ALL ON FUNCTION public.teaching_d20_guard_result_snapshot_integrity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teaching_d20_guard_follow_through_authorization() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teaching_d20_guard_result_snapshot_integrity() TO service_role;
GRANT EXECUTE ON FUNCTION public.teaching_d20_guard_follow_through_authorization() TO service_role;

COMMIT;
