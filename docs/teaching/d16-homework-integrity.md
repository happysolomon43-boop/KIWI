# KIWI Teaching D16 — Homework, Independent Work & Academic Integrity

D16 implements the authoritative Homework/independent-work domain on top of D15 without reusing Attendance as Work truth. The Assignment owner is durable, server-authoritative, event-time aware, and explicitly separate from formal Assessment, Gradebook and Student Knowledge Model ownership.

## Delivery scope

D16 owns exactly 33 frozen tasks: `TCH-0050`, `TCH-0051`, `TCH-0297`, `TCH-0298`, `TCH-0299`, `TCH-0300`, `TCH-0301`, `TCH-0302`, `TCH-0303`, `TCH-0304`, `TCH-0305`, `TCH-0306`, `TCH-0307`, `TCH-0308`, `TCH-0309`, `TCH-0310`, `TCH-0311`, `TCH-0312`, `TCH-0313`, `TCH-0314`, `TCH-0315`, `TCH-0316`, `TCH-0317`, `TCH-0318`, `TCH-0319`, `TCH-0320`, `TCH-0321`, `TCH-0322`, `TCH-0323`, `TCH-0324`, `TCH-0325`, `TCH-0907`, and `TCH-0908`.

## Authoritative persistence — TCH-0050 and TCH-0051

`teaching_assignments` owns Assignment identity, Course/Class lineage, purpose, work stake, lifecycle, orthogonal conditions, effort range, deadline and policy versions, assistance mode, response kind, solution-release policy, grading eligibility, dependency references, replacement lineage and formal Request reference. `teaching_assignment_submissions` is append-only and versions DRAFT, FINAL, CORRECTION and VERIFICATION submissions. Every accepted submission records server acceptance event time and the integrity, deadline and assistance policies active at that event. Original attempts are never erased by correction or resubmission.

## Purposeful Homework — TCH-0297, TCH-0298, TCH-0299 and TCH-0907

Assignment purpose is explicit: Practice, Retrieval, Remediation, Preparation, Application, Production, Revision, Independent Evidence or Reading. Homework is not generated merely because a Class ended. D16 consumes authoritative Class closure, Course Plan/Learning Unit, SKM and current workload context and requires an actual learning/prerequisite/retention/declared-production reason before generation. Estimated effort is a minimum/maximum range. Purposeful Reading is a normal Assignment type, but reading completion is an activity fact and never automatic mastery or an official mark.

## Deadline and lifecycle semantics — TCH-0300 and TCH-0301

Soft, Hard and Pedagogically Expiring deadlines are distinct. Primary lifecycle is separate from orthogonal Late, Expired, Excused, Replaced, Invalidated, Missed, System-Protected and Paused conditions. Accepted submission event time is authoritative: later provider/model/evaluation processing cannot make an on-time submission late. Durable `ASSIGNMENT_DUE` events reconcile missed/late/expired state from server-owned Assignment facts; stale due events are superseded after deadline changes.

## Save/resume and assistance — TCH-0302 through TCH-0306

Long work is stored as versioned DRAFT submissions and can be resumed. Assistance modes are Open Learning Assistance, Hint-Only, Reference-Only, Closed-Book Independent and Formal Assessment. The controller decides allowed disclosure before any model invocation. The browser and conversational model cannot self-authorize a full answer. D16 does not take ownership of active Formal Assessment. Solution release is policy-timed and protected solution material is isolated from ordinary browser projections. Once the exact solution is exposed, the original task is no longer clean independent evidence and replacement rules apply.

## Integrity and authenticity — TCH-0307 through TCH-0312

D16 follows the frozen principle: verify capability; do not pretend to read minds. Rule alignment and capability/authenticity evidence are separate states. Detector outputs, paste/tab/timing/style/performance/similarity signals are contextual evidence only; each is explicitly non-authoritative proof. The persistence schema contains no cheating probability, guilt probability, authorship probability, misconduct score or permanent-student-label field. Student projections suppress contextual telemetry and pseudo-precision.

