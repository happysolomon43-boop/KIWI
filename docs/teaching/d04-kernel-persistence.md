# D04 — Kernel Persistence, Security & Auditability

D04 implements persistence only. It does not implement D05 orchestration, D06 academic policy selection, Course-generation behavior, Scheduler behavior, Gradebook, Attendance, Assessment Package locking, Progression, or later domain workflows.

## Scope and TCH accounting

D04 covers exactly TCH-0035, TCH-0036, TCH-0038–TCH-0047, TCH-0061–TCH-0062, TCH-0064–TCH-0068, TCH-0070, TCH-0684–TCH-0690, and TCH-0875–TCH-0878.

The migration creates separate Semester, Course, versioned Course Plan, Topic, Subtopic, Learning Unit, prerequisite/dependency, split/merge lineage, scheduled Class, Lesson Blueprint, Class Session, Board Scene/Item, non-formal Student Response, Evidence Event, Teacher Identity, Interaction Preference, Student Course Intake, source-content inventory, Course Coverage, Assessment Eligibility and immutable academic-audit records.

Student Course Intake preserves original free-form text separately from later structured extraction. Interaction Preferences remain separate from Teacher Identity/personality. Evidence Events are durable evidence facts only; D04 does not convert them into SKM truth. Assessment Eligibility is a separate effective-time ledger and is not derived from raw Subject scope by this migration.

Coverage is deliberately not collapsed into one mutually exclusive enum. Found, Mapped, Planned, Taught, Validated Prior Knowledge, Instructionally Complete, Assessed and Excluded are separately reconstructable, with explicit instructional-completion basis and exclusion reason. Learning Unit lineage preserves split/merge/replacement/refinement history.

## PPL persistence

`teaching_preparation.workspaces` stores target/owner/profile references, separate lifecycle and maturity axes, target/freeze times, current authoritative-input/artifact refs, explicit protection class, review scheduling, supersession/cancellation and state version. It is coordination/audit state and owns no academic truth.

Authoritative Input Bundles, input dependencies, artifact versions, artifact components, component dependencies and artifact lineage provide version binding and partial-invalidation primitives. Review Findings persist severity, component/evidence/rule refs, concise explanation, required action, status, recurrence guard, creating capability and resolved version. No hidden chain-of-thought field exists.

Prepared artifact payload bodies are physically isolated in `teaching_protected.prepared_artifact_payloads`. Browser roles and the ordinary `teaching_domain_service` role have no access to this table. D04 does not implement workspace transitions/materiality/finalization logic; those remain D05.

## Security and authority

All public D04 Teaching tables enable RLS. Authenticated browser roles may only SELECT rows whose `student_id` matches `auth.uid()`; they receive no INSERT/UPDATE/DELETE/TRUNCATE privilege. Trusted mutations use server/service boundaries.

Two NOLOGIN/NOBYPASSRLS group roles are created: `teaching_domain_service` for ordinary trusted Teaching persistence and `teaching_protected_service` for protected preparation. A D04 hardening migration grants each role only the RLS policies matching its existing table privileges and lets Supabase `service_role` assume those narrower roles. Browser roles inherit neither role. Current server operation may continue through `service_role`, while future trusted service code can deliberately `SET ROLE` into a narrower D04 boundary without relying on `BYPASSRLS`.

Service principals receive no academic DELETE/TRUNCATE grant. `teaching_domain_service` has no privilege or RLS policy on protected artifact payload bodies; only `teaching_protected_service` and the existing `service_role` protected path can read/insert those bodies. Historical Student Responses, Evidence Events, Intake originals/extractions, Learning Unit lineage, PPL input/dependency/lineage refs and protected payload versions are immutable; corrections create new versions/events rather than rewrite history. The academic audit log is append-only.

The code-level D04 security contract also reserves grade finalization, Assessment Package locking, authoritative attendance recording, formal Request decisions and schedule-authority updates for the server trust boundary, even though those later-domain tables are intentionally not created in D04.

## Deliberately deferred

D04 stores policy/version references without choosing unresolved D06 values. It does not decide the meaningful-content classification rule, prior-knowledge evidence threshold, eligibility exceptions, grading policy, lateness, accommodations, retention/deletion, or other D06 GATEs. It also does not create later Gradebook, Attendance, Request, Assessment Package, SKM, Progression or Course Attempt stores ahead of their assigned delivery.
