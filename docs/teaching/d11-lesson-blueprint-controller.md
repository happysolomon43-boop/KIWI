# KIWI Teaching D11 — Lesson Blueprint & Teaching Controller

Delivery D11 implements exactly the canonical D11 task set: TCH-0170 through TCH-0191, TCH-0888, and TCH-0905. It does not begin D12.

## Authority boundary

D11 consumes D07 Diagnostic/Validated Prior Knowledge facts, D08 Course Plan/Learning Unit truth, D09 Scheduler/Calendar/Class timing and schedule-debt truth, and D10 Course lifecycle/activation/Request application truth. D11 does not replace those owners.

D11 owns validated Lesson Blueprint lineage and the deterministic live Teaching Controller instructional aggregate. Model work is provisional until D11 schema/domain/provenance/current-state checks pass. The browser is not an academic-time owner and no model can mutate Controller state directly.

D13 Student Knowledge Model, D15 Attendance, D16 Work, D20 Gradebook and D21 Progression remain future authoritative owners. Missing future-owner inputs are represented as unknown/pending, never negative evidence.

## Task accounting

TCH-0170 — typed Lesson Planner input assembly consumes current Course Plan/Learning Units/prerequisites/dependencies, Diagnostic/VPK signals, Scheduler pacing/schedule-debt signals, D10 governed Request state, prior-Class closure facts and private Teacher Notes. D13/D16 lanes are explicit owner-pending and active-assessment answers are excluded.

TCH-0171 — TPF-05 Lesson Blueprint output is structurally validated for objectives, Learning Unit refs, prerequisite checks, misconception hypotheses, examples, guided work, independent-evidence opportunities, remediation branches, homework candidates, segments, timing and stopping conditions.

TCH-0172 — deterministic duration and minimum-safe-load checks reject plans that exceed authoritative Class duration or leave insufficient reserve.

TCH-0173 — CORE, SECONDARY and ENRICHMENT criticality is explicit; CORE segments cannot be optional.

TCH-0174 — adaptive reserve is policy-driven. The retained default begins at 10–15 percent with a 12.5 percent target and is configurable rather than hard-coding one fixed minute count.

TCH-0175 — the server-authoritative Teaching Controller persists state version, event cursor, current Blueprint ref, server-time schedule snapshots, progress, break/overtime/closure state and replay history.

TCH-0176 — explicit instructional states are Opening, Diagnostic, Instruction, Guided Practice, Independent Practice, Classwork, Remediation, Break, Assessment, Closure and Interrupted. Legal transitions are deterministic and auditable.

TCH-0177 — Controller/Blueprint priority order is Conceptual Correctness, Blocking Prerequisites, Core Objectives, Independent Evidence, Timing, Secondary Objectives, Enrichment.

TCH-0178 — Teach → Elicit/Check → Diagnose → Respond → Verify is an explicit deterministic Controller cycle.

TCH-0179 — learning/evidence descriptors are Demonstration, Guided, Independent Familiar, Independent Varied, Method Selection, Delayed Retrieval and Integration/Transfer. They are not SKM states and assistance is tracked separately.

TCH-0180 — descriptor traversal is non-universal; the Controller may skip/revisit/omit descriptors while still obeying state and evidence rules.

TCH-0181 — live replanning is separate from PPL after Class start. It uses current Controller version, authoritative remaining server time, current Blueprint/progress and current upstream authority; stale commits are rejected.

TCH-0182 — unfinished CORE objectives cannot be silently dropped by a replan. Enrichment and then secondary work are the safe sacrifice lanes before core truth.

TCH-0183 — early Closure is allowed only when CORE objectives and required independent evidence are satisfied. No busywork is introduced to fill remaining time.

TCH-0184 — scheduled Class end is server authoritative. Explicit overtime can be authorized but its ceiling cannot exceed 15 minutes and cannot be reset/extended by browser or model.

TCH-0185 — Break is recorded inside the scheduled Class block with server-owned start/end timestamps; Break may not spill into overtime or past scheduled Class end.

TCH-0186 — Break end is a durable D02 due event. Reconciliation is state/version/session aware and replay-safe, and automatically resumes the recorded pre-Break instructional state.

