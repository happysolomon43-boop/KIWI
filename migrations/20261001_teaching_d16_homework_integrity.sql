-- D16 Homework, Independent Work & Academic Integrity.
-- Assignment/Submission truth is server-owned and distinct from Attendance,
-- formal Assessment Attempts, SKM state and Gradebook truth.

CREATE TABLE public.teaching_assignments (
  assignment_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  source_class_id text REFERENCES public.teaching_classes(class_id) ON DELETE SET NULL,
  title text NOT NULL,
  instructions text,
  learning_unit_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(learning_unit_refs)='array'),
  source_lineage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_lineage)='object'),
  purpose text NOT NULL CHECK (purpose IN ('PRACTICE','RETRIEVAL','REMEDIATION','PREPARATION','APPLICATION','PRODUCTION','REVISION','INDEPENDENT_EVIDENCE','READING')),
  work_stake text NOT NULL CHECK (work_stake IN ('OPTIONAL','PREPARATION','REMEDIATION','GRADED')),
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('ASSIGNED','UPCOMING','OPEN','STARTED','SUBMITTED','MARKING','RETURNED','CORRECTION_AVAILABLE','RESUBMITTED','VERIFICATION','VERIFIED','CLOSED')),
  orthogonal_conditions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(orthogonal_conditions)='array'),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  estimated_effort_min_minutes integer NOT NULL CHECK (estimated_effort_min_minutes >= 0),
  estimated_effort_max_minutes integer NOT NULL CHECK (estimated_effort_max_minutes >= estimated_effort_min_minutes),
  deadline_type text NOT NULL CHECK (deadline_type IN ('SOFT','HARD','PEDAGOGICALLY_EXPIRING')),
  original_due_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  deadline_policy_version text NOT NULL,
  integrity_policy_version text NOT NULL,
  correction_policy_version text NOT NULL,
  assistance_mode text NOT NULL CHECK (assistance_mode IN ('OPEN_LEARNING_ASSISTANCE','HINT_ONLY','REFERENCE_ONLY','CLOSED_BOOK_INDEPENDENT','FORMAL_ASSESSMENT')),
  response_kind text NOT NULL DEFAULT 'GENERAL' CHECK (response_kind IN ('GENERAL','LONG_FORM','CODE','QUANTITATIVE','HUMANITIES','READING_CHECK')),
  solution_release_policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(solution_release_policy)='object'),
  solution_released_at timestamptz,
  solution_exposed boolean NOT NULL DEFAULT false,
  graded boolean NOT NULL DEFAULT false,
  dependency_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(dependency_refs)='array'),
  replacement_assignment_id text REFERENCES public.teaching_assignments(assignment_id) ON DELETE SET NULL,
  replacement_reason text,
  active_request_ref text REFERENCES public.teaching_requests(request_id) ON DELETE SET NULL,
  feedback_release_policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(feedback_release_policy)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (graded = false OR work_stake = 'GRADED'),
  CHECK (replacement_assignment_id IS NULL OR replacement_assignment_id <> assignment_id)
);
CREATE INDEX teaching_assignments_student_due_idx ON public.teaching_assignments(student_id,due_at,lifecycle_state);
CREATE INDEX teaching_assignments_course_due_idx ON public.teaching_assignments(student_id,course_id,due_at);
CREATE INDEX teaching_assignments_course_fk_idx ON public.teaching_assignments(course_id);
CREATE INDEX teaching_assignments_class_fk_idx ON public.teaching_assignments(source_class_id);
CREATE INDEX teaching_assignments_replacement_fk_idx ON public.teaching_assignments(replacement_assignment_id);
CREATE INDEX teaching_assignments_request_fk_idx ON public.teaching_assignments(active_request_ref);

