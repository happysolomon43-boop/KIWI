-- KIWI AI Orchestrator Resilience Delivery B
-- Persistent provider/model circuit state and traffic-admission telemetry.
-- Stores operational metadata only; no prompts, user content, API keys, or model output.

CREATE TABLE IF NOT EXISTS ai_provider_model_health (
  model_id                  text PRIMARY KEY,
  state                     text NOT NULL DEFAULT 'CLOSED'
                            CHECK (state IN ('CLOSED','OPEN','HALF_OPEN')),
  open_until                timestamptz,
  failure_slots             jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error_code           text,
  last_http_status          integer,
  last_failure_at           timestamptz,
  last_success_at           timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_model_health_state
  ON ai_provider_model_health (state, open_until);

ALTER TABLE ai_requests
  ADD COLUMN IF NOT EXISTS queue_wait_ms integer NOT NULL DEFAULT 0;

ALTER TABLE ai_requests
  ADD COLUMN IF NOT EXISTS admission_limit integer;

ALTER TABLE ai_requests
  ADD COLUMN IF NOT EXISTS congestion_level text;

ALTER TABLE ai_provider_model_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ai_provider_model_health FROM anon, authenticated;
GRANT ALL ON TABLE ai_provider_model_health TO service_role;
