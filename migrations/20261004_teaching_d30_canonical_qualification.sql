begin;

create schema if not exists teaching_runtime;

create table if not exists teaching_runtime.d30_qualification_sessions (
  id uuid primary key,
  contract_version text not null,
  evaluation_suite_version text not null,
  prompt_manifest_version text not null,
  prompt_manifest_sha256 text not null check (prompt_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  source_sha text not null check (source_sha ~ '^[0-9a-f]{40}$'),
  environment text not null check (environment in ('LOCAL','CI','INTEGRATION','STAGING','PRODUCTION_SHADOW')),
  status text not null check (status in ('RUNNING','QUALIFIED','BLOCKED','FAILED')),
  metadata jsonb not null default '{}'::jsonb,
  report jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists teaching_runtime.d30_case_results (
  id uuid primary key,
  session_id uuid not null references teaching_runtime.d30_qualification_sessions(id) on delete cascade,
  case_id text not null,
  family_id text not null,
  capability_id text not null default '',
  route_key text not null,
  route_role text not null check (route_role in ('PRIMARY','FALLBACK','STAGE')),
  route_posture text not null default '',
  model_id text not null,
  provider text not null,
  central_task_id text not null default '',
  model_settings_hash text not null check (model_settings_hash ~ '^[0-9a-f]{64}$'),
  prompt_family_version text not null,
  prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  output_schema_id text not null default '',
  output_schema_version text not null default '',
  run_kind text not null,
  criticality text not null check (criticality in ('C1','C2','C3','C4')),
  attempt_no integer not null check (attempt_no >= 1),
  validation jsonb not null,
  semantic_review jsonb,
  latency_ms numeric not null default 0 check (latency_ms >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(18,8) not null default 0 check (estimated_cost_usd >= 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  timed_out boolean not null default false,
  fallback_used boolean not null default false,
  defects jsonb not null default '[]'::jsonb,
  execution_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, case_id, route_key, route_role, capability_id, attempt_no)
);

create table if not exists teaching_runtime.d30_human_reviews (
  id uuid primary key,
  session_id uuid not null references teaching_runtime.d30_qualification_sessions(id) on delete cascade,
  case_id text not null default '',
  family_id text not null,
  capability_id text not null default '',
  route_key text not null,
  reviewer_ref text not null,
  reviewer_kind text not null check (reviewer_kind = 'HUMAN_ACADEMIC'),
  independent boolean not null check (independent = true),
  decision text not null check (decision in ('PASS','FAIL','REVIEW_NEEDED')),
  rubric jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists teaching_runtime.d30_defects (
  id uuid primary key,
  session_id uuid not null references teaching_runtime.d30_qualification_sessions(id) on delete cascade,
  case_id text not null default '',
  family_id text not null default '',
  capability_id text not null default '',
  route_key text not null default '',
  severity text not null check (severity in ('P0','P1','P2','P3')),
  code text not null,
  root_cause text check (root_cause is null or root_cause in ('wording','context','task_mode_separation','schema','authority_contract','model_limitation','product_ambiguity','flawed_evaluation_expectation')),
  description text not null,
  regression_anchor_id text,
  resolved boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, code, case_id, route_key)
);

create table if not exists teaching_runtime.d30_route_decisions (
  id uuid primary key,
  session_id uuid not null references teaching_runtime.d30_qualification_sessions(id) on delete cascade,
  family_id text not null,
  route_key text not null,
  route_role text not null check (route_role in ('PRIMARY','FALLBACK','STAGE')),
  decision text not null check (decision in ('UNQUALIFIED','QUALIFIED','BLOCKED','INSUFFICIENT_EVIDENCE')),
  specification_complete boolean not null default false,
  production_qualified boolean not null default false,
  production_authorized boolean not null default false check (production_authorized = false),
  authorization_gate text not null default 'D31' check (authorization_gate = 'D31'),
  summary jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, family_id, route_key, route_role)
);

create table if not exists teaching_runtime.d30_prompt_governance (
  id uuid primary key,
  family_id text not null,
  family_version text not null,
  prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('NOT_STARTED','BEHAVIOR_BRIEF_DRAFT','BEHAVIOR_BRIEF_APPROVED','PROMPT_CANDIDATE_DRAFT','EVALUATION_IN_PROGRESS','REVISION_REQUIRED','CANDIDATE_APPROVED','FROZEN_VERSION','DEPRECATED')),
  behavior_brief_ref text,
  governance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, family_version, prompt_sha256)
);