TCH-0187 — Closure creates an immutable fact pack from actual Controller progress/evidence/history, not plan-only intent. It contains no Gradebook mark, SKM mastery claim or Attendance outcome.

TCH-0188 — student-facing Class Summary is a TPF-19 translation of a visibility-bounded fact pack whose facts retain source-owner/truth/provenance metadata. If the route remains D30-held, the factual closure record remains authoritative and summary state is ROUTE_HELD rather than invented prose.

TCH-0189 — private post-Class Teacher Note is separate from the student summary and explicitly is not Gradebook, SKM or a behavior ledger. TPF-09 output remains provisional and provenance-bound.

TCH-0190 — deterministic QA covers invalid transitions, stale versions, replay, invalid time, lifecycle conflicts, stale replans, interruption/resume and terminal Closure.

TCH-0191 — regression scenarios cover normal teaching, early finish, late/overtime, remediation/revisit, Break auto-resume, interruption/recovery, scheduled Class end, stale schedule/Request materiality, and model outage without loss of T0 Class state.

TCH-0888 — the accepted Progressive Preparation Lifecycle is reused for pre-Class preparation. One next_class workspace is seeded per authoritative Class, material inputs are versioned, components have dependency edges, material change invalidates/supersedes preparation, and live replanning remains a separate Controller path after Class start.

TCH-0905 — prior-Class facts/Teacher Notes are provenance-grounded; future Work/SKM lanes remain owner-pending, missing data is not negative evidence, and active-assessment answers are not exposed to planning.

## Progressive preparation

D11 uses the existing D04/D05 PPL tables and deterministic T0 state machine rather than building another preparation engine. The next_class profile advances through SKELETON, STRUCTURED, CANDIDATE and PRE_LOCK_READY using the profile route postures bounded_interpretive, strong_design and final_reconciliation.

Each model result remains provisional. The artifact payload is stored through the existing protected preparation boundary, component dependency edges point to the authoritative input bundle, and the final short commit rechecks Course, Course Plan and Class schedule versions before creating a VALIDATED Lesson Blueprint.

If authoritative inputs change after a PRE_LOCK_READY/finalized/handoff workspace, D11 supersedes that workspace and creates a successor SKELETON workspace rather than reopening a terminal/frozen workspace.

## Live Controller and failure behavior

Class start/end and Break-end are durable D02 due events. Course activation seeds next-Class preparation and Class start/end events. D10 emits a committed REQUEST_APPLIED fact after the target-owner mutation and application record commit; D11 consumes that fact to refresh preparation, reseed current Class due events and interrupt an active Controller when upstream truth has materially changed.

If the model route is unavailable at authoritative Class start, D11 does not lose the T0 Class event. It creates a durable route-held Controller session in Interrupted state with no Lesson Blueprint bound, no fabricated teaching content and no academic penalty. Once qualified preparation exists, normal deterministic control can resume through explicit versioned state transitions.

Class Closure and its immutable fact pack are committed independently of model availability. A committed CLASS_ENDED event asynchronously attempts closure analysis, student Summary translation and private Teacher Note generation. Under the D30 production hold those derivative rows remain ROUTE_HELD/REVIEW_NEEDED while the factual closure record remains intact.

## Persistence and security

The D04 kernel tables teaching_lesson_blueprints and teaching_class_sessions are extended rather than replaced. New append-only/history/fact surfaces are teaching_class_controller_history, teaching_class_closure_facts, teaching_class_summaries and teaching_post_class_teacher_notes.

Browser roles receive no INSERT/UPDATE/DELETE/TRUNCATE authority for D11 academic state. Student browser SELECT is permitted only for the student-facing Summary under RLS. Private Teacher Notes have no authenticated-browser SELECT grant. Immutable history/fact/summary/note rows reject update/delete mutation.

## Delivery boundary

D11 does not implement D12 grading/marking, D13 SKM, D14 full Live Classroom UI/Study Pack, D15 Attendance, D16 Work, D20 Gradebook, D21 Progression, D30 route qualification or D31 release. The implementation intentionally leaves those owners and gates intact.
