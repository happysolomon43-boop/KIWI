-- KIWI Teaching D05 — Teaching Orchestrator & Durable Event Runtime Integration
-- Operational orchestration/audit + transactional event publication only.
-- D05 does not move academic truth out of its existing domain owners.

BEGIN;

CREATE TABLE teaching_runtime.orchestration_executions (
  execution_id text PRIMARY KEY,
  idempotency_key text,
  trigger_type text NOT NULL,
  trigger_ref text NOT NULL,
  trigger_authority_category text NOT NULL CHECK (
    trigger_authority_category IN (
      'authenticated_command','committed_domain_event','scheduled_due_event',
      'intelligence_work_result','operational_recovery_event'
    )
  ),
  correlation_id text NOT NULL,
  causation_id text,
  capability_id text NOT NULL,
  execution_class text NOT NULL CHECK (
    execution_class IN ('DETERMINISTIC','DIRECT-AI','HYBRID','EVENT-AI-HOOK','BACKGROUND')
  ),
  authority_level text NOT NULL CHECK (authority_level IN ('T0','T1','T2','T3','T4')),
  authoritative_owner_boundary text NOT NULL,
  prompt_family_id text,
  prompt_family_version text,
  prompt_contract_version text,
  aggregate_type text,
  aggregate_id text,
  state_version_ref text,
  precondition_token text,
  preconditions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preconditions)='object'),
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  output_schema_id text NOT NULL,
  output_schema_version text NOT NULL,
  validator_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validator_ids)='array'),
  deadline_at timestamptz,
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN (
      'PENDING','PREFLIGHT_PASSED','MODEL_PENDING','COMMIT_PENDING',
      'COMPLETED','NOOP','STALE_REJECTED','FAILED','CANCELLED'
    )
  ),
  validation_outcome text,
  stale_reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(stale_reasons)='array'),
  failure_code text,
  committed_mutation_ref text,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_metadata)='object'),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX teaching_orchestration_idempotency_idx
  ON teaching_runtime.orchestration_executions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX teaching_orchestration_correlation_idx
  ON teaching_runtime.orchestration_executions(correlation_id, created_at DESC);
CREATE INDEX teaching_orchestration_aggregate_idx
  ON teaching_runtime.orchestration_executions(aggregate_type, aggregate_id, state_version_ref);

CREATE TABLE teaching_runtime.event_outbox (
  event_id text PRIMARY KEY,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version>=1),
  event_type text NOT NULL,
  event_category text NOT NULL CHECK (
    event_category IN ('authenticated_command','committed_domain_event','intelligence_work_result','operational_recovery_event')
  ),
  trigger_type text NOT NULL,
  source text NOT NULL,
  origin text NOT NULL,
  actor_id text,
  aggregate_type text,
  aggregate_id text,
  aggregate_version bigint CHECK (aggregate_version IS NULL OR aggregate_version>=0),
  occurred_at timestamptz NOT NULL,
  effective_at timestamptz,
  correlation_id text,
  causation_id text,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
  audit_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(audit_refs)='array'),
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CLAIMED','RETRY_WAIT','PUBLISHED','CANCELLED')),
  claim_token text,
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status <> 'CLAIMED' OR (
      claim_token IS NOT NULL AND claimed_by IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL
    )
  )
);

CREATE INDEX teaching_event_outbox_delivery_idx
  ON teaching_runtime.event_outbox(status,next_attempt_at,created_at);
CREATE INDEX teaching_event_outbox_aggregate_idx
  ON teaching_runtime.event_outbox(aggregate_type,aggregate_id,aggregate_version);
CREATE INDEX teaching_event_outbox_correlation_idx
  ON teaching_runtime.event_outbox(correlation_id)
  WHERE correlation_id IS NOT NULL;

ALTER TABLE teaching_runtime.orchestration_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_runtime.event_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE teaching_runtime.orchestration_executions FROM PUBLIC,anon,authenticated,teaching_domain_service,teaching_protected_service;
REVOKE ALL ON TABLE teaching_runtime.event_outbox FROM PUBLIC,anon,authenticated,teaching_domain_service,teaching_protected_service;

GRANT SELECT,INSERT,UPDATE ON TABLE teaching_runtime.orchestration_executions TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE teaching_runtime.event_outbox TO service_role;
REVOKE DELETE,TRUNCATE ON TABLE teaching_runtime.orchestration_executions FROM service_role;
REVOKE DELETE,TRUNCATE ON TABLE teaching_runtime.event_outbox FROM service_role;

-- A domain owner that deliberately SET ROLEs into the D04 narrow domain role may
-- transactionally publish the resulting committed-domain event without gaining
-- outbox-worker mutation privileges.
GRANT USAGE ON SCHEMA teaching_runtime TO teaching_domain_service;
GRANT SELECT,INSERT ON TABLE teaching_runtime.event_outbox TO teaching_domain_service;
GRANT SELECT,INSERT ON TABLE teaching_runtime.due_events TO teaching_domain_service;
REVOKE UPDATE,DELETE,TRUNCATE ON TABLE teaching_runtime.event_outbox FROM teaching_domain_service;
REVOKE UPDATE,DELETE,TRUNCATE ON TABLE teaching_runtime.due_events FROM teaching_domain_service;

CREATE POLICY teaching_event_outbox_domain_service_select
  ON teaching_runtime.event_outbox FOR SELECT TO teaching_domain_service USING (true);
CREATE POLICY teaching_event_outbox_domain_service_insert
  ON teaching_runtime.event_outbox FOR INSERT TO teaching_domain_service WITH CHECK (true);
CREATE POLICY teaching_due_events_domain_service_select
  ON teaching_runtime.due_events FOR SELECT TO teaching_domain_service USING (true);
CREATE POLICY teaching_due_events_domain_service_insert
  ON teaching_runtime.due_events FOR INSERT TO teaching_domain_service WITH CHECK (true);

COMMIT;

-- Recovery: stop D05 orchestration/outbox workers; preserve academic truth in
-- D04/domain tables; drop only teaching_runtime.orchestration_executions and
-- teaching_runtime.event_outbox plus the four teaching_domain_service policies/
-- grants added here. Never recover by granting browser writes or bypassing RLS.
