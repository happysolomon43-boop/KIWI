# KIWI Teaching D15 — Attendance, Lateness, Participation, and Interruption

Delivery: **D15**. Exact scope: **TCH-0059, TCH-0274–TCH-0296 only**.

D15 introduces the **Attendance Ledger** as the single authoritative owner of Teaching attendance and punctuality truth. It does not own Class lifecycle, Lesson planning, Classroom interactions, Student Knowledge Model state, Assessment Attempt state, rubric marks, or Gradebook calculation. Those remain with their existing domain owners.

## Authority model

The authoritative D09 timetable determines whether a Class attendance obligation exists. A Class that was formally rescheduled, cancelled by an approved schedule change, covered by an approved Academic Break, or system-cancelled cannot be reconstructed later as an absence from an obsolete event template.

D11 owns scheduled Class start/end and live Lesson Controller execution. D15 is invoked from the D11 scheduled-start handler to create the server-side attendance obligation record even when no student browser joins. D14 owns Classroom JOIN/LEAVE/technical/interaction facts and forwards only the already-persisted server timestamp and interaction identity to D15. D10 owns formal Request lifecycle and authorization; approved attendance-target Requests are transactionally delegated to the D15 owner. D09 owns schedule feasibility and schedule debt/recovery capacity. D15 sends actual missed-instruction minutes to that owner and never invents a separate recovery-capacity percentage.

All attendance classification uses authoritative server/schedule timestamps. The browser has no endpoint or database grant that can directly write an attendance outcome.

## Versioned policy

D15 reads the accepted D06 decision registry rather than inventing thresholds.

`lateness.v1` uses server time and `min(5 minutes, ceil(10% of scheduled Class duration))`. Arrival exactly at the grace threshold remains On Time; arrival after it is Late. Material lateness begins at the configured 25% duration ratio. Lateness alone never becomes absence.

`attendance-concern.v1` ships Attendance Concern, not Attendance Probation. Three behavior-relevant incidents in the most recent six required obligations trigger schedule/recovery review. Counted incidents are Late, Material Lateness, Unexcused Absence, and student-caused Partial Attendance. It cannot reduce subject marks.

## Persistent truth and correction model

`teaching_attendance_records` is an immutable versioned ledger. Each attendance obligation is bound to the Class schedule version and, where present, the authoritative timetable version/slot. A later correction appends a new version with `supersedes_record_id`; the original row remains auditable. Idempotency keys prevent duplicate event replay from creating parallel truth.

`teaching_attendance_concerns` stores policy-bound support/escalation facts. `teaching_attendance_system_interruptions` stores only trusted KIWI Runtime or Platform Operations interruption evidence. Browser roles receive no authoritative DML grants on any D15 table.

A verified KIWI outage appends a System-Protected correction and reconciles any previously created D09 attendance-recovery debt back to zero. A stale/rescheduled attendance finalization event appends a no-obligation/rescheduled correction rather than manufacturing an absence.

## Participation and interruption semantics

Presence is not certified merely because the page opened. Meaningful participation can be established by bounded already-authorized evidence such as student responses, activity/teacher-led interaction, readiness/finished signals, help/teacher interactions, and Class closure presence. D15 does not use camera surveillance, eye tracking, keystroke surveillance, or tab focus as proof of absence.

During independent practice or a Break, silence is expected and inactivity does nothing. Where the authoritative Controller says interaction is expected, prolonged inactivity can enter a bounded **Still working?** / Interrupted path. The transition does not directly create Unexcused Absence.

A browser-reported technical issue is initially an uncertain interruption; it cannot declare itself system-protected. System protection requires trusted runtime/operations evidence.

## Lateness, partial attendance, and recovery

Late arrival records lost instructional time and immediately supplies D11 with authoritative attendance facts for live Lesson replanning. D15 does not implement a second Lesson Planner and never extends the scheduled Class clock to repay lateness automatically. D11's existing overtime rules remain authoritative.

Early departure records actual exit and can become Partial Attendance. An approved Early Dismissal Request remains behavior-protected while still preserving the learning consequence of missed instruction.

Emergency Absence is a D10 formal Request with a privacy-minimizing fast path. D15 records the resulting Excused Absence without demanding sensitive proof. Excused or approved absence removes the behavioral interpretation but does not pretend missed learning was restored.

