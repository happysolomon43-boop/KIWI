begin;

create index if not exists d30_human_reviews_run_fk_idx
  on teaching_runtime.d30_human_reviews(run_id);

comment on index teaching_runtime.d30_human_reviews_run_fk_idx is
  'Covers d30_human_reviews_run_id_fkey for exact-run human review lookup and cascade maintenance.';

commit;
