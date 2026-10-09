# KIWI Teaching — Classroom Remodeling Blueprint

**Version:** proposed design 1.0  
**Date:** 9 October 2026  
**Baseline:** `happysolomon43-boop/KIWI`, `main`, commit `a77aec6fbd49b89a4538610e434151e2f5fb8cde`  
**Purpose:** implementation specification for a complete chapter, continuous paced teaching, one coherent teacher, persistent student interaction, purposeful checks, dependable recovery, and accurate academic records.

This document is a target blueprint, not a claim that the remodeling has been implemented, deployed, or qualified. Existing behavior is identified separately from proposed behavior. The four supplied files were read in full. Repository inspection covered the classroom client, Classroom service and repository, runtime subscriptions, Teaching router and composition, D11 contracts, D12 service/intelligence, preparation workflow, prompt-runtime contracts, capability registry, visual service, and classroom visual audit. Deployment configuration, live provider operation, applied production migrations, and every external infrastructure resource were not audited for this document.

## Contents

1. Binding decisions and conflict resolution
2. Product outcome and acceptance invariants
3. Existing implementation and remodeling gap
4. Authority and ownership
5. Shared vocabulary and references
6. TPF-05 authoring and planning contract
7. TPF-5/8 coordinator contract
8. TPF-08 presenter contract
9. Prompt amendments and governance
10. Capability migration ledger
11. Preparation and readiness
12. Target frontend experience
13. Conversation, chapter, Board, Notebook, and response surfaces
14. Classroom state model
15. Delivery and pacing engine
16. Student messages, queue, and allowance
17. Questions, response windows, and interpretation
18. Assistance, exposure, and evidence
19. Corrections and lesson replanning
20. Memory and continuity
21. Closure, homework, assessments, and TPF-20
22. Data and transactional contracts
23. API and event contracts
24. Concurrency and recovery
25. Security, privacy, and accessibility
26. Performance, cost, and observability
27. Repository integration and infrastructure
28. Delivery phases and rollback
29. Qualification scenarios
30. Traceability and release checklist

## 1. Binding decisions and conflict resolution

### 1.1 Source precedence

Authoritative platform, academic, security, and domain policies remain binding. Within this remodeling request, the final consolidated implementation plan in `CAHTS.txt` takes precedence over superseded conversational proposals. The three supplied prompt contracts provide the detailed role semantics. This blueprint resolves their inconsistencies explicitly; a proposed implementation choice does not become an existing KIWI policy merely by appearing here.

Current code establishes migration constraints and reusable mechanisms. It does not override the requested new product behavior. Where a target behavior requires changing a current restriction, the corresponding runtime, validator, API, UI, and migration work is specified together.

### 1.2 Final decisions

- TPF-05 authors a complete, coherent, textbook-style chapter and a separate achievable teaching plan. It retains its planning, homework, closure-analysis, and substantial-replanning responsibilities.
- TPF-5/8 is the working name for the merged Teaching Coordinator. It absorbs the mapped responsibilities of TPF-04, TPF-06, and TPF-07 through distinct modes. One mode runs per invocation.
- TPF-08 expresses the authorized teaching naturally. It explains rather than copying the chapter or producing disconnected short notes.
- Coordinator and Presenter appear as one KIWI Teacher. No student-facing assistant personality, prompt-family labels, or internal orchestration chatter is introduced.
- TPF-20 remains. It reconciles the actual Class into class-grounded study notes; it does not replace the prepared chapter, formal Class Summary, or official evidence records.
- The primary live surface becomes a continuous teaching conversation, with a connected chapter reading surface and persistent structured Board objects.
- The old Need Help/Raise Hand entry mechanism is replaced by a persistent composer in remodeled instructional sessions. Its useful durable backend behavior is migrated rather than discarded.
- Normal presentation advances automatically through authorized portions. Intentional pauses and response checkpoints are deliberate. The student never has to type “next” after every portion.
- The engine, not model output, owns timers, allowance accounting, delivery position, queue transitions, permissions, persistence, and recovery.
- Full records of up to the last three existing classes remain available, with older summaries linked to underlying records. Task-specific calls receive relevant context, not three full transcripts indiscriminately.
- Formal assessment, marking, attendance, mastery, progression, scheduling, and publication authority stay with their existing authorized owners.

### 1.3 Resolved contradictions

**TPF-20 retention.** Earlier retirement suggestions in the chat are superseded. The target always retains TPF-20.

**The merger.** Earlier descriptions of 04/06/07 as independent classroom actors are superseded for migrated capabilities. They are not parallel decision-makers after migration. Historical sessions and pre-migration capability bindings remain interpretable.

**Unit ownership.** TPF-05 owns chapter unit identities and structure. TPF-5/8 creates presentation subgroups within those units. It proposes a structural revision only through an explicit remapping and authoring handoff.

**Identifier conventions.** Existing chapter anchors such as `U01` and `U01.P01` are inherited unchanged. Only newly proposed coordinator identifiers require `local_`. A reference always includes chapter identity and version; `U01` alone is not globally unique.

**Never rejects.** Every successfully accepted student message has a durable identity, acknowledgement, and traceable disposition. This does not require prohibited answers, unlimited messages, immediate replies, or a promise of a scheduled follow-up. Invalid, unauthorized, oversized, or quota-exceeding requests can fail transport admission with a truthful explanation; they are not falsely shown as accepted.

**Chapter access versus independent evidence.** A full study chapter contains worked examples. An independent check cannot pretend an already accessible equivalent solution was unseen. Content access/exposure context must constrain the evidence claim; protected assessment switches to its authorized resources.

**Pause versus time.** Pause stops presentation release. It does not stop the authoritative scheduled Class clock, alter attendance, grant extra response time, or authorize overtime.

**Published versus delivered.** Publication is a server commitment. Client-confirmed rendering is a separate delivery fact. Neither proves reading, comprehension, attendance, or mastery.

**Questions answered versus difficulties resolved.** A delivered reply may answer a question while the student's difficulty remains unresolved. These are separate fields and transitions.

**Functional owner versus retired prompt.** “Response Evaluator” and “Pedagogy owner” are service responsibilities. For ordinary migrated classroom AI judgment, they route to coordinator modes through those services; the labels do not imply continued active TPF-06/07 bindings.

**Failed strategy repetition.** Rewording alone is not a substantive change after a materially ineffective strategy. Repetition remains permitted for a specific terminology clarification, requested recap, or recovery of content never delivered, with its purpose recorded.

**Overtime.** No approximately 15-minute default is established. Only current authoritative policy and a Controller decision can supply an extension. Existing D11 constraints must be checked during implementation before an approved policy change.

**Coordinator field count.** The default contract has exactly nine top-level fields. The chat's initially suspected field-count defect was retracted; no defect is carried into this plan.

## 2. Product outcome and acceptance invariants

The student enters an available scheduled Class, sees a complete validated chapter, and starts or joins one authoritative session. The Teacher explains connected ideas at a readable pace. The student can pause release, adjust reading pace, browse history, consult the chapter, write notes, and send contextual messages. The Teacher asks useful questions without turning every paragraph into a quiz. Answers lead to accepted interpretation and proportionate teaching adjustments. Reloading preserves position and pending work. Closure records actual coverage, valid evidence, unanswered questions, and unfinished essentials; the next class can continue accurately.

The following invariants are release-blocking:

- One authoritative academic Controller per Class session; one selected current instructional decision at a time.
- Chapter material, teaching route, generated explanation, committed publication, confirmed delivery, and demonstrated learning are separately represented.
- Every live portion resolves to the exact approved chapter/plan/guide versions and source anchors applicable to it.
- No UI action directly sets a grade, mastery state, attendance outcome, objective completion, schedule, or AI authority.
- An open response window prevents unrelated instruction from advancing.
- No hidden answer key, private interpretation, internal routing artifact, or unreleased presentation is returned in a student DTO.
- A successful retry does not duplicate a message, charge a turn twice, publish twice, create a second session, or start a second timer.
- Pending questions survive closure and reconnection. A merged question retains all original message links.
- Classwork/Assessment restrictions are enforced in server reads, writes, subscriptions, asset retrieval, and client rendering.
- Teacher acknowledgements and timing promises correspond to real committed commitments.
- Accepted responses are preserved even if evaluation finishes after Class closure, without reopening the Class or releasing retrospective live feedback into a completed session.
- Historical records preserve their original prompt/schema provenance and are never rewritten to pretend the new system existed earlier.

## 3. Existing implementation and remodeling gap

### 3.1 Reusable baseline

`public/teaching-classroom.js` already implements the focused classroom shell, server-derived clocks, course/class identity, Teacher Presence, structured Board rendering, a Student Workspace, Notebook, Raise Hand, class history, interruption recovery, and responsive Board/Workspace tabs. It refreshes snapshots on a 12-second interval and clocks locally every second. It protects reading position and some drafts, supports text-size preferences and panel expansion, retrieves visual assets through the authenticated shared client, and retries uncertain JOIN confirmation.

`teaching/d14/service.js` builds the student snapshot and accepts Notebook entries, interactions, JOIN, and responses. It delegates academic responses to D12 and attendance observations to D15. It withholds Board and Notebook projections in Classwork/Assessment. Help is allowed only in specified active instructional modes.

`teaching/repositories/d14-classroom.js` supplies owner-scoped persistence, idempotency, help-processing leases, private visual assets, and atomic version-fenced Teacher/Board publication. D14 runtime subscriptions respond to instruction-ready, lesson-plan-approved, class-ended, help-requested, and deferred-review events.

D11 owns Controller transitions, Blueprint normalization, time envelopes, closure facts, and preparation/recovery. D12 already has response capture, event-driven evaluation, error/assistance interpretation, pedagogy recommendations, and fresh-verification paths. The orchestrator and prompt runtime already centralize capability contracts, context minimization, authority bounds, provenance, and current-state validation.

### 3.2 Required changes

The current latest-teacher-message projection is insufficient for a continuous append-only conversation. Current help status and bounded retries do not implement a persistent general message queue with classroom-boundary scheduling and cross-class unresolved follow-up. Current Board scenes do not constitute a complete chapter contract. Existing polling does not establish delivery receipts, response-window readiness, or server-owned paced release. Current D12 evaluation rejects a closed Class and stale Controller versions, which requires a distinct immutable-context post-closure evaluation path for already accepted work.

The remodel must add chapter/guide artifacts, Presenter sequences, durable delivery state, typed questions and windows, per-message admission and allowance accounting, persistent unresolved dispositions, dependency-aware continuation, and a compatibility layer for old sessions. It must integrate rather than duplicate the existing Controller, AI orchestration, attendance, academic work, asset storage, and recovery systems.

### 3.3 Runtime naming obstacle

The current capability registry enforces family identifiers matching `TPF-\d{2}` and exactly 20 families. Therefore the working label `TPF-5/8` cannot simply be inserted into the deployed registry. Choose a canonical family identifier through governance, record `TPF-5/8` as a design alias, update count and hash assertions to the resulting manifest, and retain historical resolution. This blueprint deliberately does not invent an official identifier or claim that the family count must become a particular number.

## 4. Authority and ownership

### 4.1 Prompt responsibilities

**TPF-05 / Lesson Planner:** complete chapter, author-owned anchors and units, teaching-plan feasibility, core/secondary/optional prioritization, reserve recommendations, retrieval decisions, significant live/lateness replans, homework proposals, closure analysis, and rolling content allocation within authorized scheduled classes.

**TPF-5/8 / Teaching Coordinator:** explanation guides, purposeful diagnostic/check design, ordinary response interpretation, immediate strategy selection, message classification/disposition, interaction timing proposals, useful continuity, and instructional assessment guidance. It proposes runtime effects and substantial replans; it does not commit them.

**TPF-08 / Presenter:** natural teacher wording, connected portions, question expression, authorized hints/examples/feedback, structured Board proposals, source-grounding analysis, and teacher self-correction. It cannot independently select a new teaching strategy, deadline, allowance, curriculum, grade, or Class transition.

**TPF-20 / Study-note capability:** reconcile approved chapter references, actual delivered instruction, closure facts, sources, and eligible study artifacts into private note preparation and a validated reconciled note candidate. Publication remains D27/Study Pack authority.

### 4.2 Application responsibilities

**D11:** academic session authority, Blueprint/replan application, instructional substates, assistance policy integration, time boundary, resumption, and closure. No second independent Class state machine is introduced.

**D14 plus a dedicated delivery engine within Teaching:** conversation and classroom projection, Notebook, queue state, Presenter delivery position, release scheduling, receipt reconciliation, and permitted UI mechanics. The delivery engine is subordinate to D11 and protected-work owners.

**D12:** persist responses, validate/accept ordinary classroom interpretations, preserve assistance/exposure context, and route evidence and pedagogy consequences. The AI judgments migrate to coordinator modes. D12 does not vanish because the prompt family merges.

