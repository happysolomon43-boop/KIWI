-- KIWI AI Orchestrator Phase 3
-- Persistent model/project health, request telemetry, and daily operational rollups.
-- No API keys, prompts, study notes, questions, or model response text are stored.

CREATE TABLE IF NOT EXISTS ai_model_catalog (
  model_id              text PRIMARY KEY,
  family                text NOT NULL,
  channel               text NOT NULL,
  status                text NOT NULL,
  rank                   integer NOT NULL DEFAULT 0,
  supported_thinking     jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities           jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_token_limit      bigint,
  output_token_limit     bigint,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at           timestamptz NOT NULL DEFAULT now(),
  approved_at            timestamptz,
  suspended_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_project_model_state (
  project_slot           text NOT NULL,
  model_id               text NOT NULL,
  state                  text NOT NULL DEFAULT 'READY'
                         CHECK (state IN (
                           'READY',
                           'COOLDOWN_RPM',
                           'COOLDOWN_TPM',
                           'EXHAUSTED_RPD',
                           'MODEL_UNAVAILABLE',
                           'KEY_INVALID',
                           'DISABLED'
                         )),
  quota_day              date,
  attempts_today         integer NOT NULL DEFAULT 0,
  successes_today        integer NOT NULL DEFAULT 0,
  observed_quota_limit   bigint,
  cooldown_until         timestamptz,
  last_error_code        text,
  last_http_status       integer,
  last_success_at        timestamptz,
  last_failure_at        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_slot, model_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_project_model_state_model
  ON ai_project_model_state (model_id, state);

CREATE INDEX IF NOT EXISTS idx_ai_project_model_state_cooldown
  ON ai_project_model_state (cooldown_until)
  WHERE cooldown_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_requests (
  id                     uuid PRIMARY KEY,
  task_id                text NOT NULL,
  class                  text NOT NULL,
  mode                   text NOT NULL CHECK (mode IN ('SHADOW', 'LIVE')),
  requested_reasoning    text,
  planned_models         jsonb NOT NULL DEFAULT '[]'::jsonb,
  planned_primary_model  text,
  legacy_model           text,
  selected_model         text,
  selected_project_slot  text,
  outcome                text NOT NULL DEFAULT 'PENDING'
                         CHECK (outcome IN ('PENDING', 'SUCCESS', 'FAILED', 'BLOCKED', 'SHADOW_ONLY')),
  fallback_depth         integer NOT NULL DEFAULT 0,
  attempt_count          integer NOT NULL DEFAULT 0,
  latency_ms             integer,
  input_tokens           integer NOT NULL DEFAULT 0,
  output_tokens          integer NOT NULL DEFAULT 0,
  thought_tokens         integer NOT NULL DEFAULT 0,
  total_tokens           integer NOT NULL DEFAULT 0,
  finish_reason          text,
  error_code             text,
  generation_group_id    text,
  started_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_requests_task_started
  ON ai_requests (task_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_requests_mode_started
  ON ai_requests (mode, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_attempts (
  id                     bigserial PRIMARY KEY,
  request_id             uuid NOT NULL REFERENCES ai_requests(id) ON DELETE CASCADE,
  attempt_number         integer NOT NULL,
  model_id               text,
  project_slot           text,
  outcome                text NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILED', 'BLOCKED', 'SHADOW_PLAN')),
  error_code             text,
  http_status            integer,
  finish_reason          text,
  latency_ms             integer,
  input_tokens           integer NOT NULL DEFAULT 0,
  output_tokens          integer NOT NULL DEFAULT 0,
  thought_tokens         integer NOT NULL DEFAULT 0,
  total_tokens           integer NOT NULL DEFAULT 0,
  started_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_attempts_request
  ON ai_attempts (request_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_ai_attempts_model_created
  ON ai_attempts (model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_daily_rollups (
  quota_day              date NOT NULL,
  task_id                text NOT NULL,
  class                  text NOT NULL,
  mode                   text NOT NULL CHECK (mode IN ('SHADOW', 'LIVE')),
  request_count          integer NOT NULL DEFAULT 0,
  success_count          integer NOT NULL DEFAULT 0,
  failure_count          integer NOT NULL DEFAULT 0,
  blocked_count          integer NOT NULL DEFAULT 0,
  fallback_count         integer NOT NULL DEFAULT 0,
  total_latency_ms       bigint NOT NULL DEFAULT 0,
  input_tokens           bigint NOT NULL DEFAULT 0,
  output_tokens          bigint NOT NULL DEFAULT 0,
  thought_tokens         bigint NOT NULL DEFAULT 0,
  total_tokens           bigint NOT NULL DEFAULT 0,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quota_day, task_id, mode)
);

-- These tables are operational backend state. They must not be directly readable
-- or writable through anon/authenticated Supabase client roles.
ALTER TABLE ai_model_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_project_model_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_daily_rollups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE ai_model_catalog FROM anon, authenticated;
REVOKE ALL ON TABLE ai_project_model_state FROM anon, authenticated;
REVOKE ALL ON TABLE ai_requests FROM anon, authenticated;
REVOKE ALL ON TABLE ai_attempts FROM anon, authenticated;
REVOKE ALL ON TABLE ai_daily_rollups FROM anon, authenticated;
REVOKE ALL ON SEQUENCE ai_attempts_id_seq FROM anon, authenticated;

GRANT ALL ON TABLE ai_model_catalog TO service_role;
GRANT ALL ON TABLE ai_project_model_state TO service_role;
GRANT ALL ON TABLE ai_requests TO service_role;
GRANT ALL ON TABLE ai_attempts TO service_role;
GRANT ALL ON TABLE ai_daily_rollups TO service_role;
GRANT USAGE, SELECT ON SEQUENCE ai_attempts_id_seq TO service_role;
