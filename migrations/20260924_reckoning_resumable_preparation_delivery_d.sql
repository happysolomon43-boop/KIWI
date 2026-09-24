-- KIWI Reckoning Delivery D: resumable preparation and durable partial progress.
-- Backend-only preparation artifacts. A failed provider call must not discard
-- already validated Reckoning questions.

CREATE TABLE IF NOT EXISTS public.reckoning_preparation_manifests (
  reckoning_id               text PRIMARY KEY
                             REFERENCES public.reckoning_sessions(id) ON DELETE CASCADE,
  user_id                    text NOT NULL,
  preparation_version        integer NOT NULL,
  config_version             integer NOT NULL,
  generation_group_id        text NOT NULL,
  plan                       jsonb NOT NULL,
  blueprints                 jsonb NOT NULL,
  family_order               jsonb NOT NULL DEFAULT '[]'::jsonb,
  deck_ids                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_count                integer NOT NULL,
  ready_count                integer NOT NULL DEFAULT 0,
  status                     text NOT NULL DEFAULT 'BUILDING'
                             CHECK (status IN ('BUILDING','PARTIAL','READY')),
  last_error                 text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  completed_at               timestamptz,

  CONSTRAINT reckoning_preparation_manifest_counts_ck
    CHECK (
      preparation_version > 0
      AND config_version > 0
      AND total_count > 0
      AND ready_count >= 0
      AND ready_count <= total_count
    )
);

CREATE TABLE IF NOT EXISTS public.reckoning_preparation_items (
  id                         text PRIMARY KEY,
  reckoning_id               text NOT NULL
                             REFERENCES public.reckoning_preparation_manifests(reckoning_id)
                             ON DELETE CASCADE,
  user_id                    text NOT NULL,
  blueprint_id               text NOT NULL,
  evidence_id                text NOT NULL,
  family_index               integer NOT NULL,
  item_index                 integer NOT NULL,
  status                     text NOT NULL DEFAULT 'PENDING'
                             CHECK (status IN ('PENDING','READY','ERROR')),
  generated_question         jsonb,
  attempt_count              integer NOT NULL DEFAULT 0,
  validation_issues          jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error                 text,
  ready_at                   timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reckoning_preparation_item_counts_ck
    CHECK (
      family_index >= 0
      AND item_index >= 0
      AND attempt_count >= 0
    ),
  CONSTRAINT reckoning_preparation_item_payload_ck
    CHECK (
      (status = 'READY' AND generated_question IS NOT NULL AND ready_at IS NOT NULL)
      OR status <> 'READY'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reckoning_preparation_blueprint
  ON public.reckoning_preparation_items (reckoning_id, blueprint_id);

CREATE INDEX IF NOT EXISTS idx_reckoning_preparation_items_status
  ON public.reckoning_preparation_items (reckoning_id, status, family_index, item_index);

ALTER TABLE public.reckoning_preparation_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reckoning_preparation_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.reckoning_preparation_manifests FROM anon, authenticated;
REVOKE ALL ON TABLE public.reckoning_preparation_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reckoning_preparation_manifests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reckoning_preparation_items TO service_role;

COMMENT ON TABLE public.reckoning_preparation_manifests IS
  'Backend-only immutable Reckoning preparation plan used to resume a partially generated bank.';
COMMENT ON TABLE public.reckoning_preparation_items IS
  'Backend-only per-blueprint preparation progress. READY rows survive transient generation failures until activation.';