**D15:** attendance observations and formal attendance decisions. Delivery receipts and conversation activity are observations only.

**D16:** official Classwork/homework workflows and their authorized content/response rules. TPF-05 plans homework; the coordinator informs it; neither bypasses assignment validation.

**D17–D20 and associated owners:** formal assessment lifecycle, shell, task generation/validation, marking and gradebook authority. Preserve eligibility, package locking, grading, moderation, and protected answer boundaries.

**D13 / SKM and evidence owners:** official learning-state mutations from validated evidence and policy. One classroom response must not silently create a permanent diagnosis or mastery claim.

**D22:** persistent Teacher Identity. TPF-08 realizes the supplied identity, with neutral respectful fallback if optional style is unavailable.

**D27:** eligible study integration and publication. **PPL/preparation:** versioned preparation workflow and readiness. **D25/reliability and runtime:** durable events, leases, retry/reconciliation. **D30/D31/governance:** qualify and release routes under existing owner rules, updated for the new contracts.

### 4.3 Handoffs

Every handoff has an owner, registered route, concrete input, requested decision/action, preconditions, correlation key, expected confirmation, and resumption condition. A request is not proof of invocation. A persisted outbox event is not proof of completion. Missing routes block only dependent work and are operationally visible.

## 5. Shared vocabulary and references

### 5.1 Separate entities

- **Course Learning Unit:** an authoritative curriculum/competence entity. It is not the same as a chapter teaching unit.
- **Chapter:** versioned complete student-facing academic material within approved scope.
- **Chapter teaching unit:** author-owned grouping of related paragraphs, equation explanations, diagrams, examples, or reasoning.
- **Source element:** stable anchor for a paragraph, equation, figure, example, passage, or code sample.
- **Teaching plan:** selected route, objectives, phases, treatment, evidence opportunities, stopping rules, and time ledger.
- **Explanation guide:** coordinator guidance for how to teach a source span, not a final script.
- **Presentation subgroup:** a coherent span inside the author's unit with explicit source mapping.
- **Presentation sequence:** bounded authorized Presenter output containing one or more portions.
- **Portion:** connected student-facing wording or a purposeful question with dependencies and a boundary type.
- **Board object:** persistent typed representation referenced from a portion; it is not arbitrary HTML.
- **Question/check:** a versioned task with purpose, criteria, permitted assistance, exposure lineage, and response requirements.
- **Message:** accepted student conversational content with context and a durable identity.
- **Response:** an answer tied to an exact task instance, independent of conversational message quota.
- **Delivery receipt:** limited evidence of client rendering, never evidence of understanding.

### 5.2 Reference format

Store structured references containing entity kind, authoritative identifier where assigned, version, and anchor where applicable. For example, a chapter anchor is resolved by `{chapterId, chapterVersion, unitAnchor, elementAnchor}`. A Course Learning Unit uses its own ID/version. A mapping links one or more chapter units to one or more objective/Learning Unit references without substituting identifiers.

Prompt-local names are resolved on artifact acceptance through a stored reference map. Reject duplicate anchors, dangling dependencies, cyclic prerequisites where forbidden, references to the wrong chapter version, unknown task criteria, or unit IDs substituted for curriculum IDs. Preserve unchanged anchors; record split/merge/replacement relationships. A historical URL or title alone is not enough grounding for live teaching.

### 5.3 Distinct status dimensions

Artifact completeness uses complete/partial/blocked/not-requested semantics as each prompt specifies. Validation status, publication status, delivery status, objective work status, queue state, response-window state, and Class lifecycle are independent. Never overload `complete` to mean all of them.

Retain TPF-05 work labels: completed and sufficiently evidenced; taught but not independently verified; partial; unresolved difficulty; not attempted. Carry-forward is a separate disposition. A chapter may be fully available while many units remain not attempted in the Class.

## 6. TPF-05 authoring and planning contract

### 6.1 Chapter quality

Generate complete connected explanations. Define terms before relying on them. Explain equations, symbols, units, assumptions, conditions, transformations, and interpretation as appropriate. Worked examples include meaningful intermediate reasoning. Diagrams have captions, alt text, and guidance about what matters. Code/source passages have enough context to support the intended lesson. Include comparisons, misconception distinctions, connections, and recaps when useful, not mechanically in every unit.

Do not pad to a paragraph count, substitute bullets for developed teaching, invent sources, or leave essential reasoning for TPF-08 to reconstruct. Original accurate examples and derivations are allowed within approved scope and supplementary-knowledge permission; they are distinguished from attributed source material.

### 6.2 Separate prioritization axes

Objective priority is Core, Secondary, or Optional/Enrichment. Material designation is Essential, Supporting, or Optional depth. Unit treatment is Scheduled, Support, or Deferred. These axes are separate. Required material deferred for time is still required, not reclassified as optional.

For each selected objective, define legitimate completion and its evidence standard. For each unit, identify central idea, intended understanding, objective links, prerequisites, reasoning, representations, source anchors, treatment, and resumption needs.

### 6.3 Time feasibility

The ledger must satisfy: planned instructional/interaction phases + planned breaks + reserve ≤ authoritative usable time. Declare the accounting basis so assessment blocks and unavailable time are counted exactly once. Include explanations, questions, responses, clarification, practice, and closure; do not budget only teacher text.

The prompt's 10–15% reserve reference is a planning heuristic, not a guaranteed runtime allocation. Adopted policy, evidence uncertainty, complexity, and Class duration govern the selected allowance. Reserve protects likely questions, prerequisite repair, slower work, and disruption. Unused reserve can support useful verification or enrichment, not filler.

Each remediation branch names the blocker, strategy requirement, bounded planning time/attempt allowance, evidence for return, and carry-forward/replan condition. If essential work cannot fit, return `infeasible_within_time`, a reduced legitimate alternative, and explicit unfinished requirements. No automatic overtime or reduced academic standards.

### 6.4 Required modes and deliverables

- `pre_class_lesson_blueprint`: chapter, shared unit map, teaching plan, relevant skill trajectory, provisional homework only if requested, preparation update only with preparation context.
- `core_optional_selection`: objective/unit designations and the relevant map subset.
- `adaptive_reserve_allocation`: time ledger/reserve recommendation only.
- `purposeful_retrieval_selection`: retrieval decision and intended evidence goal.
- `live_lesson_replan` and `lateness_replan`: revised remaining work, preserved actual work, closure/replan record, affected trajectory and maps.
- `lesson_closure_analysis`: actual-event interpretation and homework/no-homework justification; no generated tasks and no TPF-20 substitute.
- `rolling_planning_horizon`: content allocation within already scheduled classes, dependency/deadline conflicts, conditional preparation update.
- `homework_design_generate`: task specifications or generated tasks only as explicitly requested, with assistance/resources, private expected solutions, validation, effort, workload and deadline ownership.
- `homework_to_next_lesson_synthesis`: implications and carry-forward based on authoritative outcomes and validity/access context.

All modes retain Status & provenance and Handoff. Do not run every mode because the family can perform them.

### 6.5 Partial chapters and continuation

Persist completed units intact and mark the artifact partial. Continuation specifies prior chapter candidate identity/version, last complete unit, remaining required units, preserved anchors/content hashes, requested next authoring task, and forbidden rewrites. A new call appends or revises only authorized elements. Detect duplicate units and incompatible continuation before acceptance. Never compress remaining content to fit one response.

Start readiness requires a complete validated chapter for the approved starting lesson scope. A wider optional chapter expansion may remain separate and pending only if the approved complete starting chapter and plan do not depend on it; this must be an explicit scope/artifact split, not a partial chapter relabeled complete.

## 7. TPF-5/8 coordinator contract

### 7.1 Modes

Preserve the supplied eight-mode vocabulary:

- `prepare_guidance`: guide the complete chapter or explicitly scoped excerpt; record covered and uncovered references.
- `coordinate_lesson`: choose one next instructional action at meaningful events.
- `handle_message`: classify and disposition received messages; route substantive answer work to interpretation rather than performing that workflow implicitly.
- `design_check`: design/select a purposeful allowed check, with private criteria, inference ceiling, validation and response requirements.
- `interpret_response`: analyze the actual task/answer/criteria/assistance and select a proportionate adjustment.
- `close_class`: propose stopping/closure continuity from actual state.
- `prepare_continuity`: useful historical connections and unresolved carry-forward with sources.
- `guide_assessment`: instructional context and evidence requirements for authorized downstream work.

One invocation returns one JSON object, one task mode, applicable artifacts only, and at most one current `next_action`. Conditional follow-up is not a second simultaneous command.

### 7.2 Default envelope

Exactly nine fields: `request_ref`, `task_mode`, `input_state_reference`, `status`, `review_required`, `artifacts`, `next_action`, `runtime_requests`, `issues`. Default statuses are `complete`, `partial`, `blocked`; they describe coordinator work, not Class completion. Every material academic claim/instructional decision carries `basis` and `evidence_refs`. Basis values are `explicit fact`, `supported inference`, `proposal`, `unresolved`.

Preserve the supplied artifact groups: explanation guides; message dispositions; checks; response interpretation; progress; continuity; replan request; assessment guidance. Expected solutions/criteria live under private fields, never in public conversation DTOs.

### 7.3 Guides and stopping rules

Each guide states meaning, intended understanding, terms, reasoning, essential explanation, optional expansion, representations, possible confusion, links, pause points, relevant checks, `expand_when`, and `stop_when`. Possible misconception is not an established student diagnosis. Guidance is instructional direction, not a script.

Invoke live coordination on student messages, answers, unit decisions, execution failures, or material time/difficulty changes. Routine release through approved guidance needs no per-sentence call. A wrong answer triggers analysis, not automatic full restart. A terminology slip, arithmetic slip, unclear task, unsupported prerequisite hypothesis, and conceptual misconception have different implications.

### 7.4 Question and interpretation rigor

Checks state the precise decision question, target competence, intended claim, strongest supported inference, response form, assistance/exposure conditions, sufficiency and stopping criteria. Validate answerability and correctness before release. A short text interaction cannot establish oral pronunciation or unobserved physical performance.

Interpret final-result correctness, conceptual support, reasoning validity, completeness, task alignment, independence, and evidence sufficiency separately. Preserve valid components and alternative methods. Do not penalize style unless it is the construct. A misconception is a supported hypothesis about a wrong model, not a synonym for any error. Silence, speed, overlap, and polished wording do not establish motivation, carelessness, emotion, misconduct, or understanding.

Substantial replanning goes to TPF-05 with actual position, delivered work, responses, failed strategies, open commitments, and remaining authoritative time. Official evidence consequences go to their domain owner.

## 8. TPF-08 presenter contract

### 8.1 Typed Directive

The engine builds a complete Directive after accepting coordinator decisions and binding current policy/state. Raw coordinator JSON is not sufficient. It contains academic mode, purpose, approved action, target, allowed interaction kinds, assistance ceiling/current assistance, evidence intent, restrictions, expected student action, learning stage, authorized source span, response budget, chapter/Board/task/lineage references, timing/wait constraints, accepted evaluation where relevant, return anchor, identity/style, and supported capabilities.

Missing essential directives, grounded source content, state references, or compatible schema withhold affected teaching. Missing optional style/history does not block present-focused work; use neutral language and omit unsupported historical claims.

### 8.2 Action mapping

- Answer message, clarification, missing step, and misconception repair → `explain` with the authorized findings/strategy.
- Focused probe, independent attempt, or further verification → `probe` with an accepted task.
- Hint → `hint`; new example → `example`; analogy → `analogy` when explicitly selected.
- Representation change or guided practice → `explain`, or supported `explain with the Board`, preserving selected strategy.
- Continue → `explain` for the next approved span.
- Prepare closure → `transition` with actual closure facts.
- Wait → `wait`, silence enabled, no filler, open response preserved.
- Slow/pause/defer/replan → engine action first; Presenter wording follows confirmed resulting state only when needed.

Use the supplied twelve task modes: `natural_teacher_instruction`, `teacher_question_or_probe`, `permitted_hint_wording`, `example_or_analogy_generation`, `teacher_self_correction`, `teacher_source_grounding_selection`, `outside_class_course_qa`, `interaction_style_realization`, `evidence_based_praise`, `challenge_accountability_communication`, `context_sensitive_register_humor`, `board_instructional_content`.

### 8.3 Portion structure

Each portion carries its ID/order, one `teacher_message`, exact unit/source anchors, equation/example/visual/question references, reasoning-sequence relationship, boundary type, Board actions/dependencies, wait requirement, expected student action, continuation anchor, and private integrity/evidence metadata through the compatible schema.

