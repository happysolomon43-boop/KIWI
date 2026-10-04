BEGIN;

CREATE INDEX IF NOT EXISTS d28_item_analytics_items_run_fk_idx
  ON teaching_runtime.d28_item_analytics_items(analytics_run_id);

CREATE INDEX IF NOT EXISTS d28_item_analytics_review_flags_run_fk_idx
  ON teaching_runtime.d28_item_analytics_review_flags(analytics_run_id);

COMMIT;
