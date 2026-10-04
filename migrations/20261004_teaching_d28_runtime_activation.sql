BEGIN;
-- D28 runtime activation follow-forward: privacy-minimized post-administration
-- events are derived from D17/D20 owner truth. No raw response, protected
-- assessment content, student identity, or hidden reasoning is stored here.
CREATE TABLE IF NOT EXISTS teaching_runtime.d28_item_analytics_events(
 item_event_id text PRIMARY KEY,
 administration_key text NOT NULL,
 assessment_result_id text NOT NULL,
 assessment_result_version bigint NOT NULL CHECK(assessment_result_version>0),
 assessment_id text NOT NULL,
 assessment_package_id text NOT NULL,
 package_version integer NOT NULL CHECK(package_version>0),
 assessment_blueprint_id text NOT NULL,
 blueprint_version integer NOT NULL CHECK(blueprint_version>=0),
 package_item_id text NOT NULL,
 candidate_version_id text NOT NULL,
 item_hash text NOT NULL,
 slot_id text NOT NULL,
 response_family text NOT NULL,
 locked_option_order jsonb NOT NULL DEFAULT '[]'::jsonb,
 selected_option_id text,
 item_score numeric,
 item_max numeric,
 total_score_without_item numeric,
 package_score numeric,
 package_max numeric,
 omitted boolean NOT NULL DEFAULT false,
 administration_context jsonb NOT NULL DEFAULT '{}'::jsonb,
 method_version text NOT NULL,
 occurred_at timestamptz NOT NULL,
 idempotency_key text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS d28_item_analytics_events_candidate_idx ON teaching_runtime.d28_item_analytics_events(candidate_version_id,occurred_at);
CREATE INDEX IF NOT EXISTS d28_item_analytics_events_package_idx ON teaching_runtime.d28_item_analytics_events(assessment_package_id,package_item_id,occurred_at);
CREATE INDEX IF NOT EXISTS d28_item_analytics_events_admin_idx ON teaching_runtime.d28_item_analytics_events(administration_key,occurred_at);
ALTER TABLE teaching_runtime.d28_item_analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON teaching_runtime.d28_item_analytics_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON teaching_runtime.d28_item_analytics_events TO service_role;

CREATE OR REPLACE FUNCTION teaching_runtime.d28_capture_quality_alert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,teaching_runtime AS $$
DECLARE c text; ref text; reason text; correlation text;
BEGIN
 IF TG_TABLE_NAME='teaching_assessment_validations' AND NEW.outcome IN('FAIL','REPAIR','REVIEW_REQUIRED') THEN
  c:='ASSESSMENT_PACKAGE_VALIDATION_FAILURE';ref:=COALESCE(NEW.package_id,NEW.assessment_id);reason:='VALIDATION_'||NEW.outcome;
 ELSIF TG_TABLE_NAME='teaching_marking_runs' AND NEW.run_status IN('REVIEW_NEEDED','NOT_MARKABLE','REJECTED') THEN
  c:='ABNORMAL_MARKING_DISAGREEMENT';ref:=NEW.marking_run_id;reason:='MARKING_'||NEW.run_status;
 ELSE RETURN NEW;END IF;
 correlation:='db:'||TG_TABLE_NAME||':'||COALESCE(ref,'unknown');
 BEGIN
  INSERT INTO teaching_runtime.d28_operational_alerts(alert_id,alert_type,severity,correlation_id,source_ref,reason_code,status,details,created_at)
  VALUES(gen_random_uuid()::text,c,CASE WHEN c='ASSESSMENT_PACKAGE_VALIDATION_FAILURE' THEN 'CRITICAL' ELSE 'WARNING' END,correlation,ref,reason,'OPEN',jsonb_build_object('databaseObserved',true,'automaticAcademicMutation',false),now())
  ON CONFLICT(alert_type,correlation_id,reason_code) WHERE status='OPEN' DO NOTHING;
 EXCEPTION WHEN OTHERS THEN NULL;END;
 RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS d28_alert_validation_failure ON public.teaching_assessment_validations;
CREATE TRIGGER d28_alert_validation_failure AFTER INSERT OR UPDATE ON public.teaching_assessment_validations FOR EACH ROW EXECUTE FUNCTION teaching_runtime.d28_capture_quality_alert();
DROP TRIGGER IF EXISTS d28_alert_marking_disagreement ON public.teaching_marking_runs;
CREATE TRIGGER d28_alert_marking_disagreement AFTER INSERT OR UPDATE ON public.teaching_marking_runs FOR EACH ROW EXECUTE FUNCTION teaching_runtime.d28_capture_quality_alert();
COMMIT;