A reading boundary allows dwell time. A suitable teaching pause allows interruption without breaking necessary reasoning. Several portions may form one reasoning step. The Presenter never crosses a decision requiring an unevaluated response. If its budget cannot hold adequate explanation, it stops at a meaningful boundary and reports remaining work; it does not omit essential reasoning or produce an unlimited response.

### 8.4 Truthful teacher behavior

No fake human experience, invented deadlines/counts/history, unconfirmed queue promises, or confident assessed feedback before accepted evaluation. Praise names demonstrated behavior. Firmness reflects actual academic rules, without guilt or humiliation. Explicitly reported frustration may be acknowledged; inferred emotion is prohibited.

The Presenter rechecks challenged claims against trusted sources or valid logic. Confirmed errors produce an explicit corrected academic statement, proposed Board repair, and downstream evidence recheck. Its earlier wording is not evidence.

Board proposals use only advertised operations and validated types. Instructional code is inert content; executable interface code and arbitrary HTML are prohibited. Ordinary teacher prose appears only in teacher-message fields. Public UI never renders the complete prompt artifact.

## 9. Prompt amendments and governance

These amendments are required before activating the supplied candidates. The attachments remain source candidates; this document does not alter them or assert governed approval.

1. Amend coordinator Role grouping language to respect TPF-05 unit ownership, author anchors, and explicit authorized remaps.
2. Exempt inherited chapter anchors from the coordinator `local_` convention; new coordinator-local proposals retain it.
3. Replace ambiguous owner labels with a functional resolver: ordinary check design/interpretation/strategy → coordinator modes through their services; substantial replan → TPF-05; official outcomes/formal work → authorized domain owners.
4. Replace absolute failed-approach repetition prohibition with the identified-cause rule in section 1.3, consistently in coordinator and Presenter.
5. Extend TPF-05 partial-chapter continuation metadata as section 6.5 specifies.
6. Remove the unsupported 15-minute overtime anchor unless a reviewed current policy specifically requires it. Do not delete runtime protection without replacing it with approved policy enforcement.
7. Define `interpret_response` validation/acceptance versus external validation without claiming model self-check is independent verification.
8. Establish explicit chapter-read/access exposure provenance and its limits for independent tasks.
9. Preserve all prompt status vocabularies and map them through a runtime result envelope; do not force `complete` and `ok` into a shared completion boolean.
10. Define a registered output schema per mode and strict visibility projection. No silent truncation of required output fields to fit the old D12 or one-message D14 schema.
11. Pin prompt bodies, versions, SHA hashes, schema versions, authority ceilings and capabilities per session. A candidate filename is not a deployed version.
12. Treat quoted prompts, chapters, uploads, student text and old model outputs as data. Typed directives and capability permissions carry authority.

Coordinator status `complete` can be usable only after validation and explicit acceptance; `partial` can expose independently valid sub-artifacts without dependent actions; `blocked` schedules a concrete reconciliation/handoff. TPF-05 uses its supplied precedence (`policy_block` first, `ok` last). TPF-08 preserves its supplied eight statuses and precedence. The engine records raw status plus normalized handling category such as candidate, hold, review, reconciliation, or prohibited; it never labels a hold as productive WAIT.

## 10. Capability migration ledger

The decoded current registry contains 22 capabilities bound to TPF-04/06/07: three diagnostic/check capabilities, seven interpretation capabilities, and twelve pedagogy capabilities. Preserve canonical capability IDs, authority ceilings, provenance and authoritative owner boundaries unless an explicit governed migration changes them. The merged prompt is not blanket permission to elevate all capabilities to the highest authority of any member.

### 10.1 TPF-04 destinations

- `teaching.curriculum.targeted_placement_prior_knowledge_diagnostic_design` → coordinator `design_check` in the Curriculum/Assessment-owned diagnostic workflow; returns a bounded specification/candidate, not official placement.
- `teaching.lesson.fresh_verification_task_selection_after_answer_exposure` → `design_check`, with exposed-item lineage, fresh task validation and evidence restrictions.
- `teaching.scheduling.makeup_re_entry_diagnostic_design` → `design_check` using `prepare_continuity` output, actual absence/missed dependencies, and planner-owned re-entry context.

### 10.2 TPF-06 destinations

All seven below route to coordinator `interpret_response` through the Response Evaluator/D12 boundary, preserving distinct requested findings:

- `teaching.lesson.response_correctness_quality_evaluation`.
- `teaching.lesson.response_error_taxonomy_classification`.
- `teaching.lesson.correct_but_insufficient_evidence_detection`.
- `teaching.lesson.partial_response_decomposition`.
- `teaching.lesson.procedural_slip_detection`.
- `teaching.lesson.misconception_detection`.
- `teaching.lesson.prerequisite_failure_detection`.

They do not become official marking or permanent diagnosis authority. Formal uses retain their validation and owner-specific constraints even when sharing a prompt body.

### 10.3 TPF-07 destinations

- `teaching.lesson.next_pedagogical_action_recommendation` → `coordinate_lesson` or the accepted `interpret_response` next action, never two concurrent owners.
- `teaching.lesson.hint_level_selection` → `coordinate_lesson` with active assistance policy; Presenter only words the allowed hint.
- `teaching.lesson.productive_struggle_intervention_decision` → `coordinate_lesson`, including waiting without inferred emotion.
- `teaching.lesson.representation_change_strategy` → `coordinate_lesson` plus affected guidance update through `prepare_guidance`.
- `teaching.lesson.blocked_diagnosis_proposal` → `interpret_response` hypothesis or `coordinate_lesson` handoff; durable blocked state stays with SKM/domain policy.
- `teaching.pedagogy.pedagogical_profile_classification` → `prepare_guidance` as a bounded strategy-profile artifact, with a compatible extension schema.
- `teaching.pedagogy.subject_sensitive_instructional_strategy` → `prepare_guidance` or `coordinate_lesson` according to preparation/live context.
- `teaching.pedagogy.worked_example_scaffolding_design` → `prepare_guidance` for strategy/specification and a bounded checked practice/example artifact; natural wording is TPF-08.
- `teaching.pedagogy.conceptual_conflict_misconception_repair` → accepted interpretation plus `coordinate_lesson` strategy, implemented by Presenter.
- `teaching.pedagogy.surgical_micro_remediation_design` → `coordinate_lesson` within the plan; substantial prerequisite/sequence change routes to TPF-05.
- `teaching.pedagogy.subject_appropriate_evidence_task_design` → `design_check`, or `guide_assessment` specification when formal-generation authority is required.
- `teaching.pedagogy.knowledge_type_sensitive_review_strategy` → `prepare_guidance`/`prepare_continuity` or `guide_assessment`; actual review scheduling remains owner-controlled.

Implementation must generate capability counts directly from the registry and reject any mismatch with this ledger. New coordination capabilities are additional governed entries, not implicit authority hidden in old aliases.

### 10.4 Compatibility obligations

The eight-mode coordinator default schema alone does not expose every specialized legacy artifact, notably profile classification and worked-example/scaffolding design. Define capability-specific compatible artifact extensions under the appropriate mode, preserving all fields and restrictions, before migrating those bindings. Do not invent a ninth mode in model output. If an extension cannot represent the full old responsibility, preserve its old route until a compatible governed contract exists.

Audit every caller, alias, output validator, prompt catalog/body store, Constitution binding, capability manifest, route qualification, preparation stage, stored artifact consumer, test, workflow, and historical reader. A search for family labels is necessary but insufficient: callers frequently use canonical capability IDs. Formal or non-classroom callers require their own context and permissions, not classroom defaults.

## 11. Preparation and readiness

Prepare dependencies in this order: authoritative scope/objectives/sources and time → complete chapter and shared anchors → feasible teaching plan/Blueprint → explanation guides → useful check/practice candidates and continuity → bounded opening Presenter sequence → supported asset/fallback validation → runtime readiness attestation.

Reuse PPL/workflow orchestration. Do not insert an ungoverned second preparation runner. Each stage records dependencies, preserved components, source hashes, output completeness, validation state, and downstream handoffs. Preserve required independent review stages where current preparation policy demands them; merging prompts does not remove governance.

Start readiness requires active Course, applicable approved timetable/class window, qualified model routes, valid current Blueprint and plan, complete chapter for starting scope, resolved source anchors, essential guidance, coherent validated opening, supported critical representations or adequate fallback, and compatible schemas. Optional future checks and all possible future explanations need not exist before start.

Do not generate the entire lecture ahead. Keep a bounded buffer governed by policy, and revalidate it after messages, interpretation, corrections and replans. Content/time budgets are configuration, not values the model invents.

A schedule-only change preserves compatible academic material but recomputes time-bearing plans and live bindings. Objective/source changes invalidate affected chapter/guide/check/presentation dependencies. Evidence changes invalidate relevant strategy/readiness assumptions, not unrelated correct prose. Retain a dependency graph with explicit reasons; never invalidate everything solely because a timestamp changed.

Failure exposes exact missing dependencies internally and a simple truthful student message. Safe late-start recovery must preserve D11's current checks against overwriting an already started lesson. Repeated Start clicks return the same authoritative result.

## 12. Target frontend experience

### 12.1 Desktop composition

Use a calm classroom shell with a compact identity/time header, a dominant vertically scrolling conversation, and a connected resizable chapter pane. The current objective and activity mode remain legible without becoming a large dashboard. A persistent composer sits at the bottom of the conversation. Structured Board representations appear at relevant points and can expand into a readable reference surface. Notebook is a lightweight secondary panel.

This is one teaching interface, not nested cards containing another set of cards. Teacher explanation reads as developed paragraphs with appropriate math, code, figures and worked steps. Teacher and student contributions are distinct without repetitive avatar/name furniture. Unit transitions are understated and linked to the chapter.

### 12.2 Mobile and narrow screens

Use Conversation/Chapter views with clear return-to-current links. Notebook and expanded visuals use accessible sheets/dialogs. Preserve independent scroll positions, selected chapter anchor, text size and drafts across view switches. Do not display two unreadable narrow columns. The composer remains reachable above the software keyboard; timers and active task actions are not covered.

### 12.3 Header and controls

Show course, teacher, Class mode, authoritative time remaining, current presentation state and connection state. Distinguish Class clock from a response deadline. Provide Pause/Resume presentation, Slower/Faster, text size, Return to current, chapter access, Notebook, and permitted technical/leave actions. Pace controls do not change academic mode or schedule. Resume resumes an intentional release pause, not a command to skip checks.

Do not add a student-facing Next lesson-state action. Existing Prepare & Start and validated interruption recovery remain explicit when necessary. Start pending, preparation held, connection retry, historical unstarted, completed, and protected-work states each have precise text and permitted actions.

## 13. Conversation, chapter, Board, Notebook, and response surfaces

### 13.1 Conversation

Use typed append-only events for Teacher portions, accepted student messages, questions, answers, permitted feedback, corrections, and short operational notices. Each entry has a server sequence, identity, timestamp, source links, public status and role. Assistant internals do not appear.

An optimistic student draft may show Sending, but only a server receipt shows Accepted. An uncertain send retains its idempotency key for retry. An accepted queued message shows its actual disposition. Teacher text is visible only after release authorization; a prepared buffer is never preloaded into a public response for cosmetic hiding.

Preserve reading position when new messages arrive. Only follow live text when the student is already following the current end. Show a new-content indicator when browsing history. Do not steal focus or rewrite a focused answer textarea on unrelated refresh.

### 13.2 Chapter

Render complete validated chapter content with section navigation and stable anchors. Highlight the current presented span while allowing free browsing. Distinguish available material, presented-in-Class material, student study position, deferred required work, and optional depth; avoid “mastered” badges inferred from exposure.

Keep operational plan metadata and hidden checks out of this DTO. Textbook worked examples remain available as authorized study content. A chapter revision has a concise student correction notice and exact anchor remap; previous versions remain historically interpretable.

### 13.3 Board

Retain typed text, equations, worked steps, graphs/data, code, passages, comparisons, diagrams, images, and annotations. Conversation references Board objects instead of duplicating every object as prose. Support only operations advertised and implemented end to end. Unsupported clear/restore/highlight operations are not treated as silently successful.

Release the dependent Teacher portion only when its required Board operation is committed and the client can render the required representation or accepted fallback. Exact technical diagrams and calculations use structured rendering, not generative illustration as a source of truth. Generated imagery stays supplementary and has alt text/provenance.

### 13.4 Notebook

Preserve personal entries, Board references and selected-text capture. Add chapter/portion references using versioned anchors and public text only. Notes save idempotently, preserve drafts across ordinary state refresh, and report unconfirmed persistence truthfully. Protected-work transitions close editing surfaces and prevent restricted writes at the backend. Student Notebook content is not automatically an official academic response or model input without a relevant permitted purpose.

### 13.5 Active response

