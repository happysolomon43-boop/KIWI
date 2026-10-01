-- KIWI provider-neutral model catalog schema convergence.
-- Inference families remain populated for family-routed text models.
-- Capability-only models (speech synthesis, image generation, deterministic
-- diagram rendering) are provider/capability addressed and intentionally have
-- no inference family, so family must be nullable. Existing rows are unchanged.

ALTER TABLE IF EXISTS ai_model_catalog
  ALTER COLUMN family DROP NOT NULL;