Unresolved capability evidence can trigger a proportional fresh verification targeted at the disputed capability. Wholesale reproduction is not required. Failed, refused or review-needed verification leaves prior evidence unresolved and does not prove prior misconduct. If an active formal Assessment exists, D16 defers verification to the authorized post-attempt path. Repeat-integrity automatic escalation remains disabled because the D06 gate defines no such repeat-incident policy.

## Retry, correction, late work and recovery — TCH-0313 through TCH-0317

Retry behavior depends on work type. Correction Mode preserves the original attempt; a correction produces a new submission version and must re-enter marking/verification before closure. Late-work disposition asks whether the work remains academically valid, whether solutions were exposed, whether dependencies advanced, whether the student is excused/system-protected/paused, and whether the work is graded. It does not invent a penalty.

Assignment Extension uses the D10 formal Request framework. D10 server-resolves the Assignment/version through the D16 owner, D16 previews pedagogical feasibility against solution release and dependency hard stops, and D16 applies an approved Request transactionally. Approved Academic Break and Course Pause/Resume are observed by D16 so ordinary Homework deadlines are moved or paused instead of creating an artificial overdue wall.

## Evaluation and evidence handoff — TCH-0318 and TCH-0319

Evaluation profiles are response-sensitive: long-form, code, quantitative/math-science working, humanities and reading-check work expose different criterion dimensions. D16 evaluation stores feedback and learning-evidence payloads but is structurally forbidden from committing an official Gradebook mark. Valid learning evidence can be handed to D13 through its owner seam. D16 planning signals can feed D11 for the Lesson → Homework → Evidence → Next Lesson loop without D16 directly mutating Lesson Planner or SKM truth.

## Student Work surfaces — TCH-0320, TCH-0321 and TCH-0322

The global Work destination and Course-scoped Work section both read the same D16 Assignment repository. Assignment detail shows purpose, work stake, deadline, effort, assistance mode, response kind, current submission, feedback, student-safe evidence status, extension Request controls and Correction Mode. Draft/save, final submission, assistance, correction and extension are intents sent to server owners; browser state is never authoritative.

## QA — TCH-0323, TCH-0324 and TCH-0325

The D16 unit suite directly tests answer requests in every assistance mode; event-time versus later processing; weak detector/telemetry signals; proportional verification; failed/refused verification without automatic guilt; solution-exposed late work replacement; extension solution/dependency boundaries; Course Pause protection; retry/correction preservation; subject-sensitive evaluation; reading-not-mastery; and distinct missed Optional, Preparation, Remediation and Graded outcomes. The integration suite verifies RLS, grants, append-only evidence tables, event-time policy fields, integrity-state constraints and the Gradebook-owner boundary.

## TCH-0908 outcome distinction

Missed Optional Work means less practice evidence. Missed Preparation Work informs next-Class adjustment. Missed Remediation leaves the targeted weakness unresolved. Missed Graded Work follows the authoritative grading-policy path. These outcomes are not collapsed into one generic missing-homework penalty, and replacement/exposure rules remain explicit.

## Authority boundaries preserved

D06 owns accepted policy decisions. D09 owns global scheduling/capacity. D10 owns formal Requests. D11 owns Lesson planning/controller truth. D13 owns the Student Knowledge Model. D20 owns official Gradebook marks. D17+ owns formal Assessment definition/package/attempt truth. D16 owns Assignment/Submission lifecycle and integrity/capability-evidence handling only within those boundaries.

## Model posture

D16 model-backed generation, assistance, verification-task generation and subject-sensitive evaluation use the canonical Teaching capability registry, prompt-family binding and Teaching Orchestrator request contract. Deterministic controller checks occur above the model. If no D30-qualified intelligence route is injected, model-dependent work returns the explicit route-held posture rather than silently selecting an unqualified provider/model.

## Security posture

All D16 owner tables have RLS enabled. `anon` and `authenticated` receive no direct authoritative DML. The service role can update the current Assignment owner row and append history/submission/integrity/evaluation/protected-solution records; evidence/history tables are not mutable ledgers. Protected solutions are not part of ordinary Work projections. Integrity telemetry is not rendered as a student guilt/authorship score.
