begin;

alter table teaching_runtime.d30_human_reviews
  add column if not exists run_id uuid,
  add column if not exists attempt_no integer;

do $$
begin
  if exists (
    select 1
    from teaching_runtime.d30_human_reviews
    where run_id is null or attempt_no is null
  ) then
    raise exception 'D30 human-review run identity migration cannot infer legacy review evidence safely';
  end if;
end
$$;

alter table teaching_runtime.d30_human_reviews
  alter column run_id set not null,
  alter column attempt_no set not null;

alter table teaching_runtime.d30_human_reviews
  add constraint d30_human_reviews_attempt_no_check check (attempt_no >= 1),
  add constraint d30_human_reviews_run_id_fkey foreign key (run_id)
    references teaching_runtime.d30_case_results(id) on delete cascade,
  add constraint d30_human_reviews_run_reviewer_key unique (session_id, run_id, reviewer_ref);

create index if not exists d30_human_reviews_run_decision_idx
  on teaching_runtime.d30_human_reviews(session_id, run_id, decision);

comment on column teaching_runtime.d30_human_reviews.run_id is
  'Exact empirical d30_case_results.id reviewed by the independent human academic reviewer.';
comment on column teaching_runtime.d30_human_reviews.attempt_no is
  'Exact repeated empirical attempt under review; prevents a PASS on one replay from satisfying another.';

commit;