CREATE TABLE public.teaching_assignment_history (
  assignment_history_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assignment_id text NOT NULL REFERENCES public.teaching_assignments(assignment_id) ON DELETE CASCADE,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  action_kind text NOT NULL,
  from_lifecycle_state text,
  to_lifecycle_state text,
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(after_snapshot)='object'),
  reason text,
  source_request_id text REFERENCES public.teaching_requests(request_id) ON DELETE SET NULL,
  policy_version_at_event text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  UNIQUE(student_id,assignment_id,version_no),
  UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_assignment_history_assignment_idx ON public.teaching_assignment_history(student_id,assignment_id,version_no DESC);
CREATE INDEX teaching_assignment_history_request_fk_idx ON public.teaching_assignment_history(source_request_id);

CREATE TABLE public.teaching_assignment_submissions (
  assignment_submission_id text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES public.teaching_assignments(assignment_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  submission_kind text NOT NULL CHECK (submission_kind IN ('DRAFT','FINAL','CORRECTION','VERIFICATION')),
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_payload)='object'),
  submitted_at timestamptz,
  accepted_event_at timestamptz NOT NULL,
  policy_version_at_event text NOT NULL,
  deadline_policy_version_at_event text NOT NULL,
  assistance_mode_at_event text NOT NULL CHECK (assistance_mode_at_event IN ('OPEN_LEARNING_ASSISTANCE','HINT_ONLY','REFERENCE_ONLY','CLOSED_BOOK_INDEPENDENT','FORMAL_ASSESSMENT')),
  prior_submission_id text REFERENCES public.teaching_assignment_submissions(assignment_submission_id) ON DELETE RESTRICT,
  correction_of_submission_id text REFERENCES public.teaching_assignment_submissions(assignment_submission_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(assignment_id,student_id,version_no),
  UNIQUE(student_id,idempotency_key),
  CHECK (submission_kind='DRAFT' OR submitted_at IS NOT NULL),
  CHECK (version_no=1 OR prior_submission_id IS NOT NULL)
);
CREATE INDEX teaching_assignment_submissions_assignment_idx ON public.teaching_assignment_submissions(student_id,assignment_id,version_no DESC);
CREATE INDEX teaching_assignment_submissions_prior_fk_idx ON public.teaching_assignment_submissions(prior_submission_id);
CREATE INDEX teaching_assignment_submissions_correction_fk_idx ON public.teaching_assignment_submissions(correction_of_submission_id);

CREATE TABLE public.teaching_assignment_integrity_reviews (
  integrity_review_id text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES public.teaching_assignments(assignment_id) ON DELETE CASCADE,
  submission_id text NOT NULL REFERENCES public.teaching_assignment_submissions(assignment_submission_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  review_version bigint NOT NULL CHECK (review_version >= 1),
  policy_version_at_event text NOT NULL,
  rule_alignment text NOT NULL CHECK (rule_alignment IN ('NOT_REVIEWED','ALIGNED','MISALIGNED','UNRESOLVED')),
  capability_evidence text NOT NULL CHECK (capability_evidence IN ('NOT_REVIEWED','SUPPORTED','UNRESOLVED','COMPROMISED','INVALID')),
  contextual_signals jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(contextual_signals)='array'),
  verification_state text NOT NULL CHECK (verification_state IN ('NOT_REQUIRED','REQUIRED','PENDING','PASSED','FAILED','REFUSED','REVIEW_NEEDED')),
  verification_target text,
  verification_method text,
  active_formal_assessment boolean NOT NULL DEFAULT false,
  deferred_to_post_attempt boolean NOT NULL DEFAULT false,
  authoritative_outcome jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(authoritative_outcome)='object'),
  prior_misconduct_proven boolean NOT NULL DEFAULT false CHECK (prior_misconduct_proven=false),
  idempotency_key text NOT NULL,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,submission_id,review_version),
  UNIQUE(student_id,idempotency_key),
  CHECK (active_formal_assessment=false OR deferred_to_post_attempt=true)
);
CREATE INDEX teaching_assignment_integrity_submission_idx ON public.teaching_assignment_integrity_reviews(student_id,submission_id,review_version DESC);
CREATE INDEX teaching_assignment_integrity_assignment_idx ON public.teaching_assignment_integrity_reviews(student_id,assignment_id,created_at DESC);