Present one active task clearly within the conversation with an associated response area. Bind the composer/answer UI to task ID, task version, response window, mode and assistance policy. Preserve task drafts and separate them from conversational drafts. Explicit teacher-requested responses, clarifications and extension requests remain available when conversational allowance is exhausted.

### 13.6 Protected and historical surfaces

When Classwork or Assessment begins, transition to the authorized work surface; suppress chapter/Board/Notebook/help access according to server capability projection. Keep technical support and authorized submission paths. Do not merely show “Assessment in progress” while leaving an unrelated answer form active.

A historic Class opens read-only, does not send JOIN, consumes no live quota, starts no question window, and cannot resume an ended session. A follow-up question is a separately admitted authorized interaction, not a mutation of the old live Class.

## 14. Classroom state model

### 14.1 Orthogonal state dimensions

Keep D11's academic lifecycle and instructional substates authoritative: Opening, Diagnostic, Instruction, Guided Practice, Independent Practice, Classwork, Assessment, Break, Remediation, Closure and Interrupted. Do not replace them with chat-only labels.

Add subordinate delivery state: `READY`, `PREPARING`, `PRESENTING`, `PAUSE_PENDING`, `PAUSED`, `WAITING_FOR_RESPONSE`, `WAITING_FOR_INTERPRETATION`, `HANDLING_MESSAGE`, `RECOVERING`, `CLOSING`, `COMPLETED`. These are proposed new runtime values; they are not claimed to exist in the current contracts.

Keep transport state separately: connected, reconnecting, offline, or degraded. Keep local navigation separately: current conversation versus history; current chapter anchor versus browsing; active pane; text-size preference. A transport disconnect does not itself create a misconception, close the Class, or grant overtime.

### 14.2 Transition rules

- READY → PRESENTING only after D11 start/join authority and a releasable opening exist.
- PRESENTING → PREPARING if the next approved portion is unavailable; retain the last confirmed position.
- PRESENTING → PAUSE_PENDING on a normal interruption decision requiring a teaching boundary; release only the authorized current reasoning remainder.
- PRESENTING/PAUSE_PENDING → PAUSED on a permitted user presentation pause or completed boundary pause.
- PRESENTING → WAITING_FOR_RESPONSE only after the question and dependencies are released and delivery readiness is confirmed.
- WAITING_FOR_RESPONSE → WAITING_FOR_INTERPRETATION after response acceptance, or to a defined no-response/closure reconciliation after expiry.
- WAITING_FOR_INTERPRETATION → HANDLING_MESSAGE/PRESENTING only after accepted feedback/next action; generation alone cannot unlock progression.
- Any live delivery state → RECOVERING when authority/content/dependency reconciliation is needed; only affected releases are held.
- Any live state → CLOSING under D11's authoritative closure constraints.
- CLOSING → COMPLETED after durable closure. This cannot be reversed by a stale client Resume.

Pause during an answer window changes presentation only; it cannot pause/extend the response timer. A response-related clarification may occur while the question remains open, under assistance limits. Break/Assessment transitions override subordinate delivery states and invalidate incompatible buffered portions.

### 14.3 Legal composite states

Define an executable guard that validates combinations. Assessment + unrestricted presenting is illegal. Closed Class + live response window is illegal, though a post-closure accepted-response evaluation job can exist. Interrupted + automatic next release is illegal. Active instructional mode + paused release can be legal. Missing Controller + historical past window is not READY. Every command checks composite state before committing.

### 14.4 Single decision ownership

The coordinator chooses instructional direction; the engine admits it; D11 approves required academic transitions. Deterministic release continues through an already approved span without new AI judgment. Existing D12 deterministic bounds can enforce limits, but must not independently choose a conflicting second strategy after a coordinator action is accepted. Record any constrained action and why it differs from a proposal.

## 15. Delivery and pacing engine

### 15.1 Portion lifecycle

Use independent records for generation and delivery. A portion progresses from candidate to validated/prepared, scheduled/releasable, published, and client-render-confirmed. Invalidated, superseded, withheld and failed states preserve reasons. Publication exposes the content to authorized clients; render confirmation supplies limited delivery provenance. Historical reading does not advance live teaching.

Before generation, capture session, chapter, guide, Blueprint, plan, Controller version, delivery epoch, scope/schedule authority, task/assistance context, and approved span. Generate outside database transactions. Validate schema, academic integrity requirements, visibility, references and budgets. Re-read applicable authority before accepting the candidate. Release under a short transaction with optimistic version checks and a transactional event/outbox write.

### 15.2 Buffer policy

Prepare a bounded next sequence while the current one is displayed. Configure limits on portion count, content bytes/tokens, source horizon, cost and speculative work. Stop prefetch at the next response-dependent decision. Never prepare future feedback as though an unanswered question has already been evaluated.

A message that does not change the plan may leave compatible prepared material valid; do not discard everything automatically. An accepted strategy change, correction, replan, protected-mode transition or revoked authority increments an applicable generation/delivery epoch and marks affected unreleased content superseded. Revalidation must establish semantic compatibility, not merely update a version number.

### 15.3 Pace

Compute release eligibility from runtime policy, content complexity/type, selected pace, remaining time, reading dwell, dependencies, pause state and response commitments. Faster changes readable dwell within approved bounds; it does not skip required reasoning or questions. Slower can consume scheduled time, so remaining feasible coverage is reassessed at a meaningful time event.

Character-by-character animation is optional decoration. Default to complete readable sentences or connected portions and dwell between them. Allow instant completion of an animation for reduced motion/accessibility. Do not release raw provider token chunks into the lesson before validation.

No universal words-per-minute number is fixed here. Complexity weights, dwell minima/maxima, generation horizons and closure lead time belong to a versioned runtime policy with explicit defaults established through calibration. Model output cannot set them directly.

### 15.4 Delivery receipts and limits

For each released portion, the active authorized client sends receipt identity, portion/server sequence, asset/fallback readiness, session/delivery epoch, active-client token and render state. The server verifies eligibility and deduplicates. Acknowledgement confirms application rendering, not actual attention or comprehension; label it accordingly in records and summaries.

Do not count a response task as delivered because the server wrote it. Do not count a hidden tab's preloaded DOM as a meaningful active delivery acknowledgement. Use accessible render readiness rather than viewport pixel visibility, so screen-reader users are not excluded. Do not infer attendance from browser visibility.

If the client rendered a portion but the acknowledgement response was lost, resend the same receipt. On reconnect, retrieve authoritative published sequences and pending receipts before advancing. If a client never confirms, hold the affected delivery-dependent action and reconcile at Class closure; do not convert absence of acknowledgement into a wrong answer.

### 15.5 Durable scheduling

Persist the next eligible release, reasoning-group boundary, active pause, last published and last confirmed sequence, policy version and resumption anchor. Workers use durable due events, leases and current-state reconciliation, not browser `setInterval` as academic authority. The browser may animate and display clocks but cannot advance the official position offline.

Use at-least-once transport/worker delivery with idempotent effects. Do not promise distributed exactly-once execution. Unique keys and transactional commits provide one accepted business effect per operation.

## 16. Student messages, queue, and allowance

### 16.1 Admission transaction

Validate authenticated ownership, active session, permitted interaction, size/modality, quota lane, task linkage and idempotency key. Within one transaction, record message, capture context anchor, consume allowance if applicable, create its queue record, write acceptance event/outbox and return receipt/balance. If the operation fails, none of those effects partially survives.

A stable idempotency key binds the exact content and target. A retry with different content under the same key fails with conflict. A message admitted once is charged once even if routing, generation, queue scheduling or answer delivery retries. Do not refund a queued message merely because it was deferred; any policy refund is a separate auditable operation.

### 16.2 Routing and dispositions

Use the six coordinator classifications and six dispositions exactly as supplied. Store primary classification plus additional concerns where relevant. Exactly one disposition per accepted message in each accepted routing result. Related questions can share an answer, but retain source messages and coverage of all concerns.

The queue's instructional states match the prompt: waiting, ready, needing clarification, answered, unresolved at closure. Processing leases/attempts are separate operational fields. Respectful redirection can be an answered communication with difficulty resolution not applicable; it is not erased. A combined message points to its group and preserves its unresolved/answered lineage. Do not invent incompatible prompt queue enums solely to represent worker state.

### 16.3 Timing commitments

Immediate handling is permitted for an important blocker, correction or policy-defined urgent interruption. Normal messages wait for a true teaching pause, not every paragraph end. A serious error can trigger immediate release hold before more false content is exposed.

The runtime persists an anchor-bound commitment: next suitable pause, a specified relevant unit, closure handling, or follow-up proposal. The coordinator's three timing labels are extended through a compatible scheduling artifact where a later-unit anchor is needed; the engine must not force a new timing string into the closed default enum.

An acknowledgement can safely say Received after admission. “After this example” requires an accepted committed boundary obligation. “Next class” or an appointment requires confirmed planner/scheduler arrangement. At closure, pending work is explicitly carried forward without claiming a scheduled response.

### 16.4 Allowance lanes

Charge only successfully accepted student-initiated conversational turns. Do not charge answers to Teacher tasks, Teacher-requested clarification, approved extra-time controls, technical issue reports, correction reports through a defined control lane, JOIN/leave/pause/pace controls, failed sends, or duplicate retries.

Use explicit server-owned lanes. A client cannot evade quota by labeling arbitrary questions as a Teacher reply or technical report. Link task replies/clarifications to an actual open request and validate content size/rate limits separately from conversational allowance. Reserved technical/correction reporting remains bounded and cannot become an unmetered tutoring channel.

After exhaustion, show a clear balance/state, preserve drafts, and keep all Teacher-initiated participation and support controls functional. A new discretionary question is not falsely accepted. Provide a non-promissory route to record a follow-up request if the configured product policy supports it, without automatically granting another live AI response.

Message count, per-duration allocation, replenishment, fair exceptions, admission rate limits and cost budgets require a versioned configuration decision. The UI displays server balance; the Teacher receives it only when communication requires it.

### 16.5 Queue fairness

Order by material instructional urgency, appropriate lesson relevance, committed boundary and waiting age. Preserve deterministic tie-breaking and auditable coordinator rationale. An earlier relevant question must not starve behind a stream of minor new messages. When remaining time cannot satisfy a committed handling point, persist revised unresolved status and explain the changed situation without blaming the student or fabricating follow-up.

## 17. Questions, response windows, and interpretation

### 17.1 Task preparation

Questions may check prerequisites, interpretation, prediction, reasoning, method selection, application, useful connections, uncertainty, or post-help verification. Use the smallest useful check; do not question after every paragraph or retest secure evidence without a reason. Validate source/criteria, acceptable alternatives, modality, prior exposure, assistance and inference ceiling.

A conversational clarification such as Which term is unclear? is not automatically a scored check. Distinguish informal clarification, practice, independent evidence and formal measurement explicitly.

### 17.2 Window activation

Create a pending task/window before release. Release the complete question and required representation/fallback. Once active-client delivery readiness is confirmed, the server records `openedAt`, authorized duration, effective deadline capped by Class constraints, extension eligibility and policy version. The UI receives those timestamps and uses server offset.

If required delivery cannot be confirmed before the remaining Class time supports the task, cancel/hold the pending task with a system reason and no negative academic inference. Never start a full problem's countdown while its diagram is still loading. A late reconnect receives the original window; it does not restart it.

### 17.3 Response lifecycle

Proposed window states: PENDING_DELIVERY, OPEN, RESPONSE_ACCEPTED, EXPIRED_NO_RESPONSE, CLOSED_BY_CLASS, CANCELLED_SYSTEM. Extension is an event/version update of OPEN, not a second concurrent window. Only one blocking question is open for the individual session at a time unless an explicitly designed activity contract permits more.

Answer acceptance validates task/window/session versions and permitted modality. Persist server receipt time and an idempotency key. Browser time is diagnostic only and cannot backdate an answer. Preserve accepted work and partial drafts where authorized; private local drafts are not submitted academic evidence.

More-time requests follow runtime policy, remaining time and authorized accommodations. Typing activity may support a bounded proposal only if policy permits; it never implies correctness, effort, emotion or an automatic entitlement. The model cannot invent duration. “I'm not sure” is a valid interaction and can support a permitted adjustment; it is not misconduct.

### 17.4 Deadline races

Use one server transaction boundary and database/server time. If submission is accepted before the effective deadline/closure transition, preserve it even if the acknowledgement arrives later. If expiry/closure commits first, apply the configured late-submission policy and explain the result; do not trust an old client deadline. Any transport grace must be an explicit bounded policy, not improvised by the Teacher.

A timeout records no response. An incomplete received response records partial evidence. System failure, inaccessible representation, invalid task, or uncertain delivery protects against negative academic attribution. The next action comes from accepted current context, not a presumption that silence means confusion.

### 17.5 Interpretation acceptance

