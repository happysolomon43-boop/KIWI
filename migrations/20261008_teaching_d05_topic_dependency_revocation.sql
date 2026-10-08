-- #305: align revocation detection with D08's real REVIEW_READY Course Plan
-- state and propagate post-publication Topic / Learning Unit edits through
-- their authoritative versioned Course Plan. New plan graph INSERTs intentionally
-- do not revoke: D08 creates the REVIEW_READY Plan before its children.
CREATE OR REPLACE FUNCTION teaching_runtime.record_parent_authority_revocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE
  before_value jsonb := to_jsonb(OLD);
  after_value jsonb := to_jsonb(NEW);
  owner text;
  ref text;
  version text;
  reason text := 'PARENT_AUTHORITY_CHANGED';
  previous_state text;
  next_state text;
BEGIN
  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='teaching_courses' THEN
    owner:='COURSE';ref:=before_value->>'course_id';version:=before_value->>'state_version';
    previous_state:=before_value->>'lifecycle_state';next_state:=after_value->>'lifecycle_state';
    IF previous_state IS NOT DISTINCT FROM next_state AND before_value->>'state_version' IS NOT DISTINCT FROM after_value->>'state_version'
      THEN RETURN NEW;END IF;
    reason:='COURSE_AUTHORITY_CHANGED';
  ELSIF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='teaching_classes' THEN
    owner:='CLASS';ref:=before_value->>'class_id';version:=before_value->>'schedule_version';
    IF before_value->>'lifecycle_state' IS NOT DISTINCT FROM after_value->>'lifecycle_state'
      AND before_value->>'schedule_version' IS NOT DISTINCT FROM after_value->>'schedule_version'
      AND before_value->>'source_timetable_version_id' IS NOT DISTINCT FROM after_value->>'source_timetable_version_id'
      AND before_value->>'scheduled_start_at' IS NOT DISTINCT FROM after_value->>'scheduled_start_at'
      AND before_value->>'scheduled_end_at' IS NOT DISTINCT FROM after_value->>'scheduled_end_at'
      THEN RETURN NEW; END IF;
    reason:='CLASS_SCHEDULE_OR_LIFECYCLE_CHANGED';
  ELSIF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='teaching_course_plans' THEN
    owner:='COURSE_PLAN';ref:=before_value->>'course_plan_id';version:=before_value->>'version_no';
    IF before_value->>'version_no' IS NOT DISTINCT FROM after_value->>'version_no'
      AND NOT (before_value->>'plan_state' IN ('REVIEW_READY','APPROVED','VALIDATED')
        AND after_value->>'plan_state' IN ('SUPERSEDED','STALE','REVIEW_REQUIRED'))
      THEN RETURN NEW;END IF;
    reason:='COURSE_PLAN_SUPERSEDED';
  ELSIF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='teaching_lesson_blueprints' THEN
    owner:='LESSON_BLUEPRINT';ref:=before_value->>'lesson_blueprint_id';version:=before_value->>'version_no';
    IF before_value->>'version_no' IS NOT DISTINCT FROM after_value->>'version_no'
      AND NOT (before_value->>'blueprint_state'='VALIDATED'
        AND after_value->>'blueprint_state' IN ('SUPERSEDED','CANCELLED','INVALIDATED','REVIEW_REQUIRED'))
      THEN RETURN NEW;END IF;
    reason:='LESSON_BLUEPRINT_SUPERSEDED';
  ELSIF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='teaching_timetable_versions' THEN
    owner:='TIMETABLE';ref:=before_value->>'timetable_version_id';version:=before_value->>'version_no';
    IF before_value->>'timetable_state' IS DISTINCT FROM 'APPROVED'
      OR after_value->>'timetable_state' IS NOT DISTINCT FROM 'APPROVED'
      THEN RETURN NEW;END IF;
    reason:='TIMETABLE_STATE_CHANGED';
  ELSIF TG_TABLE_SCHEMA='teaching_preparation' AND TG_TABLE_NAME='workspaces' THEN
    owner:='PREPARATION_WORKSPACE';ref:=before_value->>'workspace_id';version:=before_value->>'state_version';
    IF before_value->>'state_version' IS NOT DISTINCT FROM after_value->>'state_version'
      AND before_value->>'lifecycle_state' IS NOT DISTINCT FROM after_value->>'lifecycle_state'
      THEN RETURN NEW;END IF;
    reason:='PREPARATION_WORKSPACE_SUPERSEDED';
  ELSE
    RAISE EXCEPTION 'Unrecognized authority revocation trigger on %.%',TG_TABLE_SCHEMA,TG_TABLE_NAME;
  END IF;
  IF before_value->>'student_id' IS NULL OR ref IS NULL OR version IS NULL THEN
    RAISE EXCEPTION 'Academic revocation lacks immutable owner identity/version on %.%',TG_TABLE_SCHEMA,TG_TABLE_NAME;
  END IF;
  INSERT INTO teaching_runtime.academic_authority_revocations
    (student_id,owner_kind,owner_ref,authority_version,reason_code)
  VALUES (before_value->>'student_id',owner,ref,version,reason)
  ON CONFLICT (student_id,owner_kind,owner_ref,authority_version) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION teaching_runtime.record_plan_graph_child_revocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE
  child_row jsonb;
  parent_ref text;
  owner_student text;
  parent_state text;
  parent_version text;
  cause text;
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN RETURN NEW; END IF;

  child_row := to_jsonb(OLD);
  SELECT p.student_id,p.course_plan_id,p.version_no::text,p.plan_state
    INTO owner_student,parent_ref,parent_version,parent_state
    FROM public.teaching_course_plans p
    WHERE p.student_id=child_row->>'student_id' AND p.course_plan_id=child_row->>'course_plan_id';

  -- Draft / invalidated Plans already have no published authority. For the
  -- authoritative Plan, *any* direct child edit invalidates the old version
  -- until the owning D08 path issues a new Course Plan.
  IF parent_state='REVIEW_READY' THEN
    cause := CASE WHEN TG_TABLE_NAME='teaching_topics' THEN 'TOPIC_GRAPH_CHANGED'
                  ELSE 'LEARNING_UNIT_GRAPH_CHANGED' END;
    INSERT INTO teaching_runtime.academic_authority_revocations
      (student_id,owner_kind,owner_ref,authority_version,reason_code)
    VALUES (owner_student,'COURSE_PLAN',parent_ref,parent_version,cause)
    ON CONFLICT (student_id,owner_kind,owner_ref,authority_version) DO NOTHING;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS kiwi_revoke_topic_plan_authority ON public.teaching_topics;
CREATE TRIGGER kiwi_revoke_topic_plan_authority AFTER UPDATE OR DELETE ON public.teaching_topics
FOR EACH ROW EXECUTE FUNCTION teaching_runtime.record_plan_graph_child_revocation();

DROP TRIGGER IF EXISTS kiwi_revoke_learning_unit_plan_authority ON public.teaching_learning_units;
CREATE TRIGGER kiwi_revoke_learning_unit_plan_authority AFTER UPDATE OR DELETE ON public.teaching_learning_units
FOR EACH ROW EXECUTE FUNCTION teaching_runtime.record_plan_graph_child_revocation();
