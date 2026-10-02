BEGIN;

-- KIWI Teaching D20 authority hardening.
-- This migration reconstructs the accepted Integration guards and adds the
-- missing fail-closed appeal-direction and attempt-start gates. It is
-- idempotent so Integration (where the first guard set already exists),
-- Production and isolated reconstruction converge to the same state.

CREATE OR REPLACE FUNCTION public.teaching_d20_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'D20 versioned academic evidence is append-only';
END
$$;

CREATE OR REPLACE FUNCTION public.teaching_d20_guard_grading_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF OLD.policy_state='LOCKED' THEN
    IF NEW.policy_state NOT IN ('LOCKED','SUPERSEDED') THEN
      RAISE EXCEPTION 'Locked Grading Policy cannot return to a mutable state';
    END IF;
    IF NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.course_id IS DISTINCT FROM OLD.course_id OR
       NEW.version_no IS DISTINCT FROM OLD.version_no OR NEW.category_weights IS DISTINCT FROM OLD.category_weights OR
       NEW.rounding_policy IS DISTINCT FROM OLD.rounding_policy OR NEW.grade_scale_policy IS DISTINCT FROM OLD.grade_scale_policy OR
       NEW.topic_evidence_policy IS DISTINCT FROM OLD.topic_evidence_policy OR NEW.essential_outcome_policy IS DISTINCT FROM OLD.essential_outcome_policy OR
       NEW.moderation_policy IS DISTINCT FROM OLD.moderation_policy OR NEW.appeal_policy IS DISTINCT FROM OLD.appeal_policy OR
       NEW.source_policy_refs IS DISTINCT FROM OLD.source_policy_refs OR NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
      RAISE EXCEPTION 'Locked Grading Policy content is immutable';
    END IF;
  END IF;
  IF OLD.policy_state='SUPERSEDED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Superseded Grading Policy is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.teaching_d20_guard_result_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.course_id IS DISTINCT FROM OLD.course_id OR
     NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.assessment_attempt_id IS DISTINCT FROM OLD.assessment_attempt_id OR
     NEW.assessment_package_id IS DISTINCT FROM OLD.assessment_package_id OR NEW.grading_policy_id IS DISTINCT FROM OLD.grading_policy_id OR
     NEW.assessment_type IS DISTINCT FROM OLD.assessment_type OR NEW.category_key IS DISTINCT FROM OLD.category_key OR
     NEW.source_snapshot_ref IS DISTINCT FROM OLD.source_snapshot_ref OR NEW.source_snapshot_hash IS DISTINCT FROM OLD.source_snapshot_hash THEN
    RAISE EXCEPTION 'Assessment Result source identity is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.teaching_d20_guard_appeal_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF NEW.assessment_result_id IS DISTINCT FROM OLD.assessment_result_id OR NEW.student_id IS DISTINCT FROM OLD.student_id OR
     NEW.package_item_id IS DISTINCT FROM OLD.package_item_id OR NEW.criterion_id IS DISTINCT FROM OLD.criterion_id OR
     NEW.appeal_ground IS DISTINCT FROM OLD.appeal_ground OR NEW.raw_appeal_text IS DISTINCT FROM OLD.raw_appeal_text OR
     NEW.review_direction_policy IS DISTINCT FROM OLD.review_direction_policy OR NEW.prior_appeal_id IS DISTINCT FROM OLD.prior_appeal_id OR
     NEW.repeat_authorization_ref IS DISTINCT FROM OLD.repeat_authorization_ref OR NEW.rubric_ref IS DISTINCT FROM OLD.rubric_ref OR
     NEW.policy_ref IS DISTINCT FROM OLD.policy_ref OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
     NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Appeal intake identity and original claim are immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.teaching_d20_require_locked_grading_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE policy_exists boolean;
BEGIN
  IF COALESCE(NEW.graded,false)=false THEN RETURN NEW; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.teaching_grading_policies p
    WHERE p.student_id=NEW.student_id AND p.course_id=NEW.course_id
      AND p.policy_state='LOCKED' AND p.locked_at IS NOT NULL AND p.locked_at<=now()
  ) INTO policy_exists;
  IF NOT policy_exists THEN
    RAISE EXCEPTION 'D20 locked Course Grading Policy is required before graded work begins';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.teaching_d20_require_policy_before_attempt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE a record; policy_exists boolean;
BEGIN
  SELECT student_id,course_id,graded INTO a
  FROM public.teaching_assessments
  WHERE assessment_id=NEW.assessment_id;
  IF a IS NULL OR COALESCE(a.graded,false)=false THEN RETURN NEW; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.teaching_grading_policies p
    WHERE p.student_id=a.student_id AND p.course_id=a.course_id
      AND p.policy_state='LOCKED' AND p.locked_at IS NOT NULL AND p.locked_at<=now()
  ) INTO policy_exists;
  IF NOT policy_exists THEN
    RAISE EXCEPTION 'D20 locked Course Grading Policy is required before a graded Attempt starts';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.teaching_d20_guard_policy_appeal_direction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE direction text; authority_ref text;