Capture immutable question, criteria, source, exposure/assistance and response snapshots. Invoke coordinator `interpret_response`. Validate schema, requested capability/mode, task/criteria/response references, applicable state, inference limits, content checks and policy. Commit the accepted interpretation with its provenance; select only permitted feedback findings for TPF-08.

Ordinary classroom acceptance is not independent academic verification. Formal/external validation remains with its owner. If an interpretation is academically uncertain, withhold the affected verdict, keep usable unaffected work and route review. Do not block all normal instruction indefinitely for an unrelated unresolved subclaim.

### 17.6 After closure

Current D12 rejects closed-class/stale-controller evaluation. Add an explicit reconciliation path for a response already accepted while its task was valid. It evaluates against the immutable accepted context and current evidence-governance rules, not a reopened live Controller. It cannot release a live continuation, alter Class end, or fabricate in-Class feedback.

Record evaluation-completed-after-closure and reconcile downstream summaries/notes through a new version. A later-authorized review may show selected feedback in history. Work submitted only after closure follows the configured admission policy and is never silently backdated as live evidence.

## 18. Assistance, exposure, and evidence

Use the shared assistance scale: none, attention, directional, conceptual, partial_step, strong_scaffold, worked_example, full_instruction. Maintain explicit maps to existing D11/D12 enums; reject unknown values. Different domains may permit different ceilings; Classwork is not simply unrestricted chat practice.

Track prepared assistance separately from released assistance. Publication makes material accessible; confirmed client rendering is stronger delivery provenance but still not proof of comprehension. For independent-evidence eligibility, do not assume unavailable receipts prove no exposure. Record accessibility of answer/method material conservatively and let the evidence owner decide permitted inference.

Record chapter/Board content made accessible, exact question/answer/example lineage, analogies, hints, revealed steps, resources, authorized accommodations, response attempts and self-correction. Authorized tools/accommodations do not automatically reduce independence when the construct remains intact. A lighter hint later cannot undo an earlier answer disclosure.

Task demand preserves five dimensions: familiarity, method cueing, representation demand, integration demand, retention timing. Use the supplied closed values. Do not collapse them into one difficulty score. Familiar independent performance, uncued method selection, delayed retention and integration/transfer are different claims. A copied surface pattern cannot establish transfer.

If a chapter example solves the active task or an effectively equivalent task, ordinary practice remains legitimate, but fresh independent verification must use validated appropriate variation and allowed resources. Concealing the chapter pane after exposure cannot make the student unsee it. Do not claim independent evidence solely because the student closed the pane.

The coordinator supplies interpretations and proposals. Official evidence state, SKM, gradebook, eligibility and progression changes use their authorized pipeline. An answered help request is not a mastered objective; a displayed chapter is not covered; a clicked Finished signal is not independent competence.

## 19. Corrections and lesson replanning

### 19.1 Correction protocol

Accept and trace a reported error. Hold affected unreleased content if continued release could compound the error. Recheck the claim through the proper source/self-correction capability. Distinguish teacher correct, confirmed error, unresolved disagreement and source conflict.

For a confirmed error, create a versioned correction linking original chapter/portion/Board/task references, corrected academic point, validation, affected evidence and proposed repair. TPF-08 communicates the correction explicitly once authorized. TPF-05 revises the chapter only when authoring content actually changes. The engine publishes a visible correction or superseding object; it never silently rewrites delivered history.

Invalidate dependent buffered explanation/checks. Request evidence recheck/invalidation through its owner. Faulty instruction is not a student weakness. Resumption identifies the last valid reasoning step and necessary corrected bridge.

### 19.2 Replan protocol

Immediate adjustment remains coordinator-owned within the current route and time. Significant scope/sequence/objective/time changes request TPF-05. Capture current anchor, delivered portions, completed activities, valid evidence, unfinished essentials, pending messages/tasks, failed strategies and actual remaining time. Preserve completed work.

Validate proposed remainder against current scope, prerequisites, standards, time and protected commitments. D11 applies the accepted replan atomically with version change. Supersede incompatible guide/presentation/check candidates. The chapter remains stable unless a specific correction is approved. Explain meaningful changes simply to the student.

Late arrival does not recreate lost time or extend the scheduled end. Choose a minimum legitimate shortened lesson or bounded review/practice/preparation/recovery activity. Essential deficits are explicit carry-forward, never automatic failure or reduced standards. Early dismissal and break requests receive authoritative disposition; recording them is not granting them.

## 20. Memory and continuity

Retain exact records of up to the last three existing relevant classes: chapter/plan versions, released and delivery-confirmed portions, Board/visual objects, questions/messages/answers, evaluations, exposure, corrections, pause/resume anchors, actual work labels, unfinished units and pending questions. Keep a complete durable archive; the three-class horizon is a preferred retrieval scope, not deletion policy.

Older summaries identify what was discussed/presented, what was validly demonstrated, what remained uncertain, assistance and failed strategies, and confirmed/proposed follow-up. Each consequential claim links to its source record and summary version. Do not generate summaries from timetable slots or unreleased buffers.

History states distinguish confirmed first class/no prior classes, fewer than three existing classes, records available, records unavailable, summary-only and sufficient excerpt. Missing history blocks only historical claims that depend on it, not ordinary current teaching.

Prepare continuity broadly enough to identify useful prior connections, then supply only relevant excerpts per call. A connection identifies source, academic relationship and present purpose. No forced callbacks. “We discussed this” is grounded in prior presentation; “You demonstrated this” needs valid evidence.

Use bounded retrieval with ownership, course/competence scope, version and purpose filters. Keep protected future assessment content out of memory lanes. A question can link into a later class through carry-forward records while the old Class remains immutable. Resolve the old question only with the confirmed outcome and cross-class link, not merely because it was copied into a summary.

## 21. Closure, homework, assessments, and TPF-20

### 21.1 Coherent closure

The runtime supplies closing constraints early enough to select a meaningful stopping point. Coordinator `close_class` preserves unfinished essentials, pending queue, open response, actual delivery and evidence. TPF-08 gives a concise authorized closing; it does not generate the formal summary or claim an uncommitted end.

D11 closure commits the session outcome, final position, actual work statuses, open-task dispositions, unanswered questions, evidence references and carry-forward. Unreleased generated content is not taught. A derivation interrupted at the hard boundary is recorded as unfinished with a resumption anchor; the system does not extend time automatically to hide it.

Respond to an in-flight answer under the deterministic race policy. Accepted work stays eligible for later evaluation. Pending questions become visibly unresolved at closure; confirmed answers keep their links. Do not use the current retire-help CANCELLED behavior as the target semantics for losing all unanswered questions.

### 21.2 Homework

Coordinator guidance provides actual coverage, difficulties, exposure, independence needs and task requirements. TPF-05 decides a proposed purpose and whether homework beats no homework. Assignment is downstream authority. A provisional pre-Class proposal must be checked against actual closure.

Generated tasks require explicit homework-design mode/request, permitted assistance/resources, objectives, evidence claims, demand/lineage, private criteria, correctness/answerability checks, estimated effort range and workload validation. Missing work is missing evidence, not proven weakness. System failure or excused absence does not justify punitive replacement load. Deadline ownership stays with the scheduler/workflow.

### 21.3 Formal assessment

Guide assessment with actual taught/unfinished objectives, uncertainty, exposure, assistance, relevant competence and legitimate evidence needs. Preserve formal package planning, generation, repair, validation, eligibility, locking, integrity, marking and appeal workflows. Ordinary Teacher context excludes protected future tasks/keys. Classroom tutoring cannot silently authorize a Test/Exam or change standards.

### 21.4 TPF-20 and Study Pack

Retain pre-Class private preparation and post-Class actual-teaching reconciliation. Supply stable chapter/plan/closure references, delivered explanation, useful examples, corrections, answered/pending questions, sources/card-set provenance and any late evaluation versions. Preserve binding checks and stale-result rejection.

A reconciled note remains a candidate/private validated artifact until the proper publication owner confirms release. The existing `PRIVATE_VALIDATED_AWAITING_D27` distinction is useful and should remain semantically equivalent. The student UI shows Chapter, Class Summary, and Class-grounded Study Notes as distinct artifacts with availability and version, without duplicating all content into chat.

Unavailable source/card-set/qualified route produces a truthful held state. Note failure does not erase the Class record or convert prepared chapter material into actual delivered notes. Later reconciliation produces a new linked version, never silent history replacement.

## 22. Data and transactional contracts

### 22.1 Data model principles

Use existing PostgreSQL/Supabase persistence and private runtime/public domain patterns. Names below are logical proposed entities, not claims of existing tables or executable migration SQL. Final physical names must follow repo conventions and collision checks. Migrations are additive first, with foreign keys, ownership, uniqueness, indexed access patterns and explicit grants/RLS.

- **Chapter versions:** chapter identity/version, Course/scope/source bindings, author prompt/schema hash, completeness/validation, approved public content, units/elements, prior/replacement mapping.
- **Teaching-plan versions:** Blueprint/plan identity/version, chapter binding, objective priorities/treatments, phases/time ledger, evidence/trajectory, reserve, stopping and carry-forward.
- **Guide versions:** coordinator capability/mode, exact source coverage, subgroups, reasoning, examples, pause/stop/expand conditions and validation.
- **Presentation sequences/portions:** immutable validated content, exact dependency binding, parent sequence/order, public wording/Board refs, private checks, generation job and lifecycle.
- **Conversation events:** server order, role/type, portion/message/task reference, public release state, timestamps and corrected/superseded links.
- **Delivery state:** one row per session, subordinate state/version, epoch, last release/receipt, active reasoning group, pause/pace policy, active client lease, next due release, return anchor.
- **Delivery receipts:** portion/client/session binding, render/fallback readiness, server-received timestamp, deduplication key and limited fact semantics.
- **Messages/queue:** accepted content, context, allowance lane, classification/disposition, queue/group/commitment, acknowledgement/reply receipts, unresolved need and attempts/lease.
- **Allowance ledger:** policy/budget snapshot, immutable charge/refund entries, unique message key, reconciled balance.
- **Tasks/windows:** private criteria, public question, source/exposure/assistance, target, modality, lifecycle, readiness/open/deadline/extension records and active task version.
- **Responses/interpretations:** reuse/extend D12 records with immutable accepted context, interpretation acceptance, evidence limits and post-closure reconciliation.
- **Corrections/remaps:** changed academic point, original/updated references, content/evidence impact, owner confirmation and public correction link.
- **Continuity/follow-up:** source-linked summaries, unresolved question links, actual work, confirmed versus proposed next steps.
- **Generation jobs/hand-offs:** capability/mode/schema/version, context digest, lease/cancellation, provider outcome, validation, current-state acceptance and resulting artifacts.

Notebook, Teacher communication, Board objects, visual assets, Class sessions, responses, attendance, summaries and study-note records should be reused or extended through adapters where their semantics fit. Do not create a second storage owner for the same accepted answer or attendance outcome.

### 22.2 Required constraints

Unique live session/start admission per authoritative Class rules; unique idempotency key scoped to student/session/operation; unique sequence order within conversation; unique portion release; unique allowance charge per accepted message; unique active blocking task where applicable; unique receipt for the same released portion/client epoch; asset/Board ownership/session references; valid version/anchor maps; immutable accepted-response context. Foreign keys must prevent cross-student/session associations.

Use indexed pagination by session and server sequence, queue indexes by due commitment/status, job/event indexes by due/lease, and version lookup indexes for chapter/guides. Bound reads; do not load every transcript into each snapshot.

### 22.3 Atomic operations

- Admission: message + quota charge + queue + event.
- Teacher publication: accepted current authority + communication/portion + Board references + public conversation event + outbox.
- Question activation: verified dependencies/receipt + one open window/deadline + subordinate state update.
- Response acceptance: task/window check + response/assistance snapshot + window transition + evaluation event.
- Reply completion: confirmed delivery + linked message/group outcomes; difficulty resolution remains separate evidence-backed state.
- Replan application: D11 version update + delivery epoch/invalidation + successor binding + event.
- Closure: session finalization + open-task disposition + unresolved queue carry-forward + closure fact/outbox.

Avoid transactions across AI/provider/network calls. Use claims/leases and revalidation before a short final transaction. Store failure/unknown outcome rather than retrying paid generation blindly.

### 22.4 Asset continuity

Reuse `teaching_runtime.classroom_visual_assets` and authenticated retrieval. Keep generated bytes/SVG private, sanitized and subject to committed-reference ownership checks. The current visual service has a 25-second deadline and a durable 12-request-per-session bound; treat these as existing visual defaults to preserve initially, not global teaching pace/message policy. Any change is a reviewed versioned configuration change with provider tests.

Add chapter asset references through the same validated ownership/publication model. Do not permit chapter URLs to bypass protected retrieval or introduce public external images. Shared approved chapter assets can be Course-scoped only with an explicit ownership/access model, not by weakening student-scoped queries accidentally.

