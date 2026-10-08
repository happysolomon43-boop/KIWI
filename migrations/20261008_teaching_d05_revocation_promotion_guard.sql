-- Idempotent D05 hotfix for early integration installs. Promoting an
-- unapproved plan, blueprint or timetable must not poison its new authority.
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
      AND NOT (before_value->>'plan_state' IN ('APPROVED','VALIDATED')
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
