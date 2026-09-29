# KIWI Teaching D10 — Course Activation, Lifecycle & Formal Requests

This document accounts for the complete canonical D10 task set. D10 is deterministic. It introduces no model authority, no prompt changes, no Gradebook/Progression/Attendance replacement, and no second Scheduler.

## Delivery boundary

D08 remains authoritative for current Course Plan/Coverage readiness. D09 remains authoritative for Semester, timetable feasibility, schedule history and schedule debt. D10 owns Course lifecycle/activation and the formal Request aggregate, then delegates approved target mutation to the authoritative domain owner.

The four-Course launch admission rule is `four-course-launch.v1`, a versioned product-admission policy rather than a schema cap. One student identity is preserved.

## Task accounting

- **TCH-0060** — Implemented one authoritative `teaching_requests` aggregate plus immutable request history and exactly-once application record. It carries lifecycle, type, target owner/ref/version, requested change, decision, effective time, alternative proposal/version, student response, application reference and closure.
- **TCH-0146** — Implemented the canonical Course lifecycle with explicit transition validation and durable history. `Incomplete → Archived` is deliberately illegal; unresolved Incomplete administrative closure is a separate immutable closure record that preserves Incomplete.
- **TCH-0147** — Implemented operational `status_overlays` independently from base lifecycle.
- **TCH-0148** — Implemented a structurally separate nullable `progression_outcome` axis only. D21 remains the exclusive progression-decision owner.
- **TCH-0149** — Implemented Start Course activation as one authoritative D05-backed transaction: revalidate D08/D09/D10 prerequisites, approve the current timetable through D09, materialize Class obligations, lock the grading-policy version, bind Teacher assignment, persist activation snapshot/policy-at-decision, move Ready→Active, start the academic-record timestamp and publish `teaching.course.activated`.
- **TCH-0150** — Implemented post-activation protection. D09 direct availability/timetable edits are blocked by service authority; UI direct dragging/editing is removed as an active-Course authority path and replaced by formal Requests.
- **TCH-0151** — Implemented the unified Request state machine with state versions and database/service transition guards.
- **TCH-0152** — Implemented single-Class reschedule Request. It binds Class schedule version, previews/revalidates using the D09 Scheduler, can produce a concrete validated alternative and applies by creating a new approved timetable version rather than dragging historical truth.
- **TCH-0153** — Implemented permanent availability-change Request. Approved application versions D09 schedule inputs and recomputes the global timetable through D09.
- **TCH-0154** — Implemented Academic Break Request as a Course-bound D09 BREAK constraint, with global feasibility/headroom/deadline consequences checked before decision and rechecked before application. Required curriculum is never deleted.
- **TCH-0155** — Implemented emergency-absence fast path with no proof interrogation and explicit `behaviorPenaltyAutomatic:false`. D10 records the formal envelope only; D15 remains Attendance owner.
- **TCH-0156** — Implemented Course Pause/Resume Requests. Pause preserves history, cancels/suspends future scheduled Class obligations and stales timetable state without deleting schedule debt. Resume rechecks admission and D09 feasibility before Paused→Active.
- **TCH-0157** — Canonically accounted for as unavailable. The task is conditional “if retained for release”; no retained D06/freeze decision exists. D10 therefore rejects Reduced Load Week with `TEACHING_D10_REDUCED_LOAD_WEEK_NOT_RETAINED` instead of inventing policy.
- **TCH-0158** — Implemented teacher-change Request plumbing with prospective versioned Course Teacher assignments. Prior Teacher/history records remain unchanged. D22 still owns the later full persistent Teacher-Identity/transition product.
- **TCH-0159** — Implemented assignment-extension Request envelope, target binding and decision/history handoff only. D16 remains Work owner; D10 cannot fabricate an assignment deadline mutation before that owner exists.
- **TCH-0160** — Implemented early-dismissal Request envelope and Classroom contextual hook only. D10 does not fabricate attendance/participation outcomes.
- **TCH-0161** — Implemented retrospective attendance-review/correction Request envelope and correction contextual hook only. D15 remains authoritative Attendance Ledger owner.
- **TCH-0162** — Implemented Alternative Proposed with immutable alternative version, explicit student accept/decline and no mutation before acceptance. Decline closes without target mutation; acceptance applies only the referenced alternative and revalidates before commit.
- **TCH-0163** — Implemented Request history/audit with actor/authority, server time, prior/new state, target version, bounded explanation/decision metadata and application reference. Hidden reasoning is not stored.
- **TCH-0164** — Implemented setup Stage 6 Academic Rules and Teacher. The KIWI default grading declaration uses the Blueprint weights and is versioned/locked at activation; D20 remains grading-calculation owner. When no Teacher exists, D10 creates a deterministic non-model Teacher shell rather than invoking an unqualified D22 route.
- **TCH-0165** — Implemented setup Stage 7 Final Review using server-authoritative D08/D09/D10 readiness facts and blockers.
- **TCH-0166** — Implemented secondary Request Center with pending/action/decision/application/closed state presentation and explicit alternative actions.
- **TCH-0167** — Implemented contextual Request entry contracts. Calendar binds Class reschedule/emergency absence, Course binds Break/Pause/Resume/Teacher Change/Cancellation, and reusable Assignment Extension/Classroom Early Dismissal/Attendance Correction hooks are exported for later surfaces without duplicating Request truth.
- **TCH-0168** — Covered by D10 unit/integration checks for unique one-application-per-Request persistence, replay short-circuit, stale versions, no mutation on rejected/withdrawn/declined states and D05 due-event reconciliation.
- **TCH-0169** — Covered by D10 unit checks proving emergency absence explicitly carries no automatic behavior penalty while preserving an Attendance/recovery owner handoff.
- **TCH-0578** — Teaching shell + Today structural anchor mockup completed in the D10 design-gate artifact.
- **TCH-0579** — Course Home structural anchor mockup completed.
- **TCH-0580** — normal Live Classroom structural anchor mockup completed as design only; no D11 controller/runtime is pulled forward.
- **TCH-0581** — first-three-anchor structure/authority validation recorded and passed at the design-contract level.
- **TCH-0904** — Implemented versioned four-concurrently-enrolled-Course admission at readiness/activation/resume. Ready, Active, Paused and unresolved Incomplete count; Draft/Completed/Archived and explicitly closed Incomplete/cancelled Course closure do not. The schema has no four-Course structural maximum and D09 eight-Course stress capability remains intact.

## Acceptance posture

D10 application of an approved implemented-owner Request is idempotent through a unique application row and request-version checks. Future-effective changes are scheduled through the D02/D05 durable `teaching.request.effective_due` event path and browser time cannot make them effective early.

Rejected, withdrawn and declined Requests cannot enter application state. Alternative Proposed cannot mutate the target before explicit acceptance. Stale target/request versions fail closed.

The migration uses RLS, owner-scoped authenticated SELECT and server/domain-only authoritative mutation. D10 history/application/activation records are immutable. Recovery is forward-corrective once academic D10 data exists.

The open D03/TPF-20 correction and D30 empirical model-route qualification hold remain outside D10. D10 does not claim D31 production release.


## FK/lineage hardening

After the base D10 migration, `20260929_teaching_d10_fk_lineage_hardening.sql` added leading indexes for the new D10 foreign-key paths plus relational lineage constraints for Class → D09 timetable/slot, Class/Course → D10 activation, and Request-linked teacher/lifecycle/closure/admission records. This is a forward corrective migration; it does not rewrite or delete predecessor history.