## 23. API and event contracts

### 23.1 Existing routes to preserve or adapt

Retain authenticated `/api/teaching` mounting, shared `KIWI_API_CLIENT`, request timeout/cancellation and existing ownership checks. Preserve class list, classroom snapshot, asset retrieval, enter, Notebook, interactions, classroom responses, Controller and Blueprint preparation routes. Add version/capability negotiation so old clients receive compatible behavior rather than new semantics hidden under old response shapes.

`GET /courses/:id/classes` continues server-derived availability/history. `POST /classes/:id/classroom/enter` remains idempotent JOIN/attendance observation, not a delivery-completion receipt. `POST /classes/:id/classroom/responses` remains D12 capture for compatible old tasks; remodeled tasks require explicit task/window binding and cannot infer an arbitrary first planned Learning Unit.

### 23.2 Proposed remodeled routes

These are target route designs, not existing endpoints:

- `GET /classes/:id/classroom/session`: public session/capability/version snapshot, authoritative clocks/state, cursor and active task/window, balances, chapter refs and connection/recovery information.
- `GET /classes/:id/classroom/conversation?after=...`: bounded released-event delta/history pagination with monotonic cursor.
- `GET /classes/:id/classroom/chapter`: validated accessible chapter/anchor projection for the bound version; protected-mode authorization applies on every call.
- `GET /classes/:id/classroom/stream`: authenticated resumable server-sent events for released public events and invalidation/state notices.
- `POST /classes/:id/classroom/messages`: transactional admission/receipt/quota result.
- `POST /classes/:id/classroom/delivery-receipts`: idempotent authorized render readiness/confirmation.
- `POST /classes/:id/classroom/presentation-controls`: typed pause/resume/pace command, expected state/epoch and idempotency.
- `POST /classes/:id/classroom/tasks/:taskId/responses`: task/window-bound response acceptance.
- `POST /classes/:id/classroom/tasks/:taskId/extensions`: permitted extension request and confirmed outcome; no model-granted deadline.
- `GET /classes/:id/classroom/questions`: public queue outcomes and unresolved historical references, without private routing rationale/criteria.
- `POST /classes/:id/classroom/client-lease`: claim/renew active control client under ownership and concurrency rules.

Do not expose internal guide/criteria/context retrieval through general student routes. Follow-up/outside-class Q&A uses the existing authorized Course route or a separately designed admission route; it does not reuse a completed live session as writable.

### 23.3 Common envelope

Public snapshots/deltas include schema version, session/Class identity, Controller/delivery versions, delivery epoch, server time, policy/capability projection, cursor, permitted actions and only released public content. Commands include typed intent, expected relevant versions, idempotency key and target refs. Return accepted/applied distinction, operation receipt, current authoritative state/version and conflict/retry information where applicable.

A state conflict returns reconciliation instructions, not a guessed success. Invalid admission, quota exhausted, protected activity, stale task, missing route qualification, dependency not ready and system failure are distinguishable error codes mapped to concise UI text. Do not leak SQL/provider details to the student.

### 23.4 Event design

Reuse existing durable runtime/outbox and domain events where semantics fit. New events need schema registration, actor/aggregate identity/version, correlation/causation, idempotency, occurred/effective/due time, provenance and payload validation.

Candidate event semantics: chapter/guide accepted; presentation prepared; portion release due/published; delivery confirmed; message accepted/disposition committed; boundary commitment due; question released/window opened/extended/expired; response accepted/interpretation accepted; correction accepted; delivery authority superseded; client lease changed; closure reconciliation due; unresolved follow-up linked.

Internal events may carry private references. Public stream projection is a separate allowlist. SSE delivery is not a domain commit and its network receipt is not a render receipt. Durable events remain authoritative if every browser disconnects.

### 23.5 Transport choice

Use resumable SSE for server-to-client deltas with ordinary authenticated HTTP commands as the target baseline; verify deployment/proxy behavior before adopting it. Reuse the shared session client: fetch-based SSE supports required headers/refresh/cancellation; do not place bearer tokens in URLs. Existing WebSocket infrastructure may be an alternative only after protocol/ownership review, not an assumed Classroom implementation.

Provide cursor-based polling fallback with the same released-event/state contract. Improve latency through transport, not by weakening validation. Reconnect deduplicates server sequence, retrieves missing deltas and active state, reconciles receipts and drafts, then resumes eligible release. A snapshot reset is required if the cursor is outside retained live-delta history.

## 24. Concurrency and recovery

### 24.1 Multiple tabs/devices

Permit read-only observers for the same authorized session, with one active control client lease/epoch for delivery advancement and timed-task readiness. A second client requests explicit takeover, which increments the control epoch and reconciles state; old control commands/receipts fail safely. Accepted conversation history remains shared. Responding through an observer requires takeover or an explicitly authorized server admission rule, not independent competing timers.

Lease expiry does not close the Class or penalize the student. It pauses affected delivery-dependent advancement while durable Class time continues. Recovery claims a new lease and resumes from confirmed position. A phone cannot restart a question countdown that already opened on a laptop.

### 24.2 Reload/offline

Reload restores session versions, chapter, conversation cursor, confirmed position, active question/window/deadline, queue, allowance, local navigation and permitted draft. Avoid offline academic writes; retain local drafts securely and reconcile on reconnect. Do not queue an answer for automatic late submission without showing its current admission status. Expired tasks preserve draft for permitted review, never silently submit into a new task.

No automatic replay of all teaching. If publication occurred but delivery confirmation is missing, reconcile exact portions. A recovery recap is an explicitly labeled authorized bridge, not new coverage of the same material.

### 24.3 Worker/provider failure

Generation failure holds the dependent move with a calm status, preserves conversation and retries only under bounded policy. Lost lease or ambiguous provider outcome requires reconciliation before another paid attempt. A process crash after commit but before dispatch is recovered through outbox; a crash before commit creates no public claim. Worker duplicate execution has one effect through unique operation keys and state guards.

Essential visual failure either uses a validated adequate alternative or holds the affected task/explanation. Optional illustration failure preserves accurate text. Never show phantom visuals or pretend an unproduced asset exists.

### 24.4 Closure and stale work

All late model results re-read current authority. After closure, no normal live portion is published. Compatible private reconciliation work can complete through its explicit route. Superseded output is preserved internally for audit but not released. Rollback cannot send an old worker to continue a new-schema session without a tested adapter.

## 25. Security, privacy, and accessibility

### 25.1 Server enforcement

All reads, commands, streams and assets enforce authentication and student/Course/Class/session ownership. No service-role secret or internal context reaches the browser. Private criteria, expected answers, source credentials, operational prompts, raw provider messages and unreleased content remain server-only. Public DTOs are constructed allowlists, not object spreads with a few keys removed.

Use explicit private-schema grants/RLS and owner-scoped queries with service-only access where appropriate. Existing RLS is defense in depth, not permission to omit application authorization. Maintain independent review of SQL/JSON/SVG/Markdown rendering and source injection paths.

Sanitize math/Markdown/SVG, allowlist URLs/types/operations, render code inertly, limit bytes and nesting, and validate asset MIME/content. Student/source text cannot become an instruction, raw SQL, executable JS, or arbitrary tool call. Cancellation and resource limits apply to all provider jobs.

### 25.2 Protected content limitations

Revoke live resource access on protected-mode transition, stop streams, invalidate incompatible buffer and close affected UI. Clear restricted in-memory surfaces where practical. Do not promise that previously displayed chapter content can be made unseen or that a browser can enforce perfect anti-copy protection. Evidence/assessment design must account for prior exposure and authorized resources.

Never preload future private questions/keys into client state. Cache keys include identity/session/mode/version; sensitive routes use appropriate cache controls. Reauthentication and sign-out clear relevant state. Verify existing session-auth/CSRF/CORS behavior rather than adding a conflicting auth stack.

### 25.3 Data minimization

Mode-specific context includes only necessary academic/source/evidence history. No unrelated grades, intake, demographics, personality labels or psychological inference. Exact transcripts have retention/access policy distinct from the three-class retrieval horizon. Logs contain IDs, hashes and reason codes by default, not raw sensitive text. User-visible history access follows ownership and correction/version policy.

### 25.4 Accessibility

Keyboard-operable composer, controls, tabs, sheets and expanded representations; meaningful focus restoration; stable headings/landmarks; visible focus; adequate contrast; adjustable readable text; responsive layout and touch targets. Use live-region summaries judiciously: do not have a screen reader announce every streamed word or repeated clock tick.

Provide semantic equations, explanatory text, alt text, graph/data alternatives, accessible code and clear question instructions. Respect reduced motion, allow instant animation completion, preserve reading order, and never require mouse text selection as the only note-taking method. Response-time accommodations come from authoritative policy, not inferred disability.

Test software keyboard, long equations, zoom/reflow, screen readers, delayed asset loads, narrowed panes and scrolling without focus loss. Class/response countdowns are labeled separately and convey expiry without color alone.

## 26. Performance, cost, and observability

### 26.1 Bounded work

One coordinator call per meaningful event, not each token/sentence or timer tick. Batch related routing where coherent, while keeping one mode/action and every message disposition. Reuse validated guides, actual chapter objects, assets and compatible prepared sequences. Limit transcript/context retrieval by purpose and references.

Budget chapter generation, guide preparation, live Presenter calls, check/evaluation, visuals, retries and continuity separately. Do not silently compress the chapter or remove essential explanation to meet spend. A budget constraint produces an explicit fallback/hold/carry-forward decision. Exact counters/rates are configured and measured, not claimed from this blueprint.

### 26.2 Metrics

Track preparation readiness/failure, first releasable opening latency, generation/validation time, buffer starvation, portion release lateness, render receipt lag, stale-result rejection, duplicate-effect prevention, queue waiting age/closure backlog, response activation/extension/expiry causes, interpretation acceptance and protected-mode refusals. Track cost by capability/mode/session and provider failure reason.

Academic quality review distinguishes chapter completeness/correctness, explanation coherence, repeated ineffective strategy, excessive interruption, task fairness, evidence overclaim and inaccurate historical connection. Do not optimize for word count, number of questions or apparent objective completion alone.

### 26.3 Operational diagnostics

Every job/action carries trace/correlation and causation through API, orchestrator, provider, validation, repository, outbox and public event. Internal views show blocked dependency, owner, retry condition and affected references. Student UI gets truthful simple states without model/provider internals. Alerts focus on sustained unsafe release, lost commitments, stuck active windows, ownership breaches and failed reconciliation, not noisy ordinary pauses.

## 27. Repository integration and infrastructure

### 27.1 Frontend files

- `public/teaching-classroom.js`: retain course-shell registration/history/entry integration; split its large implementation into versioned session client, conversation renderer, chapter renderer, response/composer controller and recovery/navigation modules as coherent responsibilities.
- `public/teaching-classroom.css`: replace primary Board/Workspace composition with the conversation/chapter design while retaining readable Board primitives and responsive/accessibility conventions.
- `public/kiwi-api-client.js`: extend authenticated delta/stream handling only if needed; reuse its timeout, refresh, blob and cancellation behavior.
- `public/teaching.js` and course-section modules: preserve entry points, course availability and historical preview behavior.
- `public/teaching-d16.js`, `public/teaching-assessments.js` and assessment shell integration: implement real protected-work handoff and return/review rules with the existing owners.
- Existing typography/accessibility/reliability scripts: preserve shared tokens and review adapters instead of creating another conflicting global style/state layer.

All new paths are implementation proposals. Do not claim files already exist because their responsibilities are named here.

### 27.2 Backend files

- `teaching-backend.js`: versioned Classroom routes, typed command admission, public projection/stream, ownership and readiness gates; preserve existing authentication/test-instance boundaries.
- `teaching/index.js`: compose the delivery/coordinator/presenter adapters through existing persistent dependencies and runtime registries.
- `teaching/d11/contracts.js` and service/runtime: Blueprint chapter bindings, accepted replans, composite transition guards, closure/task reconciliation and authoritative time policy.
- `teaching/d12/intelligence.js`, contracts/service/runtime/repositories: coordinator mode adapters, compatible response interpretation, assistance/exposure acceptance and immutable post-closure evaluation.
- `teaching/d14/service.js` and repository/runtime: append-only conversation, persistent message queue, Notebook refs, atomic release, public deltas and receipts; retire latest-message-only assumptions for new sessions.
- `teaching/d14/visual-service.js`, Board/visual contracts and asset repository: chapter/portion dependency integration while preserving budgets, cancellation, sanitization and ownership fences.
- `teaching/runtime/*`: durable due release/window events, worker reconciliation, leases and transactional outbox using current abstractions.
- `teaching/preparation/*`: dependency order/readiness and compatible reuse.
- `teaching/orchestrator/*` and `teaching/prompt-runtime/*`: registered mode schemas, minimized context, canonical coordinator family binding, state revalidation and visibility-aware adapters.
- `teaching/capability-registry/*`: generated migration ledger, counts/hashes, aliases, authority and historic manifest resolution.
- D15/D16/D17–20/D22/D25/D27/D30/D31 integrations: preserve domain boundaries and qualify the changed flows.

