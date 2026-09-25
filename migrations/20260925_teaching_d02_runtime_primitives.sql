-- KIWI Teaching D02 — Authoritative Runtime, Event & Validation Primitives
-- Operational/runtime persistence only. D04 owns Teaching academic-domain persistence.
-- Forward-only additive migration. Recovery procedure: stop the Teaching runtime worker
-- before dropping these objects; no academic truth is stored in this schema.

BEGIN;

CREATE SCHEMA IF NOT EXISTS teaching_runtime;

REVOKE ALL ON SCHEMA teaching_runtime FROM PUBLIC;
REVOKE ALL ON SCHEMA teaching_runtime FROM anon;
REVOKE ALL ON SCHEMA teaching_runtime FROM authenticated;
GRANT USAGE ON SCHEMA teaching_runtime TO service_role;

CREATE TABLE IF NOT EXISTS teaching_runtime.due_events (
  event_id text PRIMARY KEY,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  event_type text NOT NULL,
  event_category text NOT NULL CHECK (
    event_category IN (
      'authenticated_command',
      'committed_domain_event',
      'scheduled_due_event',
      'intelligence_work_result',
      'operational_recovery_event'
    )
  ),
  trigger_type text NOT NULL,
  source text NOT NULL,
  origin text NOT NULL,
  actor_id text,
  aggregate_type text,
  aggregate_id text,
  aggregate_version bigint CHECK (aggregate_version IS NULL OR aggregate_version >= 0),
  occurred_at timestamptz NOT NULL,
  effective_at timestamptz,
  due_at timestamptz NOT NULL,
  correlation_id text,
  causation_id text,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN (
      'PENDING',
      'CLAIMED',
      'RETRY_WAIT',
      'COMPLETED',
      'NOOP',
      'SUPERSEDED',
      'FAIRNESS_RECOVERY_REQUIRED',
      'CANCELLED'
    )
  ),
  resolution text CHECK (
    resolution IS NULL OR resolution IN (
      'ACTIONABLE',
      'ALREADY_SATISFIED',
      'SUPERSEDED',
      'FAIRNESS_RECOVERY_REQUIRED'
    )
  ),
  claim_token text,
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error_code text,
  last_error_message text,
  recovery_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status <> 'CLAIMED'
    OR (
      claim_token IS NOT NULL
      AND claimed_by IS NOT NULL
      AND claimed_at IS NOT NULL
      AND claim_expires_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS teaching_due_events_due_idx
  ON teaching_runtime.due_events (status, next_attempt_at, due_at);

CREATE INDEX IF NOT EXISTS teaching_due_events_aggregate_idx
  ON teaching_runtime.due_events (aggregate_type, aggregate_id, aggregate_version);

CREATE INDEX IF NOT EXISTS teaching_due_events_correlation_idx
  ON teaching_runtime.due_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS teaching_runtime.event_attempts (
  attempt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL REFERENCES teaching_runtime.due_events(event_id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  worker_id text,
  claim_token text,
  outcome text CHECK (
    outcome IS NULL OR outcome IN (
      'ACTIONED',
      'ACTIONABLE',
      'ALREADY_SATISFIED',
      'SUPERSEDED',
      'FAIRNESS_RECOVERY_REQUIRED',
      'FAIRNESS_RECOVERY',
      'RETRY',
      'ERROR'
    )
  ),
  error_code text,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS teaching_event_attempts_event_idx
  ON teaching_runtime.event_attempts (event_id, attempt_number);

CREATE TABLE IF NOT EXISTS teaching_runtime.ai_execution_audit (
  execution_id text PRIMARY KEY,
  correlation_id text,
  causation_id text,
  responsibility_key text NOT NULL,
  intelligence_class text NOT NULL CHECK (
    intelligence_class IN ('DETERMINISTIC', 'DIRECT-AI', 'HYBRID', 'EVENT-AI-HOOK', 'BACKGROUND')
  ),
  authority_level text NOT NULL CHECK (authority_level IN ('T0','T1','T2','T3','T4')),
  central_task_id text NOT NULL,
  prompt_template_version text,
  output_schema_version text,
  model_identifier text,
  authoritative_owner text,
  validation_outcome text NOT NULL DEFAULT 'PENDING' CHECK (
    validation_outcome IN ('PENDING','ACCEPTED','REJECTED','FAILED','SAFE_FALLBACK')
  ),
  rejection_reason text,
  committed_mutation_type text,
  committed_mutation_ref text,
  safe_failure_code text,
  outcome text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teaching_ai_execution_correlation_idx
  ON teaching_runtime.ai_execution_audit (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS teaching_ai_execution_created_idx
  ON teaching_runtime.ai_execution_audit (created_at DESC);

-- Private operational schema: not exposed to browser roles. RLS is enabled as
-- defense in depth; backend direct PostgreSQL ownership and service_role remain
-- the only intended runtime access paths.
ALTER TABLE teaching_runtime.due_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_runtime.event_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_runtime.ai_execution_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA teaching_runtime FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA teaching_runtime FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA teaching_runtime TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA teaching_runtime TO service_role;

COMMIT;

-- Recovery / rollback (manual, only after stopping the Teaching D02 worker):
-- DROP SCHEMA teaching_runtime CASCADE;
