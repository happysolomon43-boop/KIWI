# D05/D31 — Durable academic authority revocation and in-flight AI cancellation

**Issue:** #305. **Prerequisites:** #304 retains atomic academic publication fences, and #306 supplies cross-provider AbortSignal plumbing. This extension does not delete academic evidence, erase attendance, change grades, or change model qualification.

## Immutable authority identity

A model execution is scoped to its authenticated student, frozen Teaching owner and expected authority version. `teaching_runtime.academic_authority_revocations` stores only:
`(student_id,owner_kind,owner_ref,authority_version,reason_code,revoked_at)`.
The unique key makes retries safe. RLS and service-only grants prevent student-side writes. Old revoked versions stay revoked after a Course resumes; a new Course/Plan/Class version is **not** automatically revoked by historical events.

PostgreSQL owner triggers append revocation **inside the SAME transaction** that changes an old authority. Triggers cover Course, Class, Course Plan, Lesson Blueprint, approved timetable and PPL workspace. The authoritative D08 Course Plan publication state is **`REVIEW_READY`**, not `APPROVED`. The trigger does not revoke a newly promoted timetable or freshly published Lesson Plan.

D08 creates a `REVIEW_READY` Course Plan before inserting its Topic / Learning Unit graph. Therefore **INSERTs into new plan children must not mark the new Plan stale**. Edits or deletions to a `REVIEW_READY` plan's existing Topics or Learning Units explicitly revoke that exact old Plan/version. D08 must issue a new Course Plan version to restore usable authority. This avoids hard-coded subject or Course identity logic and covers the Topic → Plan → Class/PPL dependency chain.

## Execution and abort mechanism

D31 creates `createAcademicAuthorityCancellationReader` with its authenticated SQL client and injects it into D05 orchestration. The reader derives Class → Course → approved timetable from authoritative database relationships, not untrusted model text. It checks the owner, its active Plan/Blueprint preconditions and the parent version exactly.

D05 checks current version and revocations before generation, during generation on each KIWI worker (2-second bounded poll), and after model output. Central KIWI model orchestration also invokes `beforeAttempt` before every credential/model fallback. The hook retains the same central `MAIN_CBT` route and preserves D28 admission limits. It uses the existing #306 HTTP AbortSignal path to Google, Groq and other compatible transports; a cancelled request must not start a fallback or retry.

If a model returns after a cancellation or ignores AbortSignal, D05/D11/D14 versioned commit fences still reject the obsolete response. Model cancellation never causes a student-visible fabricated completion, grade, or assessment answer.

## Durable, truthful operational telemetry

`teaching_runtime.orchestration_executions.safe_metadata` records `model_queued_at`, `model_dispatch_started_at`, `abort_requested_at`, `abort_reason`, `abort_phase`, `local_execution_stopped_at` or `late_result_discarded_at` as applicable. `validation_outcome` distinguishes `CANCELLED_BEFORE_MODEL_DISPATCH`, `MODEL_EXECUTION_INTERRUPTED`, and `LATE_RESULT_DISCARDED`. The field `remote_abort_confirmation=NOT_OBSERVABLE` deliberately does **not** claim the provider stopped executing or refunded tokens: a local signal is not a provider acknowledgement.

Provider-attempt telemetry already records cancelled attempts with the nonretryable `CANCELLED_PARENT_SUPERSEDED` code where the transport propagates it. Existing D28 accounting records available provider usage; no credit, token refund, or cancellation saving is invented.

## Rollout / recovery

Migrate **both production and teaching-integration** PostgreSQL projects before rolling out code:

1. `migrations/20261008_teaching_d05_durable_authority_revocations.sql`
2. `migrations/20261008_teaching_d05_revocation_promotion_guard.sql`
3. `migrations/20261008_teaching_d05_topic_dependency_revocation.sql`

The second file is the idempotent schema-repair step for an early integration installation, and the third installs final `REVIEW_READY`/Topic descendant guards. There are eight owner triggers after full installation. Migrations never retroactively delete or rewrite records.

Regression tests exercise a two-worker shared durable reader, exact-version cancellation vs new versions, tenant scoping, missing Class, cancelled Course model preflight, in-flight fallback prevention, non-cooperating provider late-result discards, and Topic/Unit dependency rules.

**Verification limitation:** The tests use controlled provider results. The live production rollout must still verify actual transport termination and local auditing under a real authorized Course/Class mutation. Remote abort acknowledgements and token refunds cannot be guaranteed across provider APIs. Keep #305 open until that empirical verification and any remaining operational reconciliation are complete.