### 27.3 Infrastructure work

During implementation inspect the actual GitHub branch/PR/CI state and current deployment configuration before modifying infrastructure. Determine which service runs Express/API/workers, which host serves static assets, and which PostgreSQL/Supabase database is authoritative. Do not assume Vercel, Render and Supabase all perform the same task or create duplicate services merely because connectors are available.

For Render or the actual API host, verify durable worker execution, restart safety, stream timeouts/proxy behavior, health/readiness, environment policy and autoscaling/concurrency constraints. For Supabase/Postgres, validate migrations, grants/RLS, indexes, connection/transaction behavior, event leases and backups. For Vercel or the actual frontend host, verify asset versioning, route/API configuration, auth origins, deployment compatibility and caching. Do not disclose secrets.

No infrastructure mutation is required to author this blueprint. Production readiness requires observed live behavior, not only code or fixture success.

## 28. Delivery phases and rollback

### Phase 0 — Baseline and responsibility audit

Pin repository/branch/commit and infrastructure state. Produce a machine-derived caller/capability/prompt/schema/owner ledger for all 22 migrated capabilities and retained 05/08/20 uses. Inspect actual governing policies and preparation/qualification rules. Identify historical formats and active sessions. Exit only when every caller and specialized artifact has a destination or explicit retained compatibility route.

### Phase 1 — Contracts and prompt consistency

Apply the twelve amendments, choose canonical coordinator identity, implement mode schemas/enums, semantic adapters, visibility projections and reference resolution. Define versioned runtime policy including pause/pace, allowance, response duration/extension/grace, closure lead time and budgets. Keep unresolved values visible as release configuration requirements. Exit with complete contract fixtures and no silent dropped fields.

### Phase 2 — Chapter and preparation

Implement complete chapter authoring/continuation, unit/source mapping, plan/time validation, guide/check preparation, dependency invalidation and readiness. Render representative chapters. Exit with accurate independently usable material and a feasible plan across simple/dense subjects, including source conflict/partial-output handling.

### Phase 3 — Durable engine

Implement subordinate states, jobs/leases, portion lifecycle, publication/receipt separation, due releases, boundary commitments, client control lease and replay. Exit with deterministic recovery and no duplicate/unauthorized release under crash/race tests.

### Phase 4 — Conversation/chapter frontend

Ship the new surface behind session-version/feature gating. Connect public DTOs, active navigation, pacing, composer, Board, Notebook, mobile and accessibility. Exit with real backend integration and preserved entry/history/protected surfaces; screenshots alone are not sufficient.

### Phase 5 — Messages and allowance

Implement atomic admission, quota ledger, routing, saved commitments, acknowledgements, grouping, unresolved follow-up and queue fairness. Exit with exhaustion/duplicate/reload/closure cases passing and no unconfirmed promises.

### Phase 6 — Checks, evaluation and adaptation

Implement task delivery readiness, windows, extensions, response acceptance, coordinator interpretation acceptance, assistance/exposure, strategy and TPF-05 replan. Add post-closure evaluation reconciliation. Exit with fair question handling, protected boundary refusal and accurate evidence claims.

### Phase 7 — Continuity and academic lifecycle

Integrate exact recent history, older summaries, corrections, carry-forward, homework, formal assessment guidance and TPF-20/D27. Exit with accurate next-Class resumption and notes generated from actual records.

### Phase 8 — Qualification and staged rollout

Qualify model routes and governed prompt/schema changes, run full CI/integration/security/accessibility checks, then observe live chapter→presentation→question→answer→recovery→closure→notes flows. Use a small authorized cohort or test-instance policy first, then expand only with release gates passed.

### Phase 9 — Retire obsolete paths

Remove active 04/06/07 bindings only after every migrated/non-classroom caller is qualified. Remove old Need Help/one-message delivery paths for new sessions, preserve historical readers and adapters, and update manifests, counts, documentation and workflows. Do not delete original evidence or rewrite historic prompt provenance.

### Rollback rules

Use additive migrations and explicit session/schema version selection. A session retains its opening engine/prompt contract versions unless a tested migration upgrades it. Rollback stops new remodeled sessions and unsafe releases; existing new-format sessions either continue on a supported compatibility engine or pause with truthful recovery. Never downgrade them blindly into the old latest-message UI, reset timers/quotas, or discard pending questions.

Prompt/schema/engine/frontend release versions are coordinated. Preserve deployable prior builds and compatible database readers. Reverting code is not enough if registry hashes, prompt catalog, migrations, routing and clients disagree. Rollback must be rehearsed against an active question and unresolved queue.

## 29. Qualification scenarios

Each scenario verifies public UI, backend state, persisted records, prompt provenance, event outcomes and evidence limits. Fixture tests establish deterministic behavior; actual provider/deployment observation establishes live integration.

1. **Simple concept:** concise complete chapter and proportionate explanation, no padding or mandatory check.
2. **Dense equation:** symbols/conditions/steps remain connected; pace/Board dependency works; pause resumes unfinished reasoning correctly.
3. **Long chapter continuation:** partial generation preserves complete units/anchors; continuation finishes without restart, duplicate or summary compression; Class cannot falsely claim readiness.
4. **Ordinary flow:** automatic release within approved span, no Next requirement, no coordinator call per sentence.
5. **Immediate blocker:** accepted message holds appropriate release, receives one disposition, changes only the relevant explanation and resumes at the anchor.
6. **Boundary deferral:** acknowledgement matches a real stored example/boundary commitment; later delivery resolves the linked question.
7. **Related messages:** one response covers all linked concerns, originals remain traceable, unanswered parts persist.
8. **Unrelated/protected request:** respectful redirection without prohibited answers, loss or false promise.
9. **Allowance exhaustion:** new discretionary message fails admission truthfully; teacher reply/clarification/extension/technical controls remain available; retry charges once.
10. **Wrong answer:** item validity checked first; local slip versus conceptual hypothesis distinguished; correct components preserved; strategy change is proportionate.
11. **Assisted answer:** released hint/solution exposure limits independence; fresh verification is legitimate variation; reduced later help does not restore old evidence.
12. **Chapter copyability:** accessible worked solution cannot be treated as clean independent verification.
13. **Question asset delay:** timer does not open before complete accessible question/fallback readiness.
14. **More time:** authorized extension persists once and respects end time; typing does not invent a new deadline.
15. **No response:** records no response, no invented failure/emotion; Class closure/task disposition remains coherent.
16. **Open window clarification:** related permitted help preserves task/window and records assistance; unrelated instruction remains held.
17. **Reload during presentation:** exact current position and public history restore without duplicating teaching.
18. **Reload during timed task:** original deadline remains, drafts are separate, quota unchanged.
19. **Lost send/receipt acknowledgement:** same idempotency key reconciles outcome, no duplicate quota/message/delivery event.
20. **Two devices:** takeover changes control epoch, stale control actions fail, no competing timers or advancement.
21. **Background/offline client:** no unsupported render/attendance inference; reconnect reconciles and no automatic late answer backdating.
22. **Worker crash:** before/after commit, outbox and leases recover one business effect.
23. **Provider stall/unknown outcome:** bounded retry/reconciliation, readable preserved lesson, no fabricated completion.
24. **Optional/essential visual failure:** accurate text fallback or explicit hold; no phantom asset, unsafe SVG or unowned retrieval.
25. **Correction:** public corrected statement, chapter/Board version links, invalidated buffer and evidence recheck; no silent rewrite or student blame.
26. **Substantial replan:** TPF-05 revises only remaining work; D11 accepts current version/time; completed activity preserved.
27. **Late/very-late Class:** legitimate remaining activity, no automatic overtime, truthful carry-forward.
28. **Break/early dismissal:** request is not grant; actual authority and resumption preserved.
29. **Protected takeover:** chapter/Board/Notebook/help suppressed server-side, no private stream leakage, proper work shell receives response.
30. **Closure race:** server-accepted response persists; expired/late submission policy explicit; post-closure evaluation never reopens Class.
31. **Unresolved queue at closure:** visible unresolved records and next-Class linkage, no false scheduled appointment or silent cancellation loss.
32. **First class/short history:** no invented previous lessons; present teaching remains usable.
33. **Real historical connection:** source-linked discussed-versus-demonstrated claims; no forced connection.
34. **Older summary conflict:** retrieve exact source where needed; preserve unresolved uncertainty.
35. **Homework:** actual purpose, workload/assistance, checked tasks/private keys; no punitive unsupported inference or model-assigned deadline.
36. **Formal guidance:** taught/exposed/independent distinctions preserved; protected future packages absent from Teacher context.
37. **TPF-20:** notes reflect actual delivered/corrected/unfinished content and bind to closure; held/publication states truthful.
38. **Historical UI:** no JOIN/write/quota/timer; old records retain original provenance.
39. **Migration:** all 22 old capabilities plus retained 05/08/20 modes and non-classroom callers have functioning qualified routes.
40. **Schema/enum drift:** reject invalid mode, unknown action/assistance, missing private separation, incompatible anchors or dropped fields.
41. **Ownership/security:** cross-student IDs, asset references, cursors, receipts and task submissions fail; injected source commands remain data.
42. **Accessibility/mobile:** keyboard/screen reader/reduced motion/zoom/software keyboard/long math, stable scroll/focus and accessible timer readiness.
43. **Deployment:** stream reconnect/poll fallback, auth refresh, worker restart, migration/grant readiness and compatible frontend/backend version.
44. **Rollback:** active response/queue/session survive rollback policy with no unsafe old-client rendering or timer reset.

## 30. Traceability and release checklist

### 30.1 Chat requirement coverage

Full textbook notes → sections 5–6, 11 and 13. Presenter expansion without padding → sections 7–8 and 15. Paragraph-level links with meaningful teaching units → sections 5–8. One Teacher formed by coordinator/presenter → sections 1 and 4. Need Help replaced with persistent interaction → sections 12–13 and 16. Student message timing/never disappearing → sections 16, 20–21. Teacher-initiated timed checks → sections 17–18. Limited messages without blocking participation → section 16. Exact three recent records/older summaries → section 20. 04/06/07 merger → sections 9–10 and 28. TPF-20 retained → sections 1 and 21. Application-owned dependable mechanics → sections 14–24. PPL readiness/reuse → section 11. Closure/carry-forward → sections 19–21. Controlled migration and qualification → sections 27–29.

### 30.2 Prompt semantic coverage

TPF-05's chapter authoring, stable refs, treatment axes, trajectories, time/reserve/break/remediation, substantial/lateness replans, progressive preservation, homework/closure and all ten modes are covered in sections 5–6, 9, 11, 18–21. Its principal statuses and deliverable completeness are preserved.

Coordinator's eight modes, nine-field envelope, basis/evidence, one action, event-driven invocation, guide coverage, message classification/disposition/confirmation, check design/validation, nuanced interpretation, response waiting, least intervention, continuity, formal boundary, private criteria and handoffs are covered in sections 7–10 and 14–23. Specialized migrated responsibilities receive compatible extensions rather than disappearing.

Presenter's twelve modes, typed Directive, all Hard Rules, connected portions, depth/budgets, reading versus teaching pauses, Board dependencies, message handling, WAIT, accepted feedback, strategy preservation, evidence consequences, task demand, correction, history, closing, identity/style, missing-input behavior, output statuses and artifact groups are covered in sections 8–9 and 13–25.

### 30.3 Configuration decisions to complete before release

This blueprint fixes architecture and semantics without inventing numerical product policy. Register the canonical coordinator family/schema versions; set calibrated pace/dwell/buffer bounds; message allowance and exhaustion policy; task-duration/extension/grace rules; pause/closure handling; retry/cost limits; archival/privacy retention; active-client lease/takeover settings; and rollout/rollback cohort gates. Record responsible owner, exact value/version, evidence and affected tests. Missing required configuration blocks that capability's release, not authoring of this plan.

Choose values from actual current policy and calibration. Do not ask the student to resolve internal configuration during a lesson. Model outputs requesting missing policy are routed to the appropriate internal owner with a truthful affected-function hold.

### 30.4 Final release gates

