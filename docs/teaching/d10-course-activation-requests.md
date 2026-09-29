# D10 — Course Activation, Lifecycle & Formal Requests

D10 implements the authoritative boundary between setup and an active Teaching Course, plus one durable formal Request aggregate for post-activation academic changes. It consumes D08 Course Plan/Coverage truth and D09 Scheduler/Calendar truth; it does not replace either owner.

## Delivered task accounting

TCH-0060: one authoritative teaching_requests aggregate, transition history, exactly-once application ledger, alternative proposal/version, target owner/ref/version, effective time, application reference and owner-scoped read model.

TCH-0146: canonical Course lifecycle with recoverable Incomplete branch and explicit administrative closure record that preserves Incomplete.

TCH-0147: status overlays remain a separate Course column/axis.

TCH-0148: progression outcome remains a separate nullable axis reserved for the later Progression owner.

TCH-0149: deterministic activation transaction locks the current Course Plan/scope version, grading-policy version, timetable version/obligations, teacher assignment/identity, admission policy and server activation time; authoritative Classes are materialized from the approved timetable.

TCH-0150: D09 direct editing remains pre-activation only; active Course availability/timetable UI routes into formal Requests.

TCH-0151: Request lifecycle implements Draft → Submitted → Reviewing → decision → Applied/Closed with explicit legal transitions and version checks.

TCH-0152: single-Class reschedule binds Class schedule version, revalidates through D09 scheduling, and can produce a concrete nearby Alternative Proposed before mutation.

TCH-0153: permanent availability change captures a full D09 scheduling input proposal and performs global schedule recomputation through D09 structures before exactly-once application.

TCH-0154: Academic Break uses D09 BREAK constraints and deterministic global feasibility/recovery analysis before approval/application.

TCH-0155: emergency absence fast path requires no proof interrogation, cannot create automatic behavior penalty, and records that Attendance plus learning-recovery handoff remains for later owners.

TCH-0156: Course Pause/Resume uses lifecycle history, preserves prior records, stales/reviews schedule truth rather than deleting it, and rechecks schedule/admission before resume.

TCH-0157: Reduced Load Week is intentionally unavailable because the retained-release decision is unresolved. D10 fails closed instead of inventing policy.

TCH-0158: teacher change creates a prospective versioned assignment while retaining historical teacher lineage.

TCH-0159: assignment-extension Request envelope and owner handoff are present; D16 remains Work authority and D10 does not create a duplicate assignment system.

TCH-0160: early-dismissal Request envelope and owner handoff are present; D15 remains Attendance authority.

TCH-0161: retrospective attendance-review/correction Request envelope and owner handoff are present; D15 remains Attendance authority.

TCH-0162: Alternative Proposed stores an exact proposal version. Accepting that version is required before adjusted application; declining closes without target mutation.

TCH-0163: Request history records state/version, actor type, authority, reason/explanation, target version, application reference and server timestamp without hidden reasoning.

TCH-0164: Course setup Stage 6 presents declared academic rules and Teacher assignment.

TCH-0165: Stage 7 presents server-authoritative readiness from D08/D09/D10 and exposes Ready/Start Course actions only when allowed.

TCH-0166: Request Center renders authoritative Request state, decisions, alternatives, effective/application status and legal next actions.

TCH-0167: Course and Calendar contextual Request actions are live. The D10 browser API also exposes target-bound entry hooks for later Assignment/Classroom surfaces without implementing D11/D15/D16 early.

TCH-0168: repository/unit and schema tests cover exactly-once Request applications, replay, alternative acceptance, server-effective time and no browser DML.

TCH-0169: tests enforce no-proof/no-automatic-behavior-penalty emergency semantics and explicit later learning-recovery handoff.

TCH-0578: Teaching shell + Today structural anchor mockup recorded in the D10 anchor artifact.

TCH-0579: Course Home structural anchor mockup recorded and aligned with the existing Course workspace.

TCH-0580: normal Live Classroom structural anchor mockup recorded without implementing D11 runtime.

TCH-0581: the three anchors are validated for KIWI relationship, hierarchy, density, academic-authority visibility and non-gamified serious states.

TCH-0904: four-course-launch.v1 is a versioned controlled-rollout policy, not a schema maximum. Ready/Active/Paused/unresolved Incomplete count; Draft/Completed/Archived and explicit closure release capacity. One student identity is used for counting and D09 eight-Course stress behavior remains independent.

## Authority and future-delivery boundaries

D10 introduces no model/provider call and modifies no frozen prompt. D03's TPF-20 correction hold, D30 empirical route qualification and D31 product release remain open and separate. D11 still owns the live Teaching Controller. D15 still owns Attendance outcomes. D16 still owns Work/Assignment mutation. D20 still owns Gradebook calculation. D21 still owns progression outcomes. D22 still owns full Teacher Identity personality/transition behavior; D10 only creates/locks the minimal deterministic pre-activation assignment shell required by the activation contract.
