-- Reckoning V2 Delivery A follow-up: cover the source-card foreign key.
-- Supabase's performance advisor flags foreign keys without a covering index.

CREATE INDEX IF NOT EXISTS idx_reckoning_evidence_source_card
  ON public.reckoning_evidence (source_card_id)
  WHERE source_card_id IS NOT NULL;