- Complete source/capability/caller ledger and all contract amendments resolved.
- Full chapter, feasible plan, useful guidance and qualified opening available.
- Frontend reads only released public DTOs; every control has an implemented server effect/status.
- D11/D12/D14/domain owners agree on modes, refs, versions, assistance and task/window semantics.
- Queue, quota, delivery, response and closure transactions are atomic and recoverable.
- No unconfirmed promises, inflated evidence, lost questions or private-content leakage.
- Protected work, historical reading and post-closure evaluation have tested explicit paths.
- Provider/asset/stream/database/worker operation observed in the real permitted deployment.
- Mobile, keyboard, screen reader, reduced motion and long-content QA passed.
- All representative/race/failure scenarios passed; non-classroom migrated capabilities preserved.
- Version-coordinated rollout and active-session rollback rehearsed.
- Documentation and release evidence identify actual tested commit/deployment/prompt/schema versions and remaining limitations.

The intended outcome is a coherent classroom whose academic foundation, Teacher judgment, presentation, interface and durable backend agree on what was prepared, what happened, what the student actually demonstrated, and where the lesson should continue.

## Appendix A — Exact enum and semantic compatibility requirements

The supplied prompts permit compatible runtime schemas, but mappings must preserve meaning. Register mappings in code, validate both directions where needed, and version them. Do not normalize unrelated states merely because their labels look similar.

### A.1 TPF-05 statuses

`ok`, `insufficient_context`, `state_conflict`, `workload_validation_required`, `policy_block`, `validation_needed`, `infeasible_within_time`.

Precedence: `policy_block` → `state_conflict` → `insufficient_context` → `infeasible_within_time` → `workload_validation_required` → `validation_needed` → `ok`. Deliverable completion is separately `complete`, `partial`, `blocked`, `not_requested`.

### A.2 Coordinator enums

- Status: `complete`, `partial`, `blocked`.
- Basis: `explicit fact`, `supported inference`, `proposal`, `unresolved`.
- Timing/response timing: `immediately`, `at a suitable teaching pause`, `at the end of class`.
- Classification: `question about the material`, `clarification request`, `expression of confusion`, `response to a teacher question`, `relevant contribution or connection`, `message needing clarification or respectful redirection`.
- Disposition: `answer`, `queue`, `request clarification`, `combine with related questions`, `redirect respectfully`, `preserve for follow-up`.
- Confirmed/requested queue state: `waiting`, `ready`, `needing clarification`, `answered`, `unresolved at closure`.
- Acknowledgement status: `confirmed`, `requested`.
- Reply delivery: `not_delivered`, `delivery_requested`, `delivered_confirmed`, `failed`, `unknown`.
- Difficulty resolution: `unresolved`, `not_established`, `resolved`, `not_applicable`.
- Validation: `validated candidate`, `self-checked`, `requires validation`.
- Error kind: `local execution`, `conceptual`.
- Hypothesis type: `misconception`, `prerequisite`.
- Learning-stage state: `supported`, `not_established`, `indeterminate`.
- Issues: `insufficient context`, `contract conflict`, `stale state`, `source conflict`, `invalid item`, `missing evaluation criteria`, `modality limit`, `validation needed`, `policy restriction`, `action failure`, `missing confirmation`, `replanning needed`.

Current coordinator actions are the union of the supplied decision, adjustment, message and waiting lists: `continue`, `slow down`, `pause`, `clarify`, `change example or representation`, `move to practice`, `defer optional depth`, `request replanning`, `prepare closure`, `focused probe`, `clarification`, `hint`, `missing step`, `new example`, `representation change`, `misconception repair`, `guided practice`, `independent attempt`, `further verification`, `answer message`, `request clarification`, `wait`. Similar-looking labels can share a normalized handler only when targets, purposes and assistance semantics remain explicit. Do not accept a made-up action from model text.

### A.3 Presenter enums

Status: `ok`, `insufficient_context`, `directive_conflict`, `policy_block`, `source_conflict`, `validation_needed`, `correction_required`, `handoff_required`.

Precedence: `policy_block` → `directive_conflict` → `insufficient_context` → `source_conflict` → `correction_required` → `validation_needed` → `handoff_required` → `ok`.

Evidence intent: `instruction_only`, `practice`, `independent_evidence`, `formal_measurement`, `none`. Prepared/released evidence consequences: `unchanged`, `reduced_independence`, `contaminated_for_independent_evidence`, `not_applicable` as the supplied schema permits. Content validation: `checked`, `validation_needed`, `not_applicable`. Correction finding: `not_applicable`, `teacher_correct`, `teacher_error_confirmed`, `unresolved`. Proposed trajectory: `continue`, `wait`, `return to plan`, `carry forward`, `request replan`, `not applicable`.

Approved action vocabulary is `explain`, `probe`, `hint`, `example`, `analogy`, `wait`, `challenge`, `correct teacher`, `clarify source`, `explain with the Board`, `transition`, `answer outside class`, `acknowledge`, plus only explicitly defined governed extensions. Boundary meanings are reading boundary and suitable teaching pause; the runtime supplies canonical serialized values in its compatible schema rather than guessing one from prose.

### A.4 Shared learning and demand vocabulary

Learning stage: `demonstration`, `guided`, `independent_familiar`, `independent_varied`, `method_selection`, `delayed_retrieval`, `integration_transfer`, `unknown`; coordinator/Presenter allow `not_applicable` where specified. TPF-05's planned-next-evidence stage also permits `not_required` for that field. Do not put `not_required` into current learning stage.

Assistance/support: `none`, `attention`, `directional`, `conceptual`, `partial_step`, `strong_scaffold`, `worked_example`, `full_instruction`.

Familiarity: `exact_reuse`, `near_reuse`, `familiar_family`, `fresh_equivalent`, `new_representation`, `new_context_same_construct`, `integrated`, `unknown`.

Method cueing: `explicit`, `partial`, `none`, `not_applicable`.

Representation demand: `same_representation`, `alternate_familiar_representation`, `new_legitimate_representation`, `cross_representation_connection`, `not_applicable`.

Integration demand: `isolated_construct`, `multi_step_same_construct`, `combine_eligible_constructs`, `embedded_in_broader_problem`, `not_applicable`.

Retention timing: `immediate`, `same_session_later`, `spaced`, `delayed`, `not_applicable`.

TPF-05 reuse intent: `deliberate_repetition`, `fluency`, `familiar_independent_check`, `fresh_equivalent`, `variation`, `method_selection`, `integration`, `retention`, `not_applicable`.

### A.5 Validation levels must remain separate

Coordinator `self-checked` and Presenter `checked` describe completed internal checking. They are not automatically an externally `validated candidate`, a domain-accepted interpretation, an approved chapter, a qualified model route, or published content. Record checker identity, method, scope and limitations. An adapted artifact must retain its original validation provenance even when its field names change.

## Appendix B — End-to-end reference scenario

This example describes one individual chemistry Class without inventing a duration, quota or deadline. Runtime policy supplies actual values.

1. The approved scope includes reaction rates and catalysis. TPF-05 authors a complete chapter with definitions, conditions, a worked example and diagram interpretation. Units and figure anchors map to Course objectives. It separately selects the achievable Class route and evidence opportunities.
2. Coordinator `prepare_guidance` identifies that “not consumed overall” requires a distinction between participation in intermediate steps and net consumption. It supplies essential reasoning, a useful representation, a suitable pause and a stop condition; it does not add an unauthorized mechanism to the curriculum.
3. PPL validates the chapter, feasible plan, guide and opening sequence against current scope/time. The engine binds versioned schemas and qualified routes. A cached image is optional; the essential explanation has a validated structured/text alternative.
4. The student opens Classroom. The chapter pane shows the complete reference. The conversation shows only released material. Start/join is committed through D11/D14, with D15 observing JOIN independently of teaching progress.
5. TPF-08 produces several connected portions explaining rate, then catalysis, with source/Board dependencies and a reasoning boundary. The engine validates, prepares, releases and receives limited render confirmation at the configured pace. The chapter highlights the referenced span without forcing navigation.
6. The student asks, “If it participates in a reaction step, why is it not consumed?” Admission records the message, contextual anchor, one quota charge and its queue item atomically. The Teacher can acknowledge receipt immediately, but the answer timing promise waits for a committed boundary obligation.
7. `handle_message` classifies this as a material question, proposes an answer at the suitable pause, and preserves the unfinished explanation anchor. The engine accepts the scheduling commitment. TPF-08 answers within approved source scope and then reconnects to the main thread. The queue becomes answered only after confirmed reply delivery; conceptual resolution is still not established by mere agreement.
8. Coordinator `design_check` selects a useful explanation question with private criteria. A Teacher task does not consume the conversational allowance. Required content renders; the engine opens the task-specific window with authoritative timestamps.
9. The student's answer is accepted against the exact task/window. `interpret_response` recognizes the valid distinction but identifies an unsupported claim about changing equilibrium if that issue lies within the supplied criteria/scope. If the task/source cannot support that judgment, it withholds the affected verdict instead of adding curriculum.
10. D12/engine accepts valid findings and exposure limits. The next action selects a targeted clarification or another permitted representation. TPF-08 delivers selected feedback in the same voice. It does not claim mastery or solve a later protected task.
11. The student reloads. Session, conversation, receipt position, chapter version, remaining quota and active task/deadline restore. Unreleased candidates stay private; no new countdown or duplicate charge appears.
12. Near closure, remaining optional depth is deferred rather than rushed. An unresolved later question is recorded at closure. The closing states what was actually explained and what remains, without promising an unapproved next-class appointment.
13. D11 commits closure. Any response accepted before closure is evaluated through the immutable-context reconciliation path if its evaluation is still pending. No new live teaching is released after completion.
14. TPF-05 uses closure evidence to propose homework or no homework. TPF-20 reconciles actual delivered clarification and unfinished material against chapter/source/closure references. D27 governs note publication. Continuity supplies a truthful resumption anchor and unresolved question to the next authorized class.

The same record links frontend entries, source anchors, backend events, response criteria, exposure, closure and notes. Each stage has an explicit owner and confirmed outcome; no prompt is expected to pretend that its proposal executed itself.

## Appendix C — Implementation deliverables and review evidence

The eventual implementation should produce the following concrete reviewable outputs, alongside code:

- Generated baseline/migration inventory: canonical IDs, callers, modes, authority, schemas, validators and destinations.
- Governed prompt amendment set and final effective body/version hashes for 05, coordinator, 08 and retained 20.
- Mode-specific schemas, closed enum maps, private/public projection definitions and semantic adapter fixtures.
- Versioned runtime policy with actual adopted values and calibration rationale.
- Reference/anchor resolver and chapter continuation/remap fixtures.
- Preparation dependency/readiness contract and invalidation/reuse evidence.
- Durable delivery/queue/window/task transition specifications and transaction/uniqueness constraints.
- Additive migration files and real-database integration results, including ownership/grant/RLS review.
- Connected frontend screenshots/interaction recordings at representative desktop/mobile/zoom states, with accessibility findings resolved.
- End-to-end live-provider evidence for at least the adopted Teacher generation and applicable visual/fallback routes; fixture/provider readiness claims kept separate.
- Fault/race tests covering admission, publication, receipts, closure, retries and two-client control.
- Non-classroom migration qualification for diagnostics, profiles, scaffolding, fresh verification and review-strategy uses.
- Rollout/rollback runbook and a rehearsal involving an open response and unresolved question.
- Final deployment/commit/schema/prompt manifest cross-check proving the frontend and backend use the same contract versions.

## Source references

Supplied local originals, preserved unchanged:

- `CAHTS.txt`: conceptual proposal, alternative refinements, final consolidated 23-part implementation plan, and later prompt consistency review.
- `TPF_05_v2-1.md`: author/planner contract, ten task modes, chapter/plan/output rules.
- `TPF_5_8_v2-1.md`: coordinator contract, eight task modes, nine-field default JSON and artifact schemas.
- `TPF-08-1.md`: Presenter contract, twelve task modes, Hard Rules, typed Directive and output requirements.

Repository source links pinned to the inspected commit:

- [Classroom client](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/public/teaching-classroom.js)
- [Teaching router](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/teaching-backend.js)
- [D14 Classroom service](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/teaching/d14/service.js)
- [D14 persistence](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/teaching/repositories/d14-classroom.js)
- [D14 runtime](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/teaching/d14/runtime.js)
- [D11 contracts](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/teaching/d11/contracts.js)
- [D12 service](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/teaching/d12/service.js)
- [D12 intelligence adapters](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/teaching/d12/intelligence.js)
- [Capability registry](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/teaching/capability-registry/index.js)
- [Prompt runtime contracts](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/teaching/prompt-runtime/contracts.js)
- [Preparation workflow](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/teaching/preparation/workflow.js)
- [Visual service](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/teaching/d14/visual-service.js)
- [Visual implementation audit and limitations](https://github.com/happysolomon43-boop/KIWI/blob/a77aec6fbd49b89a4538610e434151e2f5fb8cde/docs/classroom-visual-audit-2026-10-08.md)


