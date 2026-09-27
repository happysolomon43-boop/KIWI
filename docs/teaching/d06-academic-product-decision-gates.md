# KIWI Teaching — D06 Academic/Product Decision Gate Closure

**Delivery:** D06  
**Version:** 1.0  
**Date:** 2026-09-27  
**Machine-readable authority:** `teaching/policy/d06-decision-registry.json`

D06 closes the 27 deliberately open product/academic gates without implementing the later systems that consume them. The registry is policy/configuration, not Gradebook, Scheduler, Attendance, SKM, Assessment, Progression, Course Plan, Request, renderer or integration truth.

## Policy consumption rule

Later deliveries must resolve the relevant TCH decision from the versioned D06 registry before implementing behavior. An unknown decision fails closed. A lower-level UI, model, prompt task, Course preference or untrusted input cannot grant a permission or authority not present in the governing domain contract.

The registry can be superseded only by explicit versioned change control. It may not be edited silently to make later implementation easier.

## Closed gate dispositions

### TCH-0071 — default grade scale

**CONFIGURED.** KIWI's fallback is `KIWI_PERCENTAGE_100_V1` (0–100). There is no default letter grade, grade point or GPA mapping. Grade points and Semester GPA require an explicit configured institutional/Course scale. Gradebook remains the owner.

### TCH-0072 — terminal assessment minimum

**DECIDED.** KIWI has no global terminal-assessment minimum. A Course/institution may deliberately configure one before the relevant assessment policy takes effect; it is never invented retroactively.

### TCH-0073 — Topic evidence sufficiency

**CONFIGURED.** A final Topic academic score requires at least three grade-contributing evidence events, at least two distinct assessment contexts, at least two separate academic occasions, and at least one controlled independent evidence event. Otherwise the Topic result is provisional/insufficient. A versioned Course policy may override the calibration, but one tiny item may not finalize a major Topic.

### TCH-0074 — initial SKM update algorithm

**CONFIGURED.** SKM v1 is an evidence-quality state machine using canonical states `UNSEEN → INTRODUCED → ASSISTED → EMERGING → INDEPENDENT → SECURE → TRANSFERABLE` plus `FRAGILE`, `BLOCKED`, and `REGRESSED` overlays. Transitions depend on evidence quality, independence, delay, variation and contradiction, not copied Gradebook percentages. Time alone reduces certainty; it does not decree forgetting.

### TCH-0075 — Scheduler recovery headroom

**CONFIGURED.** Normal planning reserves 20% of schedulable instructional capacity as recovery headroom, with a 15% minimum. If required work cannot fit while preserving the minimum and hard constraints, Scheduler surfaces risk/infeasibility rather than deleting required curriculum or violating constraints.

### TCH-0076 — lateness

**CONFIGURED.** Server time is authoritative. Default grace is the smaller of five minutes or 10% of scheduled Class duration, rounded up to whole minutes. Arrival after grace is Late; 25% elapsed is material lateness. Lateness alone never silently becomes absence, and approved/system-caused delay cannot create penalty.

### TCH-0077 — Attendance Concern/Probation

**CONFIGURED.** Attendance Concern ships in the first release. Default trigger is three behavior-relevant incidents across six attendance obligations. The consequence is timetable review and, where content was missed, learning-recovery review. It never deducts subject marks. Attendance Probation does not ship initially and remains deferred to the D15 behavior-policy implementation.

### TCH-0078 — coursework correction mark recovery

**DECIDED.** Default correction mark recovery is none. Corrections may improve learning evidence but preserve the original attempt and mark. A Course may deliberately enable a versioned recovery rule before work is graded; retroactive rule creation is prohibited.

### TCH-0079 — graded impromptu assessment budget

**CONFIGURED.** Default maximum is one graded impromptu assessment per three completed scheduled Classes, never in consecutive scheduled Classes. It may use at most 20% of the Class block and the default Gradebook category remains capped at 10% of Course weight unless external policy overrides. Scope must already be eligible and the package must be ready/validated before Class.

### TCH-0080 — high-stakes moderation

**DECIDED.** Mid-Semester and Final constructed-response marking requires independent blind-first moderation. Any other assessment explicitly designated high stakes uses the same posture. The initial marker/generator cannot be the sole moderator. Material unresolved disagreement yields `REVIEW_NEEDED` and blocks finalization.

### TCH-0081 — academic-integrity verification

**DECIDED.** Signals and model outputs cannot prove misconduct. A material concern creates `VERIFICATION_REQUIRED`, followed by proportionate controlled re-demonstration, provenance/attempt review, or rule-compliance review. Uncertainty remains `REVIEW_NEEDED`; no automatic zero/failure is allowed from a signal.

### TCH-0082 — accommodations

**CONFIGURED.** Students may control construct-neutral access preferences. Academic accommodations that alter time, resources or assessment conditions require a trusted authorized record. Initial fields cover scope/effective dates, extra-time multiplier, display/text scaling, assistive technology, interaction/input format, approved breaks, allowed resources, provenance and authorization. Teacher Personality cannot override them.