CREATE TABLE public.teaching_assignment_evaluations (
  assignment_evaluation_id text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES public.teaching_assignments(assignment_id) ON DELETE CASCADE,
  submission_id text NOT NULL REFERENCES public.teaching_assignment_submissions(assignment_submission_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  evaluation_version bigint NOT NULL CHECK (evaluation_version >= 1),
  evaluation_state text NOT NULL CHECK (evaluation_state IN ('PROPOSED','VALIDATED','REVIEW_NEEDED','INVALIDATED')),
  response_kind text NOT NULL CHECK (response_kind IN ('GENERAL','LONG_FORM','CODE','QUANTITATIVE','HUMANITIES','READING_CHECK')),
  criteria_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(criteria_snapshot)='object'),
  criterion_results jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(criterion_results)='array'),
  feedback_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(feedback_payload)='object'),
  learning_evidence_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(learning_evidence_payload)='object'),
  official_mark_committed boolean NOT NULL DEFAULT false CHECK (official_mark_committed=false),
  gradebook_handoff jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(gradebook_handoff)='object'),
  policy_version_at_event text NOT NULL,
  idempotency_key text NOT NULL,
  provenance_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance_refs)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,submission_id,evaluation_version),
  UNIQUE(student_id,idempotency_key)
);
CREATE INDEX teaching_assignment_evaluations_submission_idx ON public.teaching_assignment_evaluations(student_id,submission_id,evaluation_version DESC);
CREATE INDEX teaching_assignment_evaluations_assignment_idx ON public.teaching_assignment_evaluations(student_id,assignment_id,created_at DESC);

-- Solution/answer material is isolated from ordinary Assignment projections.
CREATE TABLE public.teaching_assignment_solution_material (
  solution_material_id text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES public.teaching_assignments(assignment_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  protected_payload jsonb NOT NULL CHECK (jsonb_typeof(protected_payload)='object'),
  release_policy_snapshot jsonb NOT NULL CHECK (jsonb_typeof(release_policy_snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,assignment_id,version_no)
);
CREATE INDEX teaching_assignment_solution_assignment_idx ON public.teaching_assignment_solution_material(student_id,assignment_id,version_no DESC);

ALTER TABLE public.teaching_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_assignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_assignment_integrity_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_assignment_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_assignment_solution_material ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.teaching_assignments,public.teaching_assignment_history,public.teaching_assignment_submissions,
  public.teaching_assignment_integrity_reviews,public.teaching_assignment_evaluations,public.teaching_assignment_solution_material
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.teaching_assignments TO service_role;
GRANT SELECT,INSERT ON public.teaching_assignment_history,public.teaching_assignment_submissions,
  public.teaching_assignment_integrity_reviews,public.teaching_assignment_evaluations,public.teaching_assignment_solution_material TO service_role;

COMMENT ON TABLE public.teaching_assignments IS 'D16 authoritative Homework/independent-work lifecycle. Orthogonal Late/Expired/Excused/Replaced/Invalidated/Missed/System-Protected/Paused conditions are separate from lifecycle.';
COMMENT ON TABLE public.teaching_assignment_submissions IS 'D16 append-only draft/final/correction/verification submission versions. accepted_event_at is authoritative for event-time deadline interpretation.';
COMMENT ON TABLE public.teaching_assignment_integrity_reviews IS 'D16 append-only integrity/capability evidence reviews. Signals are contextual only; the schema contains no guilt-probability or permanent-student-label field.';
COMMENT ON TABLE public.teaching_assignment_evaluations IS 'D16 subject-sensitive work evaluation/feedback. Official Gradebook commit is forbidden here and remains D20-owned.';
COMMENT ON TABLE public.teaching_assignment_solution_material IS 'D16 protected solution material. No browser role receives direct access; release is projected only through server policy checks.';