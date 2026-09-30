begin;

create table if not exists public.teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  course_id uuid not null,
  learning_unit_ids jsonb not null default '[]'::jsonb,
  source_lineage jsonb not null default '{}'::jsonb,
  purpose text not null check (purpose in ('PRACTICE','RETRIEVAL','REMEDIATION','PREPARATION','APPLICATION','PRODUCTION','REVISION','INDEPENDENT_EVIDENCE','READING')),
  work_stake text not null check (work_stake in ('OPTIONAL','PREPARATION','REMEDIATION','GRADED')),
  lifecycle_state text not null check (lifecycle_state in ('ASSIGNED','UPCOMING','OPEN','STARTED','SUBMITTED','MARKING','RETURNED','CORRECTION_AVAILABLE','RESUBMITTED','VERIFICATION','VERIFIED','CLOSED')),
  conditions jsonb not null default '[]'::jsonb,
  estimated_effort_min_minutes integer not null check (estimated_effort_min_minutes >= 0),
  estimated_effort_max_minutes integer not null check (estimated_effort_max_minutes >= estimated_effort_min_minutes),
  deadline_type text not null check (deadline_type in ('SOFT','HARD','PEDAGOGICALLY_EXPIRING')),
  due_at timestamptz not null,
  deadline_policy_version text not null,
  integrity_policy_version text not null,
  assistance_mode text not null check (assistance_mode in ('OPEN_LEARNING_ASSISTANCE','HINT_ONLY','REFERENCE_ONLY','CLOSED_BOOK_INDEPENDENT','FORMAL_ASSESSMENT')),
  solution_release_policy jsonb not null default '{}'::jsonb,
  solution_released_at timestamptz,
  graded boolean not null default false,
  replacement_assignment_id uuid references public.teaching_assignments(id),
  created_at timestamptz not null default now()
);

create table if not exists public.teaching_assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.teaching_assignments(id),
  student_id uuid not null,
  version integer not null check (version > 0),
  submission_kind text not null check (submission_kind in ('DRAFT','FINAL','CORRECTION','VERIFICATION')),
  response jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  accepted_event_at timestamptz not null default now(),
  policy_version_at_event text not null,
  prior_submission_id uuid references public.teaching_assignment_submissions(id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (assignment_id, student_id, version),
  unique (student_id, idempotency_key)
);

create table if not exists public.teaching_assignment_integrity_reviews (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.teaching_assignments(id),
  submission_id uuid not null references public.teaching_assignment_submissions(id),
  student_id uuid not null,
  policy_version_at_event text not null,
  rule_alignment text not null check (rule_alignment in ('NOT_REVIEWED','ALIGNED','MISALIGNED','UNRESOLVED')),
  capability_evidence text not null check (capability_evidence in ('NOT_REVIEWED','SUPPORTED','UNRESOLVED','COMPROMISED','INVALID')),
  contextual_signals jsonb not null default '[]'::jsonb,
  verification_state text not null default 'NOT_REQUIRED' check (verification_state in ('NOT_REQUIRED','REQUIRED','PENDING','PASSED','FAILED','REFUSED')),
  verification_target text,
  verification_method text,
  active_formal_assessment boolean not null default false,
  authoritative_outcome jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (student_id, idempotency_key)
);

create index if not exists teaching_assignments_student_course_due_idx on public.teaching_assignments(student_id, course_id, due_at);
create index if not exists teaching_assignment_submissions_assignment_event_idx on public.teaching_assignment_submissions(assignment_id, student_id, accepted_event_at desc);
create index if not exists teaching_assignment_integrity_reviews_submission_idx on public.teaching_assignment_integrity_reviews(submission_id, created_at desc);

alter table public.teaching_assignments enable row level security;
alter table public.teaching_assignment_submissions enable row level security;
alter table public.teaching_assignment_integrity_reviews enable row level security;
revoke all on public.teaching_assignments, public.teaching_assignment_submissions, public.teaching_assignment_integrity_reviews from anon, authenticated;
grant select, insert on public.teaching_assignments, public.teaching_assignment_submissions, public.teaching_assignment_integrity_reviews to service_role;

commit;