BEGIN
  direction:=NULLIF(NEW.appeal_policy->>'default_review_direction','');
  authority_ref:=COALESCE(NULLIF(NEW.appeal_policy->>'authority_ref',''),NULLIF(NEW.appeal_policy->>'policy_ref',''));
  IF direction IS NOT NULL AND authority_ref IS NULL THEN
    NEW.appeal_policy:=jsonb_set(COALESCE(NEW.appeal_policy,'{}'::jsonb),'{default_review_direction}','null'::jsonb,true);
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.teaching_d20_require_configured_appeal_direction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE configured text;
BEGIN
  SELECT p.appeal_policy->>'default_review_direction' INTO configured
  FROM public.teaching_assessment_results r
  JOIN public.teaching_grading_policies p ON p.grading_policy_id=r.grading_policy_id
  WHERE r.assessment_result_id=NEW.assessment_result_id AND r.student_id=NEW.student_id;
  IF configured IS NULL OR configured='' THEN
    RAISE EXCEPTION 'Appeal review direction requires an explicit versioned Course/institution policy';
  END IF;
  IF NEW.review_direction_policy IS DISTINCT FROM configured THEN
    RAISE EXCEPTION 'Appeal review direction must match policy-at-event';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS teaching_d20_grading_policy_guard ON public.teaching_grading_policies;
CREATE TRIGGER teaching_d20_grading_policy_guard BEFORE UPDATE ON public.teaching_grading_policies FOR EACH ROW EXECUTE FUNCTION public.teaching_d20_guard_grading_policy();
DROP TRIGGER IF EXISTS teaching_d20_grading_policy_appeal_direction ON public.teaching_grading_policies;
CREATE TRIGGER teaching_d20_grading_policy_appeal_direction BEFORE INSERT ON public.teaching_grading_policies FOR EACH ROW EXECUTE FUNCTION public.teaching_d20_guard_policy_appeal_direction();

DROP TRIGGER IF EXISTS teaching_d20_result_identity_guard ON public.teaching_assessment_results;
CREATE TRIGGER teaching_d20_result_identity_guard BEFORE UPDATE ON public.teaching_assessment_results FOR EACH ROW EXECUTE FUNCTION public.teaching_d20_guard_result_identity();
DROP TRIGGER IF EXISTS teaching_d20_appeal_identity_guard ON public.teaching_grade_appeals;
CREATE TRIGGER teaching_d20_appeal_identity_guard BEFORE UPDATE ON public.teaching_grade_appeals FOR EACH ROW EXECUTE FUNCTION public.teaching_d20_guard_appeal_identity();
DROP TRIGGER IF EXISTS teaching_d20_appeal_policy_gate ON public.teaching_grade_appeals;
CREATE TRIGGER teaching_d20_appeal_policy_gate BEFORE INSERT ON public.teaching_grade_appeals FOR EACH ROW EXECUTE FUNCTION public.teaching_d20_require_configured_appeal_direction();

DROP TRIGGER IF EXISTS teaching_d20_assessment_policy_gate ON public.teaching_assessments;
CREATE TRIGGER teaching_d20_assessment_policy_gate BEFORE INSERT OR UPDATE OF graded ON public.teaching_assessments FOR EACH ROW EXECUTE FUNCTION public.teaching_d20_require_locked_grading_policy();
DROP TRIGGER IF EXISTS teaching_d20_assignment_policy_gate ON public.teaching_assignments;
CREATE TRIGGER teaching_d20_assignment_policy_gate BEFORE INSERT OR UPDATE OF graded ON public.teaching_assignments FOR EACH ROW EXECUTE FUNCTION public.teaching_d20_require_locked_grading_policy();
DROP TRIGGER IF EXISTS teaching_d20_attempt_policy_gate ON public.teaching_assessment_attempts;
CREATE TRIGGER teaching_d20_attempt_policy_gate BEFORE INSERT ON public.teaching_assessment_attempts FOR EACH ROW EXECUTE FUNCTION public.teaching_d20_require_policy_before_attempt();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'teaching_marking_runs','teaching_marking_criterion_judgments','teaching_gradebook_entries',
    'teaching_topic_score_snapshots','teaching_course_result_snapshots','teaching_grade_change_audit'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS d20_append_only_%I ON public.%I',t,t);
    EXECUTE format('CREATE TRIGGER d20_append_only_%I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.teaching_d20_reject_append_only_mutation()',t,t);
  END LOOP;
END
$$;

COMMIT;