### TCH-0083 — active Course cancellation

**DECIDED.** Cancellation is a formal Request and does not invent a new Course base lifecycle state. At the authoritative effective time an Active/Paused Course follows `Teaching Ended → Finalizing → Incomplete`, with an immutable cancellation closure reason. Future obligations are superseded/cancelled; historical marks, attempts, attendance and audit remain. There is no default final Course result or GPA contribution. Explicit administrative archival may preserve the unresolved Incomplete condition but cannot convert it to Completed or Fail.

### TCH-0084 — Teaching retention/deletion

**EXPLICITLY DEFERRED.** Exact retention periods and destructive deletion schedules are not invented in D06 because the Blueprint explicitly requires privacy/legal/product policy. Until D28 closes that mapping, no Teaching-specific automatic destructive deletion job is authorized. Academic/audit lineage remains protected, protected-preparation remains isolated/minimized, and category-aware account-deletion handling must respect the then-current KIWI account/privacy policy.

### TCH-0085 — voice/avatar first-release scope

**EXPLICITLY DEFERRED.** Voice and Teacher avatar are post-release. Core Teaching cannot depend on either. A future activation requires accessibility, privacy, latency, cost and fallback contracts.

### TCH-0086 — first-release response renderers

**DECIDED.** First release includes MCQ, short constructed text, extended text/essay, multi-part, numeric+unit, mathematical working/final answer, and source-supported constructed response. Executable code responses and freeform visual/diagram responses are deferred; the first release preserves schema extension points for them.

### TCH-0087 — global Exams destination

**DECIDED.** Teaching reuses KIWI's shared Exam/CBT renderer technology but formal Teaching assessments are launched/surfaced through Teaching in the first release. No duplicate global Exams truth record is created; Teaching Assessment remains authoritative.

### TCH-0088 — Teaching → KS

**EXPLICITLY DEFERRED.** No read/write integration is authorized by D06. D27 must define the exact evidence, identity, authority, event, replay/idempotency, conflict, privacy, versioning and deletion contract before any write.

### TCH-0089 — Teaching ↔ Mastery Bubbles

**EXPLICITLY DEFERRED.** No cross-system write is authorized. D27 owns exact contract definition.

### TCH-0090 — Teaching ↔ FSRS/cards

**EXPLICITLY DEFERRED.** No card/scheduling write is authorized. D27 must define card identity, scheduling authority, evidence, replay and conflict semantics.

### TCH-0091 — Teaching ↔ Brain

**EXPLICITLY DEFERRED.** No Brain synchronization/write is authorized. D27 owns exact contract definition.

### TCH-0092 — Teaching ↔ Biome

**EXPLICITLY DEFERRED.** No Biome synchronization/write is authorized. D27 owns exact contract definition.

### TCH-0093 — final visual system

**EXPLICITLY DEFERRED.** The final visual system is not frozen before anchor validation. D24 may freeze it only after representative Today, Course Overview, Live Classroom, Assessment Shell, Work and Record surfaces pass responsive/accessibility/context-preservation evidence.

### TCH-0691 — source meaningfulness classification

**DECIDED.** Every inventoried source item must be classified as academically meaningful, duplicate, administrative, formatting-only, obsolete, or outside approved Course scope. Duplicate/excluded states require explicit reason/provenance. AI classification is not itself authoritative and silent dropping is prohibited.

### TCH-0692 — Validated Prior Knowledge minimum

**CONFIGURED.** Student Intake self-report is not evidence. VPK requires at least two independent verification opportunities covering distinct probes/criteria, with varied or uncued evidence where the construct supports it, all critical criteria passing, no unresolved material contradiction, and provenance for any accepted external evidence. Course-context calibration may be versioned but cannot convert self-report into VPK.

### TCH-0693 — unresolved required content at planned end

**DECIDED.** Planned end date does not imply completion. Required content that is neither Taught nor Validated Prior Knowledge causes the Course to follow `Teaching Ended → Finalizing → Incomplete`. Incomplete is not Fail and may re-enter Finalizing when the missing valid process/evidence is resolved.

### TCH-0694 — assessment-eligibility exceptions

**DECIDED.** First release has no graded eligibility exception outside `Taught` or `Validated Prior Knowledge`. An explicit prerequisite must first be validated before graded use. Ungraded Diagnostic may probe untaught/unvalidated prerequisite knowledge. Raw Subject scope never grants eligibility.

## Boundary checks

D06 does not:

- implement Gradebook calculations, SKM mutation, Scheduler runtime, Attendance runtime or Assessment runtime;
- rewrite any frozen TPF prompt;
- add or qualify any Teaching AI route;
- change the 169/147/22/19 capability/prompt baseline;
- create a database policy table or migration;
- create KS/Mastery/FSRS/Brain/Biome writes;
- create a new Course lifecycle axis;
- begin D07.

## Acceptance condition

D06 is complete when the registry passes structural/invariant tests, every D01–D05 verifier still passes, the Teaching/full regression suites and web build pass, accepted-main CI passes, and no D06-attributable P0/P1 defect remains.
