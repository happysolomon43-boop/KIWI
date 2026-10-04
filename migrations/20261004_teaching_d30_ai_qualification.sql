begin;

create table if not exists teaching_ai_qualification_runs (
  id uuid primary key default gen_random_uuid(), run_id text not null unique, case_id text not null, family_id text not null, capability_id text, route_id text not null, route_role text not null check (route_role in ('primary','fallback','stage')), model_id text not null, model_settings_hash text not null, constitution_version text not null, prompt_version text not null, schema_version text not null, suite_version text not null, run_kind text not null, validation jsonb not null default '{}'::jsonb, latency_ms integer not null default 0 check (latency_ms >= 0), input_tokens integer not null default 0 check (input_tokens >= 0), output_tokens integer not null default 0 check (output_tokens >= 0), estimated_cost_usd numeric(14,8) not null default 0 check (estimated_cost_usd >= 0), retry_count integer not null default 0 check (retry_count >= 0), timed_out boolean not null default false, fallback_used boolean not null default false, defects jsonb not null default '[]'::jsonb, created_at timestamptz not null default now()
);
create table if not exists teaching_ai_qualification_reviews (
  id uuid primary key default gen_random_uuid(), run_id text not null references teaching_ai_qualification_runs(run_id) on delete cascade, reviewer_kind text not null check (reviewer_kind in ('human_academic','deterministic','semantic_assist')), independent boolean not null default false, decision text not null check (decision in ('PASS','FAIL','REVIEW_NEEDED')), rationale_summary text, created_at timestamptz not null default now()
);
create table if not exists teaching_ai_route_qualification_decisions (
  id uuid primary key default gen_random_uuid(), route_id text not null, family_id text not null, capability_id text, route_role text not null, decision text not null check (decision in ('QUALIFIED','BLOCKED','INSUFFICIENT_EVIDENCE')), evidence_run_ids text[] not null default '{}', p0_count integer not null default 0, p1_count integer not null default 0, human_review_satisfied boolean not null default false, stability_satisfied boolean not null default false, production_authorized boolean not null default false check (production_authorized = false), authorization_gate text not null default 'D31' check (authorization_gate = 'D31'), decided_at timestamptz not null default now(), unique(route_id,family_id,capability_id,route_role)
);

alter table teaching_ai_qualification_runs enable row level security; alter table teaching_ai_qualification_runs force row level security;
alter table teaching_ai_qualification_reviews enable row level security; alter table teaching_ai_qualification_reviews force row level security;
alter table teaching_ai_route_qualification_decisions enable row level security; alter table teaching_ai_route_qualification_decisions force row level security;
revoke all on teaching_ai_qualification_runs, teaching_ai_qualification_reviews, teaching_ai_route_qualification_decisions from anon, authenticated;
grant select, insert, update, delete on teaching_ai_qualification_runs, teaching_ai_qualification_reviews, teaching_ai_route_qualification_decisions to service_role;

create index if not exists teaching_ai_qualification_runs_route_idx on teaching_ai_qualification_runs(route_id,family_id,route_role);
create index if not exists teaching_ai_qualification_runs_case_idx on teaching_ai_qualification_runs(case_id);
create index if not exists teaching_ai_qualification_reviews_run_idx on teaching_ai_qualification_reviews(run_id);

commit;
