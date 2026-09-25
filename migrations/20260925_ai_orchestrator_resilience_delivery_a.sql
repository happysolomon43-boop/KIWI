-- KIWI AI Orchestrator Resilience Delivery A
-- Adds authoritative quota diagnostics and route-runtime coordination state.
-- Operational metadata only: no API keys, prompts, student content, or model output.

ALTER TABLE ai_project_model_state
  ADD COLUMN IF NOT EXISTS observed_quota_dimension text;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS provider_error_code text;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS provider_status text;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS quota_dimension text;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS quota_metric text;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS quota_limit_name text;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS quota_limit_value bigint;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS retry_after_ms integer;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS classification_source text;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS route_state_before text;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS route_state_after text;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS operation_id text;

ALTER TABLE ai_attempts
  ADD COLUMN IF NOT EXISTS operation_attempt_number integer;

CREATE INDEX IF NOT EXISTS idx_ai_attempts_quota_dimension_created
  ON ai_attempts (quota_dimension, created_at DESC)
  WHERE quota_dimension IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_attempts_operation
  ON ai_attempts (operation_id, created_at DESC)
  WHERE operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_route_runtime (
  project_slot             text NOT NULL,
  model_id                 text NOT NULL,
  in_flight                integer NOT NULL DEFAULT 0 CHECK (in_flight >= 0),
  lease_expires_at         timestamptz,
  next_eligible_at         timestamptz,
  short_rate_limit_streak  integer NOT NULL DEFAULT 0 CHECK (short_rate_limit_streak >= 0),
  last_selected_at         timestamptz,
  last_success_at          timestamptz,
  last_failure_at          timestamptz,
  last_error_code          text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_slot, model_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_route_runtime_ready
  ON ai_route_runtime (model_id, next_eligible_at, in_flight);

ALTER TABLE ai_route_runtime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ai_route_runtime FROM anon, authenticated;
GRANT ALL ON TABLE ai_route_runtime TO service_role;

CREATE TABLE IF NOT EXISTS ai_operation_budget (
  operation_id                 text PRIMARY KEY,
  task_class                   text NOT NULL,
  provider_attempts            integer NOT NULL DEFAULT 0 CHECK (provider_attempts >= 0),
  successes                    integer NOT NULL DEFAULT 0 CHECK (successes >= 0),
  availability_failures        integer NOT NULL DEFAULT 0 CHECK (availability_failures >= 0),
  short_rate_limit_failures    integer NOT NULL DEFAULT 0 CHECK (short_rate_limit_failures >= 0),
  provider_overload_failures   integer NOT NULL DEFAULT 0 CHECK (provider_overload_failures >= 0),
  expires_at                   timestamptz NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_operation_budget_expiry
  ON ai_operation_budget (expires_at);

ALTER TABLE ai_operation_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ai_operation_budget FROM anon, authenticated;
GRANT ALL ON TABLE ai_operation_budget TO service_role;
