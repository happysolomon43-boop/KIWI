BEGIN;

-- D28 runtime activation follow-forward hardening.
-- Integration received the activation migration before this replay/dedupe
-- improvement was identified. Production may apply both migrations safely.

CREATE OR REPLACE FUNCTION teaching_runtime.d28_capture_quality_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,teaching_runtime
AS $$
DECLARE
  c text;
  ref text;
  reason text;
  correlation text;
BEGIN
  IF TG_TABLE_NAME='teaching_assessment_validations' AND NEW.outcome IN('FAIL','REPAIR','REVIEW_REQUIRED') THEN
    c:='ASSESSMENT_PACKAGE_VALIDATION_FAILURE';
    ref:=COALESCE(NEW.package_id,NEW.assessment_id);
    reason:='VALIDATION_'||NEW.outcome;
  ELSIF TG_TABLE_NAME='teaching_marking_runs' AND NEW.run_status IN('REVIEW_NEEDED','NOT_MARKABLE','REJECTED') THEN
    c:='ABNORMAL_MARKING_DISAGREEMENT';
    ref:=NEW.marking_run_id;
    reason:='MARKING_'||NEW.run_status;
  ELSE
    RETURN NEW;
  END IF;

  correlation:='db:'||TG_TABLE_NAME||':'||COALESCE(ref,'unknown');
  BEGIN
    INSERT INTO teaching_runtime.d28_operational_alerts(
      alert_id,alert_type,severity,correlation_id,source_ref,reason_code,status,details,created_at
    ) VALUES(
      gen_random_uuid()::text,
      c,
      CASE WHEN c='ASSESSMENT_PACKAGE_VALIDATION_FAILURE' THEN 'CRITICAL' ELSE 'WARNING' END,
      correlation,
      ref,
      reason,
      'OPEN',
      jsonb_build_object('databaseObserved',true,'automaticAcademicMutation',false),
      now()
    )
    ON CONFLICT(alert_type,correlation_id,reason_code) WHERE status='OPEN' DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END
$$;

-- SECURITY DEFINER functions are trigger internals, not callable application APIs.
-- Revoke PostgreSQL's default PUBLIC EXECUTE grant even though teaching_runtime
-- is already hidden from browser roles; keep service_role explicit for backend use.
REVOKE EXECUTE ON FUNCTION teaching_runtime.d28_capture_minimized_mutation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION teaching_runtime.d28_capture_quality_alert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION teaching_runtime.d28_capture_minimized_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION teaching_runtime.d28_capture_quality_alert() TO service_role;

-- Complete the TCH-0608 privileged-mutation dashboard feed without taking
-- ownership of those domains. These are observation-only AFTER triggers and
-- the D28 observer swallows telemetry failures so authoritative transactions
-- remain owned by their source services.
DROP TRIGGER IF EXISTS d28_observe_course_activation ON public.teaching_course_activations;
CREATE TRIGGER d28_observe_course_activation
AFTER INSERT ON public.teaching_course_activations
FOR EACH ROW EXECUTE FUNCTION teaching_runtime.d28_capture_minimized_mutation(
  'PRIVILEGED_MUTATION','course_activation_committed','activation_id','course_state_version'
);

DROP TRIGGER IF EXISTS d28_observe_request_history ON public.teaching_request_history;
CREATE TRIGGER d28_observe_request_history
AFTER INSERT ON public.teaching_request_history
FOR EACH ROW EXECUTE FUNCTION teaching_runtime.d28_capture_minimized_mutation(
  'PRIVILEGED_MUTATION','request_lifecycle_transition','request_id','request_version'
);

DROP TRIGGER IF EXISTS d28_observe_progression_snapshot ON public.teaching_course_result_snapshots;
CREATE TRIGGER d28_observe_progression_snapshot
AFTER INSERT ON public.teaching_course_result_snapshots
FOR EACH ROW EXECUTE FUNCTION teaching_runtime.d28_capture_minimized_mutation(
  'PRIVILEGED_MUTATION','progression_result_snapshot_committed','course_result_snapshot_id','version_no'
);

DROP TRIGGER IF EXISTS d28_observe_grading_policy ON public.teaching_grading_policies;
CREATE TRIGGER d28_observe_grading_policy
AFTER INSERT OR UPDATE ON public.teaching_grading_policies
FOR EACH ROW EXECUTE FUNCTION teaching_runtime.d28_capture_minimized_mutation(
  'PRIVILEGED_MUTATION','grading_policy_version_change','grading_policy_id','version_no'
);

DROP TRIGGER IF EXISTS d28_observe_attendance_version ON public.teaching_attendance_records;
CREATE TRIGGER d28_observe_attendance_version
AFTER INSERT ON public.teaching_attendance_records
FOR EACH ROW EXECUTE FUNCTION teaching_runtime.d28_capture_minimized_mutation(
  'PRIVILEGED_MUTATION','attendance_record_version_committed','attendance_record_id','version_no'
);

COMMIT;