Any makeup requirement is **diagnostic-first**. D15 exposes the missed-attendance/recovery fact; D11 remains owner of the makeup Lesson Blueprint and may determine full instruction, subset instruction, targeted practice, or independent verification.

## Student-facing projection

Attendance is shown in **Course Results** and the global **Record**. There is no permanent top-level Attendance destination.

The projection reads the D15 ledger rather than recalculating attendance in the browser. It preserves distinctions among required obligations, On Time, Late, Partial, Unexcused Absence, Excused Absence, Approved Leave, Rescheduled/No Obligation, Interrupted, and System-Protected outcomes. It exposes corrections as corrections and intentionally suppresses a gamified attendance score or naïve percentage.

An open Attendance Concern explains the observable scheduling problem, missed instructional time, and valid next actions such as schedule review or Requests. It does not characterize the student's intelligence, motivation, effort, or personality.

## Task accounting

- **TCH-0059** — adds the immutable Attendance Ledger, Attendance Concern store, trusted system-interruption store, RLS/grants, lineage and indexes.
- **TCH-0274** — resolves obligation from the authoritative Class/timetable schedule version and lifecycle.
- **TCH-0275** — D11 scheduled Class start creates D15 PENDING attendance even without JOIN.
- **TCH-0276** — evaluates the accepted configurable/versioned `lateness.v1` policy with server time and deterministic edge behavior.
- **TCH-0277** — preserves On Time, Late, Partial, Unexcused Absence, Excused Absence, Approved Leave, Interrupted/System-Protected and no-obligation/rescheduled distinctions.
- **TCH-0278** — requires meaningful bounded participation evidence without invasive surveillance.
- **TCH-0279** — keeps attendance distinct from participation/Classwork, D13 SKM, D17 Assessment Attempt truth and Gradebook marks.
- **TCH-0280** — stores concrete lost instructional time/recovery facts without arbitrary subject-mark deductions.
- **TCH-0281** — late arrival delegates live Lesson replanning to D11.
- **TCH-0282** — records `automatic_overtime=false`; D11 retains the only overtime authority.
- **TCH-0283** — records early departure and Partial Attendance honestly.
- **TCH-0284** — applies privacy-minimizing Emergency Absence via D10 Request authorization and exposes recovery need.
- **TCH-0285** — retrospective correction appends a superseding ledger version and preserves audit history.
- **TCH-0286** — distinguishes uncertain network/client interruption from trusted KIWI-system protection and reverses avoidable recovery debt for verified outages.
- **TCH-0287** — inactivity is context-aware; tab focus is never absence proof.
- **TCH-0288** — implements bounded Still-working/Interrupted transition rather than timer-to-absence.
- **TCH-0289** — evaluates accepted `attendance-concern.v1` behavior and opens/resolves non-punitive schedule/recovery review facts without marks or probation.
- **TCH-0290** — exposes approved deferral count for the same academic obligation and explicitly disallows indefinite automated deferral or motive inference.
- **TCH-0291** — exposes diagnostic-first makeup readiness while D11 remains Lesson Planner owner.
- **TCH-0292** — reconciles actual missed minutes into D09 schedule debt/recovery capacity without a D15 percentage algorithm.
- **TCH-0293** — every public attendance record declares that no Assessment Attempt was created; D17 remains assessment owner.
- **TCH-0294** — adds Course Results and global Record attendance/punctuality projections from the authoritative ledger.
- **TCH-0295** — adds actionable, non-punitive Attendance Concern explanation/actions and no attendance score.
- **TCH-0296** — unit/integration coverage exercises grace boundaries, absences, corrections, interruptions, repeated lateness, partial attendance, outage protection and predecessor/domain boundaries.

## Explicit non-ownership boundaries

D15 does not implement D16 Homework/Classwork submission or academic-integrity truth. It does not create D17 Assessment Attempts or make-up packages. It does not write D13 SKM. It does not calculate D20 Gradebook marks. It does not implement D21 progression. It does not pull forward D25 interruption orchestration, D26 Recovery Case ownership, D27 external Study publication, D30 model qualification, or D31 production-release authorization.

D15 contains no new model route. Attendance classification and policy evaluation are deterministic.