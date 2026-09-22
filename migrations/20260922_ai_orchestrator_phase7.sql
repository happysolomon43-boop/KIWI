-- KIWI AI Orchestrator Phase 7
-- Audit trail for automatic model discovery/qualification/promotion.
-- Contains only provider/model metadata and probe outcomes; no user content.

CREATE TABLE IF NOT EXISTS ai_model_qualifications (
  id                    bigserial PRIMARY KEY,
  model_id              text NOT NULL,
  status                text NOT NULL CHECK (status IN ('STARTED','PASSED','FAILED','INCONCLUSIVE')),
  project_slot          text,
  qualification_version integer NOT NULL DEFAULT 1,
  supported_thinking    jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities          jsonb NOT NULL DEFAULT '[]'::jsonb,
  probe_count           integer NOT NULL DEFAULT 0,
  error_code            text,
  reason                text,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_model_qualifications_model_created
  ON ai_model_qualifications (model_id, created_at DESC);

ALTER TABLE ai_model_qualifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ai_model_qualifications FROM anon, authenticated;
REVOKE ALL ON SEQUENCE ai_model_qualifications_id_seq FROM anon, authenticated;
GRANT ALL ON TABLE ai_model_qualifications TO service_role;
GRANT USAGE, SELECT ON SEQUENCE ai_model_qualifications_id_seq TO service_role;