create table if not exists teaching_runtime.d30_ppl_comparisons (
  id uuid primary key,
  session_id uuid not null references teaching_runtime.d30_qualification_sessions(id) on delete cascade,
  comparison_key text not null,
  one_shot_summary jsonb not null,
  progressive_summary jsonb not null,
  decision text not null check (decision in ('PROGRESSIVE_QUALIFIED','REDUCE_PREPARATION_PROFILE','INSUFFICIENT_EVIDENCE')),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, comparison_key)
);

create index if not exists d30_case_results_family_route_idx on teaching_runtime.d30_case_results(session_id, family_id, route_key, route_role);
create index if not exists d30_case_results_capability_idx on teaching_runtime.d30_case_results(session_id, capability_id, route_key);
create index if not exists d30_case_results_case_idx on teaching_runtime.d30_case_results(session_id, case_id);
create index if not exists d30_defects_open_idx on teaching_runtime.d30_defects(session_id, severity, resolved) where resolved = false;
create index if not exists d30_human_reviews_family_route_idx on teaching_runtime.d30_human_reviews(session_id, family_id, route_key, decision);

alter table teaching_runtime.d30_qualification_sessions enable row level security;
alter table teaching_runtime.d30_case_results enable row level security;
alter table teaching_runtime.d30_human_reviews enable row level security;
alter table teaching_runtime.d30_defects enable row level security;
alter table teaching_runtime.d30_route_decisions enable row level security;
alter table teaching_runtime.d30_prompt_governance enable row level security;
alter table teaching_runtime.d30_ppl_comparisons enable row level security;

revoke all on teaching_runtime.d30_qualification_sessions from anon, authenticated;
revoke all on teaching_runtime.d30_case_results from anon, authenticated;
revoke all on teaching_runtime.d30_human_reviews from anon, authenticated;
revoke all on teaching_runtime.d30_defects from anon, authenticated;
revoke all on teaching_runtime.d30_route_decisions from anon, authenticated;
revoke all on teaching_runtime.d30_prompt_governance from anon, authenticated;
revoke all on teaching_runtime.d30_ppl_comparisons from anon, authenticated;

grant select, insert, update, delete on teaching_runtime.d30_qualification_sessions to service_role;
grant select, insert, update, delete on teaching_runtime.d30_case_results to service_role;
grant select, insert, update, delete on teaching_runtime.d30_human_reviews to service_role;
grant select, insert, update, delete on teaching_runtime.d30_defects to service_role;
grant select, insert, update, delete on teaching_runtime.d30_route_decisions to service_role;
grant select, insert, update, delete on teaching_runtime.d30_prompt_governance to service_role;
grant select, insert, update, delete on teaching_runtime.d30_ppl_comparisons to service_role;

comment on table teaching_runtime.d30_qualification_sessions is 'D30 empirical Teaching-AI qualification session evidence. This is audit/qualification state, never academic truth.';
comment on table teaching_runtime.d30_case_results is 'Versioned Phase-16/TPF-20 empirical run evidence. Hidden chain-of-thought is prohibited by application contract.';
comment on table teaching_runtime.d30_human_reviews is 'Independent human academic review decisions required for C4/consequential D30 qualification.';
comment on table teaching_runtime.d30_route_decisions is 'D30 route qualification decisions. Production authorization remains false until D31.';
comment on table teaching_runtime.d30_ppl_comparisons is 'Matched one-shot versus progressive preparation empirical evidence for TCH-0902.';

commit;