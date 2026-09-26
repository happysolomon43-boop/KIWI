-- KIWI Teaching D05 hardening — explicit service-role RLS policy coverage
-- The Supabase service_role currently bypasses RLS, but D05 records explicit
-- SELECT/INSERT/UPDATE policies for orchestration_executions so the private
-- runtime table is not dependent on an implicit no-policy posture.

BEGIN;

DROP POLICY IF EXISTS teaching_orchestration_service_select
  ON teaching_runtime.orchestration_executions;
CREATE POLICY teaching_orchestration_service_select
  ON teaching_runtime.orchestration_executions
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS teaching_orchestration_service_insert
  ON teaching_runtime.orchestration_executions;
CREATE POLICY teaching_orchestration_service_insert
  ON teaching_runtime.orchestration_executions
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS teaching_orchestration_service_update
  ON teaching_runtime.orchestration_executions;
CREATE POLICY teaching_orchestration_service_update
  ON teaching_runtime.orchestration_executions
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

REVOKE DELETE, TRUNCATE ON TABLE teaching_runtime.orchestration_executions FROM service_role;

COMMIT;

-- Recovery: drop only the three teaching_orchestration_service_* policies.
-- Do not disable RLS or grant browser access.
