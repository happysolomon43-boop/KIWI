# KIWI Teaching D09 — Semester, Scheduling, Pacing & Time

Status: implementation delivery D09 only. Hard predecessor D08. D10 activation/lifecycle/Requests are deliberately not implemented here.

## Authoritative boundaries

Scheduler/Calendar owns Semester scheduling facts, availability constraints, timetable proposals/versions, feasibility and schedule debt. The canonical `teaching/modules/scheduling` seam now exposes the implemented D09 Scheduler authority rather than remaining a descriptor-only placeholder. Course Plan/Coverage remains D08-owned. Student Knowledge Model remains a later owner. Attendance remains a later owner. PPL coordinates preparation around the same rolling horizon and never becomes a second Scheduler. The server clock and stored timezone-aware timestamps remain authoritative; browser/device time is display-only.

D09 consumes current D08 Course Plans and their Learning Unit dependency/load ranges. It never reads raw Subject scope to delete, add or compress curriculum for scheduling convenience. Required academic work remains represented even when feasibility is impossible.

## Task accounting

- TCH-0119: versioned Semester creation/grouping; Courses attach pre-activation without activating.
- TCH-0120: recurring AVAILABLE, RECOVERY_ONLY and HARD_UNAVAILABLE windows plus soft preferences.
- TCH-0121: explicit BREAK, HOLIDAY and Semester-boundary constraints.
- TCH-0122: workload uses Learning Unit instructional-load ranges and D08 instructional treatment, not Topic count.
- TCH-0123: deterministic feasibility is calculated before activation and proposal commits revalidate Semester, latest schedule-profile, complete Semester Course set, Course state and latest Course Plan versions inside the authoritative transaction; stale inputs fail with `TEACHING_D09_STALE_SCHEDULING_CONTEXT`.
- TCH-0124: recalculation first retains prior feasible timetable slots, then fills remaining capacity using hard constraints, headroom, preferences and same-Course spacing, reducing visible timetable churn.
- TCH-0125: D06 recovery-headroom.v1 is used exactly: 20% target, 15% minimum.
- TCH-0126: impossible single-Course states remain infeasible and return alternatives.
- TCH-0127: impossible multi-Course states remain infeasible and return alternatives.
- TCH-0128: timetable slots carry rolling-horizon maturity while visible timetable commits remain versioned.
- TCH-0129: API exposes separate calendar progress, curriculum Coverage, and verified-learning availability; D09 never fabricates SKM truth.
- TCH-0130: schedule debt is an immutable internal ledger; raw debt minutes are not default student UI.
- TCH-0131: ahead behavior builds buffer or optional transfer/enrichment; acceleration requires trustworthy evidence.
- TCH-0132: behind diagnosis uses implemented schedule facts only before timetable change; no invented Attendance/SKM state.
- TCH-0133: scheduler allocates actual Learning Unit load rather than reducing required work below the Course Plan load to fit.
- TCH-0134: REVISION and ASSESSMENT reserve minutes are first-class from setup.
- TCH-0135: protected revision/assessment blocks reject unrelated work while permitting their intended reserve kind.
- TCH-0136: recovery capacity is separate; alternatives distinguish a justified recovery-capacity exception from required scope deletion.
- TCH-0137: HARD deadlines are never silently moved; FLEXIBLE targets may be surfaced as an alternative.
- TCH-0138: Semester, slots and classes retain timezone-aware timestamps plus an IANA timetable timezone.
- TCH-0139: current/device timezone is a display projection only; it cannot create authoritative lateness.
- TCH-0140: course scheduling surface implements Course setup · Stage 4: Semester and Availability.
- TCH-0141: course scheduling surface implements Course setup · Stage 5: Proposed Timetable and Feasibility.
- TCH-0142: pre-activation slot shifts are directly editable and immediately revalidated.
- TCH-0143: Calendar reads approved Class rows as authoritative and clearly separates pre-activation proposals.
- TCH-0144: tests cover sparse availability, conflicting Courses, long breaks, hard deadlines, recovery-capacity exhaustion, stable timetable retention, stale-version/course-set invalidation and replay-stable PPL event identity.
- TCH-0145: tests cover DST-nonexistent/ambiguous local time and current-timezone projection.
- TCH-0889: existing PPL scheduling-horizon persistence/event mechanisms are reused; PPL does not become Scheduler authority.
- TCH-0903: deterministic global arbitration schedules by instructional load, normally no more than two full Teaching Classes per day, prefers same-Course spacing and retains an eight-Course stress test.

## Feasibility and failure behavior

Hard constraints are applied before preferences. D06 headroom policy is applied before a timetable may be considered feasible. If load cannot fit without dropping below minimum recovery headroom, missing a hard deadline, violating Semester/availability constraints or deleting required work, the result is INFEASIBLE. The persisted result includes actionable alternatives while the authoritative Course Plan remains unchanged.

The normal global maximum is two full Teaching Classes per local day; revision/assessment reserve slots do not consume that Class-count limit. Direct pre-activation edits are deterministically revalidated. Frozen TPF-10 v1.1 and TPF-05 v1.3 advisory request builders are non-committing seams for later D30 qualification; core D09 feasibility never depends on a model call.

## Rolling horizon and PPL

D09 reuses teaching.preparation.scheduling_horizon version 1.0. Authoritative Semester, schedule-profile, Course Plan and timetable references are captured in the existing PPL input-bundle schema. Initial input creates the scheduling workspace; material schedule changes create a new input bundle and canonical preparation events through the D05 transaction/outbox boundary. PPL cannot commit timetable truth and does not own deterministic feasibility.

## UI safety

Stage 4 edits are pre-activation only. Stage 5 proposes/edits timetable candidates. Calendar labels pre-activation proposals separately from approved Class rows. Current timezone is display-only. Schedule health exposes a plain debt state and alternatives, never a raw debt score as a student-facing performance metric.


## Corrective closure hardening

The D09 closure audit found four gaps after the initial merge: the canonical scheduling module seam was still descriptor-only, stale input versions were not revalidated at proposal commit, timetable recalculation did not actually preserve prior feasible placements, and the required stale/replay/edge-case regressions were incomplete. The same audit also found an undefined `priorChildrenFull` reference in Stage 4 persistence. The corrective delivery fixes those issues without changing D09 authority or pulling D10 forward. Stage 4 changes now mark current timetable versions STALE, proposal persistence revalidates current authoritative versions under row locks, schedule review fails closed when Course Plan/profile references drift, and recalculation uses prior timetable history only as a soft stability source after current hard constraints remain satisfied.
