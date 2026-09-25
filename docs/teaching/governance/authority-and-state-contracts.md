# Academic Authority and State Contracts

## One authoritative owner per fact

- Scheduler / Calendar owns approved academic time and timetable events.
- Course Plan version owns approved curriculum scope and scope version.
- Teacher Identity owns persistent teacher characteristics/profile.
- Class Session owns historical execution of a scheduled Class.
- Attendance Ledger owns attendance and punctuality outcomes.
- Assignment / Submission owns Work lifecycle and submitted assignment responses.
- Assessment Package owns the locked formal assessment definition.
- Assessment Attempt owns formal submitted answers and attempt events.
- Gradebook owns official marks and calculated official Course result.
- Student Knowledge Model (SKM) owns current learning inferences and evidence confidence.
- Progression Engine / Course Outcome owns official post-Course progression decisions.
- Request owns formal proposed changes, decisions and application status.
- Semester owns Course grouping for global scheduling and Semester Record/GPA context.

Today, dashboards, notifications, AI Teacher prose, Course Overview and Record are readers/translators of these truths; they do not manufacture competing values.

## Three academic truths

**Gradebook truth** answers what official academic marks were legitimately earned under the configured rules. It is historical and policy-bound.

**Knowledge Model truth** answers what current evidence suggests the student knows, retains, transfers, misunderstands or still needs verified. It is current and evidential.

**Progression truth** answers what happens next based on official results, essential outcomes, assessment completeness, evidence sufficiency and configured rules.

Invariant: `Gradebook != Student Knowledge Model != Progression Engine`. No percentage or convenience field may collapse them.

## State-axis separation

### Course

Base lifecycle: `Draft → Ready → Active ↔ Paused → Teaching Ended → Finalizing → Completed → Archived`, with recoverable `Finalizing → Incomplete → Finalizing`. Explicit closure may archive an unresolved Incomplete without rewriting it as Completed/Fail.

Operational overlays are separate, e.g. Schedule at risk, Attendance concern, Recovery capacity low, Major assessment pending, Course scope update pending.

Progression outcome is a third axis, e.g. Pass, Pass — Remediation Required, Resit Required, Recovery Required, Repeat Required.

### Class

Scheduled-session lifecycle: `Scheduled → Pre-Class → Active → Ended`, with explicit `Cancelled` and `System-Cancelled` exceptions.

Instructional substate while Active can include Opening, Diagnostic, Instruction, Guided Practice, Independent Practice, Classwork, Remediation, Break, Assessment, Closure and Interrupted.

Attendance outcome is independent: On time, Late, Partial attendance, Unexcused absence, Excused absence, Approved leave, System-protected interruption.

### Assignment

Primary lifecycle: `Assigned/Upcoming → Open → Started → Submitted → Marking → Returned → Closed`.

Correction branch: `Returned → Correction Available → Resubmitted → Marking/Verification → Returned or Verified → Closed`.

Late, Expired, Excused, Replaced, Invalidated and Missed are orthogonal conditions, not substitutes for lifecycle.

## Non-negotiable fairness and presentation rules

KIWI-caused failure cannot directly create student academic penalty. Broken generated questions, system outages, autosave/network failures, incorrect KIWI instruction and similar faults require explicit fair recovery.

Teacher Personality and interaction style cannot alter marks, standards, attendance facts, progression logic, assessment restrictions, accommodations, exit requirements or schedule feasibility.

Formal academic actions/consequences must be explainable in human academic language with concrete academic basis and next action.

Hidden confidence values, weights, vectors, internal state identifiers or detector-like quantities must not be exposed as false-certainty student metrics.

## Academic invariants inherited by every later delivery

- Coverage: required meaningful approved content cannot silently disappear.
- Assessment eligibility: graded scope is taught or formally validated prior knowledge except explicit non-graded Diagnostic use.
- Personalization: Intake/preferences may adapt instruction, not lower standards or remove required content.
- AI output is never automatically authoritative state; owner validation/commit remains mandatory.
