# KIWI Teaching — Classroom Implementation Plan

**Eight deliveries, aligned with the Classroom Remodeling Blueprint**  
**Plan version:** 1.0, 9 October 2026  
**Verified repository baseline:** `happysolomon43-boop/KIWI`, `main`, `a77aec6fbd49b89a4538610e434151e2f5fb8cde`. The baseline was rechecked while preparing this plan and had not changed.  
**Design inputs:** `KIWI_Classroom_Remodeling_Blueprint.md`, `CAHTS.txt`, `TPF_05_v2-1.md`, `TPF_5_8_v2-1.md`, and `TPF-08-1.md`.

This is a delivery specification. Creating it does not implement, deploy, activate, or retire any capability. Existing filenames are integration points; proposed module/table/event names are design targets until adopted through the repository's actual conventions. Each delivery must leave the repository reviewable and compatible, with concrete evidence of its acceptance gates.

## The eight deliveries

1. **Contracts, prompt reconciliation, migration inventory and policy foundation.** Establish one executable language for the whole system.
2. **Complete chapters, teaching plans, explanation guides and preparation readiness.** Build the academic foundation that the Teacher will teach.
3. **Durable presentation engine, delivery receipts and authenticated session APIs.** Build dependable pacing and recovery before relying on the browser.
4. **Conversation classroom UI, connected chapter, Board and Notebook.** Deliver the new student interface using real server contracts.
5. **Persistent student messages, question queue, allowances and interruption handling.** Replace Need Help with coordinated conversation.
6. **Teacher questions, response windows, interpretation, assistance, correction and replanning.** Complete the adaptive learning loop.
7. **Closure, continuity, homework, assessments and TPF-20 reconciliation.** Connect each Class to the student's continuing learning record.
8. **Full qualification, coordinated migration, production rollout and retirement.** Prove the complete flow before removing old active bindings.

Deliveries are sequential milestones, not calendar promises. Work that is independent may be prepared ahead, but integration and release cannot skip a dependency gate. A delivery may contain several focused commits/PRs; it is complete only when its full behavior and evidence are reviewable.

## 1. Rules that apply to every delivery

### 1.1 Preserve the architecture

TPF-05 authors the chapter and plans/replans substantial work. The coordinator, provisionally called TPF-5/8, guides explanation, handles messages, designs/interprets ordinary checks and selects immediate adjustments. TPF-08 presents authorized teaching. TPF-20 remains the class-grounded note capability.

D11 remains the academic Controller. D12 remains the response/interpretation acceptance boundary. D14 manages Classroom artifacts and projection. D15 owns attendance. Classwork, assessments, grades, SKM, progression, scheduling, identity and study publication retain their authorized owners. A prompt-family merger is not a service deletion or authority expansion.

### 1.2 Preserve separate facts

Never collapse chapter availability, preparation completeness, validation, generated content, public publication, client-confirmed rendering, actual student response, interpreted evidence, and official learning outcomes into one completion field.

Carry-forward remains a disposition, not a learning status. An answered message does not establish that a misconception is resolved. A render receipt does not prove reading, understanding or attendance. A full chapter does not mean the full chapter was taught.

### 1.3 Every delivery has the same completion record

Its handoff must identify exact branch/commit, changed contracts and migrations, effective prompt/schema versions, implemented public behavior, tests/checks and their results, actual model/provider evidence where applicable, deferred limitations, feature/session gating, and the next dependency. Do not mark a delivery complete because code compiles or a screenshot looks correct.

Update the implementation traceability ledger at each milestone. Link each change to blueprint sections and qualification scenarios. Reuse existing CI where appropriate, adding meaningful domain/integration tests rather than tests that only repeat the implementation.

### 1.4 Resume from evidence

After interruption, inspect the active branch, commits, worktree, PR/CI state, migrations and infrastructure before continuing. Retain a delivery checkpoint with completed acceptance gates and unfinished work. Never restart a completed delivery without evidence that it is wrong or incompatible.

### 1.5 Version and release behavior

Keep new functionality behind server-owned session/version capability selection. An existing session retains its compatible engine/prompt/schema version. Public controls appear only when the backend advertises a functioning permitted action. No UI-only feature flag may grant authority.

New routes and DTOs must not silently change the semantics of old sessions. Migrations are additive first. Historic records keep original provenance; old family bodies remain resolvable for historical interpretation even after active routing changes.

## 2. Corrections and refinements applied to the blueprint

These refinements make the blueprint executable without changing its intended classroom experience.

### 2.1 Define contracts before UI or prompt activation

Do not install the new prompt bodies into the old one-message runtime and hope compatible output emerges. Delivery 1 establishes schemas, mappings, permissions and provenance. Later deliveries activate only the modes whose actual inputs, validation and downstream effects exist.

### 2.2 Pin family contracts without granting blanket authority

The registry currently requires `TPF-` followed by two digits and a fixed family count. Delivery 1 must register an approved canonical coordinator identifier and design alias, regenerate manifests/hashes/count assertions, and preserve historic resolution. It must not guess an official identifier or hard-code a new count based on arithmetic alone.

The 22 existing 04/06/07 capabilities preserve individual ceilings and owner boundaries. Specialized profile/scaffolding outputs get compatible mode-specific extensions; they are not silently discarded to fit the coordinator default envelope.

### 2.3 Fix receipt/delivery ambiguity conservatively

Server publication means content was released for authorized access. Active-client render confirmation is a distinct limited observation. Missing confirmation is not proof that the student never saw the content. Independent-evidence decisions must preserve accessibility/exposure uncertainty. A lost acknowledgement is reconciled idempotently; the backend cannot grant a fresh timer merely because the browser reloaded.

### 2.4 Establish minimum closure safety before adaptive features

Delivery 3 implements hard-end release cancellation and durable final-position capture. Delivery 6 implements active-task deadline/closure disposition. Delivery 7 adds full academic closure and continuity. This prevents an intermediate test session from continuing past its authoritative end while waiting for the later closure delivery.

### 2.5 Remove two possible decision owners

Coordinator interpretation may return one selected next action. D12/engine accepts, constrains or rejects it. It does not independently run an incompatible second strategy selector and publish both. If a capability explicitly needs a separate coordination call, the prior result remains findings only until that call chooses the action.

### 2.6 Treat controls and messages differently

Pause/pace, technical reports, response submission and more-time requests have deterministic typed routes. They must not depend on a quota-charged conversational message or a model recognizing a phrase. The visible composer can still present natural interactions, but transport and authorization distinguish them.

### 2.7 Make timeout and closure races deterministic

Task admission uses authoritative server/database time, not browser timestamps. The first committed valid transition decides acceptance versus expiry/closure. Accepted pre-closure responses remain evaluable from immutable context. Late work is explicit and never backdated. Any grace is versioned policy, not Teacher invention.

### 2.8 Keep delivery failures distinct from failed teaching

Content not delivered can be replayed or bridged after recovery. A delivered explanation that was ineffective requires addressing the diagnosed cause. Requested recap or targeted wording clarification is allowed. “Never repeat any failed approach” becomes a cause-aware rule rather than an absolute ban on sensible repetition.

### 2.9 Define configuration ownership and readiness

Do not invent message counts, universal words-per-minute, question durations, extension ceilings, overtime or provider budgets in prompts. Delivery 1 identifies existing policy and supplies a versioned configuration contract. Delivery 8 requires actual adopted/calibrated values before public release. Missing essential policy disables the affected action, not unrelated teaching.

### 2.10 Make rollout more than a feature switch

Coordinate engine, routes, database, registry, prompt bodies, schemas and frontend assets. Session version selection, worker compatibility and rollback handling are part of rollout. Turning off the new UI must not erase active tasks or send new-format sessions through old readers.

## Delivery 1 — Contracts, prompts, inventory and policy foundation

### Outcome

A validated, versioned contract package connects author, coordinator, Presenter, Controller, public API and persistence. Every old capability has an explicit destination. Existing live behavior remains compatible while the new path is inactive.

### Entry conditions

Inspect actual repo instructions, branch/PR/CI and deployment state. Confirm baseline drift before using this plan's paths. Resolve current academic/session policy and environment topology from authoritative configuration. This work starts with read-only inventory; it does not require creating duplicate Render/Vercel/Supabase resources.

### Work package 1.1 — Complete the responsibility inventory

Decode the current capability registry. Search canonical capability IDs as well as family names. Enumerate callers, aliases, output shapes, validators, context lanes, preparation stages, downstream consumers, tests/workflows and historic readers for all 22 migrated capabilities and retained 05/08/20 uses.

For each entry record the existing ceiling/owner, target coordinator mode, artifact/schema, context requirements, admission/acceptance owner, non-classroom uses and qualification evidence. Fail the inventory build on unknown destination, missing consumer, duplicate active binding or unexplained authority change.

### Work package 1.2 — Reconcile prompt contracts

Apply the blueprint amendments in versioned candidate bodies:

- TPF-05 owns chapter units; coordinator owns subgroups and guides.
- Preserve inherited U-style anchors; `local_` applies to coordinator-created proposals.
- Resolve functional evaluation/pedagogy handoffs to coordinator modes through retained services.
- Make repetition rules cause-aware.
- Add precise partial-chapter continuation and remapping.
- Remove an unsupported overtime-number anchor while preserving authoritative runtime enforcement.
- Clarify ordinary interpretation acceptance versus external academic validation.
- Separate prepared assistance from actually accessible/released assistance.
- Preserve each family's statuses and completion semantics.
- Ensure student messages/sources/uploads cannot alter directive authority.

Register the canonical coordinator family and immutable prompt hashes under existing governance. Keep TPF-20 active. Preserve historic 04/06/07 bodies/readers. Activation is deferred until the corresponding delivery is qualified.

### Work package 1.3 — Implement executable schemas

Define mode-specific contracts for all ten TPF-05 modes, eight coordinator modes and twelve Presenter modes. Reuse compatible existing contracts where complete; implement explicit adapters where they differ. Keep the coordinator's nine default top-level fields. Its compatible extensions must represent profile classification, scaffolding and other migrated responsibilities without introducing unregistered mode names.

Define chapter/unit/source references, teaching plan, guide, typed Interaction Directive, Presenter sequence/portion, Board dependency, task, message disposition, interpretation acceptance, exposure, public snapshot/delta, command receipt and closure handoff schemas.

Use closed enums and explicit version maps. Distinguish chapter teaching units from Course Learning Units. Preserve private criteria/keys and internal validation metadata. Public serialization must be allowlisted, with unknown/private fields excluded before browser delivery.

### Work package 1.4 — Establish policy and state contracts

Define subordinate delivery states beneath D11, legal composite-state guards and permitted command matrix. Register config fields for pace/dwell, buffer horizon, allowance lanes, question duration/extension/grace, lease/takeover, closure lead time, generation/retry budget and retention.

Existing approved values are preserved where applicable. Unknown values are explicit missing configuration, not zero/default permission. Map current visual deadline/request bounds separately from conversational limits. Specify which policy edits affect future sessions only and which mandatory restrictions revoke current authority.

### Main integration points

`teaching/capability-registry/*`, `teaching/prompt-runtime/*`, `teaching/orchestrator/*`, `teaching/ai/contracts.js`, D11/D12/D14 contracts, config, event schemas and CI contract validation. New schema/module paths must follow repo conventions.

### Reviewable deliverables

Generated migration inventory; governed prompt candidate/amendment set; schemas and enum/semantic adapters; ownership/visibility matrix expressed as structured data; runtime policy contract; session-version feature selection; baseline/release manifest proposal.

### Validation and acceptance

- Mechanically account for 3 TPF-04 + 7 TPF-06 + 12 TPF-07 capabilities.
- Validate complete and missing/partial/blocked fixtures for each mode.
- Reject inflated authority, invalid enum, wrong-version anchor, incomplete Directive and leaked private field.
- Prove registry/body/catalog hash integrity and historical loading.
- Test coordinator action → engine Directive → Presenter schema mapping, including WAIT and accepted feedback.
- Confirm old sessions still run existing contracts and no new public capability is falsely advertised.

**Gate:** no unmapped capability, ambiguous owner, unresolved required schema or silently dropped semantic distinction. Missing numerical production configuration is tracked with an owner and blocks only activation of its dependent action.

**Handoff to Delivery 2:** pinned contracts, prompt candidates, reference format and preparation-stage requirements.

## Delivery 2 — Chapters, plans, guides and preparation readiness

### Outcome

KIWI can prepare a complete independent-study chapter, a feasible teaching route, useful explanation guides and a validated opening sequence, all bound to the same approved scope and versions.

### Entry conditions

Delivery 1 contract gate passed. The new preparation path is inactive for general production users. Existing PPL stage/review requirements are known and preserved.

### Work package 2.1 — Add versioned academic artifact persistence

Create additive migrations for chapter candidates/versions, units/source elements, anchor maps, plan bindings, guide candidates/versions and dependency metadata. Preserve private review/internal fields separately from validated public chapter content. Define ownership, foreign keys, uniqueness and current-version selection.

Reuse D11 Blueprint identity and plan authority. A chapter unit ID must never replace a curriculum Learning Unit ID. Each artifact records prompt/capability/mode/schema, source/scope/plan dependencies, completeness, validation and accepted version.

### Work package 2.2 — Implement TPF-05 authoring and continuation

Generate connected prose, definitions, explanations, equations with symbols/conditions, subject-appropriate worked examples and useful visuals. Preserve original explanations versus quoted source attribution. Implement independent-study completeness checks appropriate to the subject rather than a mandatory paragraph count.

When generation is partial, save completed units intact. Continue from exact version/hash/anchor boundaries; preserve unchanged content, reject duplicates, and record replacements/splits/merges. Do not regenerate the beginning or summarize unfinished units to fit a token limit.

Separate objective priority, material designation and unit treatment. Validate phase/time ledger, adaptive reserve, break/assessment accounting, evidence goals, remediation branch fields and carry-forward. Infeasible work returns a reduced proposed alternative, never false success.

### Work package 2.3 — Implement coordinator preparation

`prepare_guidance` receives the complete bound chapter and relevant plan/evidence. It preserves author structure, records source coverage and creates coherent subgroups. Each guide has intended understanding, terms/reasoning, examples/representations, essential/optional explanation, expand/stop conditions, boundaries and useful check candidates.

Prepare applicable profile/scaffolding extensions, verified continuity links and check specifications through their registered modes. Only relevant history enters each call. Useful initial checks can be ready without forcing a quiz at every unit.

### Work package 2.4 — Prepare opening Presenter content

Build a complete typed Directive and invoke TPF-08 for a bounded coherent opening. Validate academic/source links, reasoning boundaries, assistance, private metadata and Board dependencies. Store it as prepared, not published or taught. Do not pre-generate an unlimited lecture or feedback to unanswered tasks.

### Work package 2.5 — Extend PPL and readiness

Use the existing preparation workflow to order scope/source → chapter → plan/Blueprint → guides → relevant checks/continuity → opening → readiness. Preserve required independent review and qualified-route gates.

Readiness checks current Course/timetable/time, complete chapter for approved starting scope, valid Blueprint/plan, essential guidance, current schemas/routes, coherent opening and required representations/fallbacks. A wider pending optional expansion must be a separate explicit artifact, never a partial chapter mislabeled complete.

Dependency invalidation preserves compatible prose on schedule-only change while recomputing time-bearing plans and bindings. Source/objective correction invalidates affected descendants. Student evidence changes relevant teaching assumptions without deleting unrelated sound material.

### Main integration points

D11 contracts/service/preparation, PPL workflow/subscribers, orchestrator context/output adapters, D14 Board/visual validation and artifact repositories. Add a student chapter projection route behind the new session contract; private guide/plan keys never use that route.

### Reviewable deliverables

Additive artifact migrations; chapter/plan/guide schemas wired to real calls; continuation service; dependency graph/invalidation; opening candidate generation; readiness attestation; sample student chapters with linked internal artifacts.

### Validation and acceptance

- Simple concept, dense equation, interpretive passage and code/procedural lessons produce appropriate depth.
- Partial output continues without duplicate anchors or summary compression.
- Plan counts all time once, preserves required standards and reports infeasibility honestly.
- Missing history, source conflict, essential asset failure and unqualified route receive correct scoped holds.
- Rescheduling reuses compatible academic content; changed sources invalidate dependent material.
- Public chapter excludes task keys, internal plans, raw diagnostics and future assessment content.

**Gate:** a complete validated chapter, feasible current plan, essential guides and opening can be prepared and retrieved through real persistent contracts. No Class is claimed to have been taught during preparation.

**Handoff to Delivery 3:** accepted artifact bindings and opening sequence ready for durable release.

## Delivery 3 — Durable presentation and authenticated session APIs

### Outcome

The backend can release validated teaching at a controlled pace, preserve confirmed position, enforce authoritative time and recover after retries, disconnects and worker restarts.

### Entry conditions

Delivery 2 readiness path passed. Versioned presentation policy is available in the development/test environment. Unsupported conversational/check capabilities remain disabled.

### Work package 3.1 — Persist delivery state and immutable portions

Add migrations/repositories for sequence/portion lifecycle, public conversation ordering, delivery state/epoch, receipts, active-client lease, jobs/claims and applicable events. Store generated private content separately from released public events.

Record session/chapter/guide/Blueprint/plan versions, authoritative source span, policy, resumption anchor, last published/confirmed sequence and next eligible release. Add unique constraints for release, receipt and command effects; index session/cursor and due/lease access.

### Work package 3.2 — Build server-owned release scheduling

Generate outside transactions, validate, re-read authority, then atomically accept/publish and write outbox events. Use durable due events, leases and reconciliation for pace; browser timers only display clocks/animation.

Keep bounded prefetch. Stop at the next response-dependent decision. Enforce semantic compatibility before reusing candidates after a change; do not merely replace version numbers. Supersede affected candidates on replan, correction, protected takeover or closure.

Use configured dwell/type handling and supported pause boundaries. User Pause stops release, not Class time. Resume releases the remaining authorized span. Faster cannot skip reasoning; Slower may trigger future route feasibility review. No per-sentence coordinator calls.

### Work package 3.3 — Implement receipts and client control

Accept idempotent render-readiness/confirmation for eligible released content from the active authorized client. Store limited semantics; do not update mastery or formal attendance. Required asset/fallback readiness is included. Accessible render readiness does not depend solely on visual viewport intersection.

One client holds the control lease. Other clients can read; takeover increments control epoch and rejects stale commands/receipts. Lease expiry holds affected delivery progression without closing the Class. Resume from saved position; no timer reset on another device.

Lost acknowledgements resend the same receipt. Preserve uncertainty where publication occurred but confirmation did not. Hidden/background/offline clients cannot silently advance teaching by receiving queued data alone.

### Work package 3.4 — Add public session/delta transport

Implement authenticated session snapshot, paginated conversation delta, stream, delivery receipt, presentation control and client-lease routes. Use shared auth/session handling. Public DTO includes versions, cursor, clocks, permitted actions and released content only.

Use fetch-based resumable SSE as the preferred server→client channel, subject to actual host/proxy tests. HTTP commands remain ordinary authenticated requests. Provide cursor polling fallback with identical ordering/visibility semantics. No tokens in URLs and no generic WebSocket assumption.

Handle cursor reset, auth refresh, cancellation, duplicate events and state conflict explicitly. Snapshot/delta contracts do not preload unpublished buffers.

### Work package 3.5 — Implement minimum end/protection safety

At authoritative Class end or protected-mode transition, stop incompatible releases, invalidate jobs and persist final position. Do not depend on the future UI closing a sheet. Existing D11 authority decides lifecycle/time. Later deliveries add richer queue/task closure, not permission for this engine to ignore the end boundary.

### Main integration points

`teaching/d14/service.js`, D14 repository/runtime, `teaching/runtime/*`, D11 transition/closure integration, `teaching-backend.js`, Teaching composition and `public/kiwi-api-client.js` transport support.

### Reviewable deliverables

Engine/repositories/migrations; release/receipt/control APIs; durable event handlers; SSE/poll fallback; active-client policy; deterministic fault/replay harness; technical demo using prepared real-format artifacts.

### Validation and acceptance

Test crashes before/after commit, duplicate due events, lost receipt acknowledgement, reload, two clients/takeover, stale authority, optional/essential assets, slow generation, paused time expiry and protected transition. Assert one accepted business effect using at-least-once transport, not a claim of distributed exactly-once execution.

**Gate:** coherent teaching releases automatically, resumes exactly, stops safely and remains private until authorized. No browser-only mechanism owns academic progression.

**Handoff to Delivery 4:** functioning public contract and permitted control capabilities.

## Delivery 4 — Conversation classroom UI and connected reading

### Outcome

Students have the new real-backend conversation/lecture surface, chapter reading pane, Board representations and Notebook, with stable navigation and accessible controls.

### Entry conditions

Delivery 3 session, release, receipt and control routes passed. The server advertises only implemented features. Test sessions are explicitly gated; general production cutover remains Delivery 8.

### Work package 4.1 — Refactor by responsibility

Keep course-shell registration, Class list/history and entry behavior. Split the large Classroom script into coherent session client, conversation renderer, chapter renderer, response/composer shell, reading/Notebook and recovery/navigation modules following repository conventions. Avoid unrelated framework migration or a second global state system.

Use one authoritative frontend session store fed by versioned snapshots/deltas. Local drafts/navigation preferences are separate from academic state. Define a single cleanup path for close, asset URLs, requests/streams, listeners, focus and active lease.

### Work package 4.2 — Build desktop and mobile composition

Desktop: dominant scrolling conversation with persistent composer area and connected resizable chapter pane. Header shows identity, activity, Class timing, presentation and connection state. Board content appears in relevant context and can expand. Notebook is secondary, not a competing main teaching feed.

Mobile: Conversation/Chapter views, accessible Notebook/visual sheets, usable keyboard/composer placement and separate saved scroll positions. Preserve text size, focused draft and current anchor through ordinary refresh/view switches. Readable equations/code/figures must not require two narrow columns.

### Work package 4.3 — Render released conversation and chapter

Append/deduplicate by server sequence. Render Teacher explanation as developed connected text; distinguish student contributions, task/feedback and operational notices without excessive card nesting. No raw model artifacts or internal identities appear.

Chapter current-span highlight follows source anchors without forcing the student's navigation. Distinguish available, presented, deferred and optional material without inferred mastery. Render corrections and version links. Historic review is read-only and does not JOIN, charge quota or open timers.

### Work package 4.4 — Integrate controls, Board and Notebook

Pause/Resume, pace, text size and Return to current use permitted controls. When reading history, new events preserve position and show a new-content indicator. Focus is never stolen by clock/stream updates.

Reuse allowlisted Board renderers, authenticated blob assets, sanitized math/Markdown/SVG and inert code. Save Notebook entries/references idempotently, including chapter/portion anchors. Provide a non-selection alternative for note capture. Keep private task/assessment data out of DOM and caches.

### Work package 4.5 — Handle unavailable future features honestly

The persistent composer is built here, but student-message admission is activated in Delivery 5 and Teacher task participation in Delivery 6. Before those gates, capability selection disables/hides unsupported actions with truthful test-surface state; it never simulates acceptance or falls back silently to an uncoordinated chatbot.

Existing legacy sessions continue through their compatible UI/path. New protected-mode UI invokes the actual authorized Classwork/Assessment shell and removes restricted reading/help surfaces. Shared technical/leave actions remain permitted.

### Main integration points

`public/teaching-classroom.js`, `public/teaching-classroom.css`, shared API/typography/accessibility/reliability modules, course shell, `public/teaching-d16.js`, `public/teaching-assessments.js` and the actual assessment-shell integration.

### Reviewable deliverables

Connected UI; public DTO renderers; chapter/Board/Notebook source links; stream/reconnect integration; responsive screenshots/interaction recordings; keyboard/screen-reader/zoom/reduced-motion review; legacy/historical compatibility demonstration.

### Validation and acceptance

Test long content, mobile keyboard, math/code overflow, graph alternatives, asset load cancellation, zoom/reflow, sheet focus restoration, text size, old/new sessions, history review, scroll preservation and expiry/protected transitions. Confirm rendered receipts reflect supported active-client readiness and do not claim understanding.

**Gate:** the new UI works with real authoritative data and controls, has no misleading unsupported interaction, and preserves accessibility/navigation under live updates.

**Handoff to Delivery 5:** persistent composer and queue-status components ready for admission/routing integration.

## Delivery 5 — Messages, persistent queue, quota and interruption

### Outcome

Students can send contextual messages through the persistent composer. Every accepted message is saved, counted correctly, acknowledged and handled through one coordinated teacher thread. The old Need Help entry mechanism is unnecessary for new instructional sessions.

### Entry conditions

Delivery 4 UI and Delivery 3 release/control engine passed. Message policy and coordinator `handle_message` schema/route are configured and qualified for the test environment.

### Work package 5.1 — Implement atomic message admission

Add/extend message, queue/group, commitment and allowance-ledger persistence. Authenticate student/Class/session, validate active mode, content size/modality, allowed lane, task linkage and idempotency key.

In one transaction: save message/context anchor, consume any applicable allowance, create its queue record and write acceptance/outbox event. Return saved message ID, acceptance receipt, authoritative balance and state. Never return Accepted before commit. An unknown network outcome retries the same operation key; changed content under that key conflicts.

Store client intent separately from server-admitted lane. A client cannot avoid quota by claiming that an unrelated message is a Teacher response. Technical/correction controls remain bounded by size/rate rules and cannot become free tutoring routes.

### Work package 5.2 — Route through coordinator mode

Invoke `handle_message` on meaningful accepted messages with current teaching anchor, relevant source/portion, queue, receipt/answer status, active task constraints and allowance policy. Validate one disposition per message and at most one selected action.

If a message contains substantive work, route it to the appropriate registered interpretation workflow; ordinary clarification is not automatically correctness evaluation. Until Delivery 6's new-task path is enabled, do not invent a task or issue an unsupported verdict; preserve the message and route only through a functioning compatible evaluation path.

Store coordinator proposal and engine acceptance separately. Unknown effects request confirmation. Failed routing preserves the accepted message and visible pending state; no second quota charge occurs.

### Work package 5.3 — Persist queue states and commitments

Use instructional queue states waiting, ready, needing clarification, answered, unresolved at closure. Keep worker processing/lease/retry fields separate. Dispositions include answer, queue, clarification, grouping, respectful redirection and follow-up preservation.

Save an actual boundary/unit/closure obligation before a Teacher promises a timing. The closed default timing enum remains intact; a compatible scheduling artifact carries later-unit anchors. Track deterministic priority, waiting age and committed obligations to avoid starvation.

Merged questions retain every original ID/concern and reply relationship. A delivered answer marks the relevant communication outcome; difficulty resolution still needs evidence. Unavailable automatic answers retain a truthful unresolved outcome rather than disappearing after a bounded retry count.

### Work package 5.4 — Integrate interruption and resumption

For ordinary relevant questions, finish the authorized reasoning boundary before switching. For a material suspected error/blocker, hold affected upcoming release and obtain the required decision. Do not throw away all prepared content indiscriminately; invalidate only incompatible successors.

TPF-08 receives a complete Directive for receipt, permitted queue acknowledgement, answer or redirection. Preserve the unfinished source/reasoning anchor. After handling, resume with a brief coherent bridge, not a greeting or lesson restart.

An accepted question may remain unanswered at the hard end. Commit unresolved-at-closure status now; Delivery 7 later links it into academic continuity. Do not retain the old help-retirement behavior as a mechanism for silently losing the question.

### Work package 5.5 — Activate composer and allowance UI

Connect Sending, Accepted, pending disposition, clarification, answered/redirection and unresolved status. Preserve unsent/uncertain draft and original idempotency key. Show server balance before exhaustion and explain failed admission without pretending the message entered the queue.

Do not charge Teacher replies, Teacher-requested clarification, extension and technical controls or retries. An exhausted student can still answer Teacher tasks once Delivery 6 enables them. At exhaustion, follow-up recording is offered only if an actual configured route exists; it promises no automatic live answer.

### Main integration points

D14 service/repository/runtime, legacy help adapters, delivery boundary scheduling, `teaching-backend.js`, coordinator intelligence adapter, public composer/queue/balance renderers and event projections.

### Reviewable deliverables

Admission API; quota ledger and constraints; coordinator routing acceptance; persistent commitments/groups; boundary interruption/resumption; composer integration; public status projection; legacy-help-to-new-queue compatibility rules.

### Validation and acceptance

Test immediate question, deferred boundary, later-unit anchor, grouped concerns, unclear/unrelated/protected request, allowance exhaustion, free permitted lanes, failed routing, duplicate retry, two-client sends, acknowledgement failure and closure with pending work. Verify one charge/queue effect per accepted message and no unsupported time promises.

**Gate:** accepted messages never disappear, statuses reflect saved reality, and conversation interruptions preserve the teaching thread. No independent assistant persona or uncontrolled direct chatbot branch exists.

**Handoff to Delivery 6:** dependable message/task clarification lanes, queue/current teaching state and exposure-aware interaction hooks.

## Delivery 6 — Questions, interpretation, adaptation, correction and replan

### Outcome

The Teacher can ask useful questions, wait fairly, interpret responses and adapt teaching. Assistance, exposure, evidence limits, corrections and substantial replans are handled consistently across UI, prompts and backend.

### Entry conditions

Deliveries 1–5 passed. Task duration/extension/grace policy, accommodations, authoritative assistance rules and D12 acceptance contracts are available. Formal assessment content remains excluded from ordinary Teacher context.

### Work package 6.1 — Build task/check contracts and validation

Implement coordinator `design_check` with public task text separated from private criteria/acceptable alternatives. Bind target Course Learning Unit/objective, chapter anchors, task instance/version, intended claim, inference ceiling, modality, assistance, source validation, prior exposure and demand vector.

Select a validated candidate where suitable. Newly generated checkable content requires sufficient self-check/content validation before release. External validation remains mandatory where applicable. A casual invitation to clarify is not automatically a scored task. Unsupported modality cannot establish competence it does not observe.

### Work package 6.2 — Implement response-window lifecycle

Persist pending delivery, open window, response accepted, expired-no-response, closed-by-Class and cancelled-system outcomes. One blocking task per individual session unless an explicit activity contract permits otherwise.

Publish the complete task/dependencies, obtain active accessible render readiness, then open the server-timed window. Cap it by authoritative Class constraints. Pending tasks that cannot fairly open before closure are held/cancelled with a system reason, not counted wrong.

Extensions update the same window/version once, using adopted policy and remaining time. Pause/pace controls do not modify deadlines. Reload and device takeover retain original opened/deadline state. Typing may inform an allowed bounded request but does not automatically grant time or imply emotion/effort.

### Work package 6.3 — Accept responses and reconcile races

Validate exact task/window/session context, permitted form and server receipt time. Save answer/assistance/exposure snapshot, transition the window and enqueue evaluation atomically. Use stable response idempotency; do not infer the target from the first planned curriculum unit.

Expiry/closure and submission race through authoritative transactional guards. Accepted pre-deadline work survives acknowledgement delay. Rejected late work is explicit; any grace is configured. Preserve partial received evidence and drafts without confusing private drafts with submissions.

Open response state prevents unrelated instruction. Task-related clarification or permitted help preserves the window and records assistance. No response means no response, not proven misunderstanding or refusal.

### Work package 6.4 — Migrate ordinary response judgment

Adapt D12 to coordinator `interpret_response` for the seven former TPF-06 capabilities. Validate item first, then separate correctness, concept, reasoning, completeness, alignment, independence and evidence sufficiency. Preserve alternatives and partial success; distinguish slips from uncertain misconception/prerequisite hypotheses.

Engine acceptance binds task/criteria/source/assistance/version and creates a specific acceptance receipt. TPF-08 receives only selected permitted findings and the accepted next action. Keep raw diagnostics/private criteria server-side. Do not label model self-check as independent verification or create official mastery/grades.

Refactor D12's current deterministic bounds so they enforce a single accepted action. If policy constrains it, record the reason and new permitted handling; do not publish conflicting recommendations.

### Work package 6.5 — Implement assistance and exposure ledger

Map shared assistance enums to D11/D12 values. Capture prepared versus accessible/released help, chapter worked examples, Board solutions, analogous examples, resource/accommodation context, attempts and self-correction. Preserve unknown exposure conservatively.

Fresh verification after exposure uses legitimate validated variation, not a cosmetic rename. Preserve familiarity, cueing, representation, integration and retention dimensions separately. Authorized accommodations/tools do not automatically weaken construct-preserving evidence.

TPF-08 words only the selected authorized hint/strategy. Repeated requests do not increase the ceiling. Protected work remains delegated to its owner and cannot be bypassed through the composer or an outside-class route.

### Work package 6.6 — Implement correction and substantial replan

For a challenged Teacher claim, hold affected future release and invoke the proper TPF-08 correction/source path. Confirmed errors produce explicit student-facing correction, versioned original/successor links, Board repair and evidence-owner recheck request. Source conflict remains unresolved, not blended into confident prose.

Immediate adjustments stay coordinator-owned inside current permissions. Significant time/sequence/objective changes invoke TPF-05 with actual position, delivered work, accepted evidence, failed strategies, open commitments and remaining time. D11 validates/applies the remainder atomically; preserve completed work and increment applicable delivery authority. Chapter revision occurs only for actual academic correction, not every plan change.

### Work package 6.7 — Implement post-closure response evaluation

Extend D12 with an explicit immutable-context reconciliation path for responses accepted while their task was valid. The current live path's closed-Class/current-controller checks are not simply removed. A separate job evaluates the accepted snapshot under evidence policy, records completion after closure and cannot reopen the Class or release live continuation.

Delivery 7 consumes late evaluation versions in summaries/notes. A later authorized historical feedback projection may show selected findings; it must not pretend feedback was delivered during the Class.

### Main integration points

D11 contracts/runtime/replan, D12 intelligence/contracts/service/repositories/runtime, coordinator schemas/routes, D14 task/delivery projection, Board/visual dependencies, response/extension UI and evidence/SKM handoffs.

### Reviewable deliverables

Task/window migrations and routes; check and interpretation adapters; acceptance receipts; single-action enforcement; assistance/exposure lineage; correction/remap workflow; current-state replan application; immutable post-closure evaluation; integrated response UI.

### Validation and acceptance

Test correct/partial/ambiguous responses, flawed task/key, valid alternative method, local slip, possible misconception, missing prerequisite evidence, hint ceilings, copyable chapter answer, fresh verification, active clarification, more time, no response, reload, asset delay, deadline/closure races, teacher error, major replan and formal protected refusal.

**Gate:** the full ask→deliver→wait→accept→interpret→feedback→adjust loop works with fair evidence and one instructional decision. Stale content and unsupported verdicts cannot reach the student.

**Handoff to Delivery 7:** actual accepted response/evidence/coverage records and durable unresolved work ready for academic reconciliation.

## Delivery 7 — Closure, memory, homework, assessment guidance and notes

### Outcome

Each Class closes with an accurate record, unfinished work carries forward, later teaching uses truthful history, homework/formal work receive valid guidance, and TPF-20 produces notes grounded in the actual session.

### Entry conditions

Delivery 6 complete. D11 closure facts, D12 reconciliation and D14 queue/delivery records are compatible. Study/source/card-set and downstream owner routes are identified; unavailable routes retain explicit held states.

### Work package 7.1 — Complete coherent closure

Invoke coordinator `close_class` with actual remaining time, closing policy, essential unfinished work, pending questions and active task. Choose a feasible stopping point. TPF-08 presents a concise truthful closing from authorized facts.

D11 commits closure position, actual work labels, evidence refs, task dispositions, unresolved questions and carry-forward/outbox. Background-generated/unconfirmed material is distinguished from confirmed rendering and never marked understood. A derivation unfinished at the hard boundary retains its exact return anchor.

Preserve accepted responses awaiting evaluation. Follow-up proposals stay proposals until a planner/scheduler confirms an arrangement. Closure cannot silently cancel all questions or mark deferred required material optional.

### Work package 7.2 — Implement exact recent history and summaries

Retain complete durable records and expose up to the last three existing relevant Classes for retrieval. The horizon is not a deletion policy. Index exact chapter/plan/portion/task/response/Board/correction/queue references; older summaries link consequential claims to originals and preserve uncertainty.

History availability distinguishes first Class, fewer than three, unavailable existing records, summary-only and sufficient excerpts. Current teaching continues without fabricated callbacks. `prepare_continuity` selects useful connections and unresolved work; each live mode receives relevant excerpts rather than full transcripts indiscriminately.

Prior discussion and demonstrated competence are separate claims. Pending questions link into a later authorized Class without reopening the old session; resolution updates through confirmed linked outcome, not merely copying the question into a summary.

### Work package 7.3 — Connect homework and planning modes

Coordinator `guide_assessment` supplies actual coverage, difficulty/uncertainty, exposure, assistance, intended evidence needs and legitimate task demand. TPF-05 closure/homework modes propose homework or no homework based on purpose and workload. Generation occurs only through explicitly requested homework mode with permitted resources and separate private criteria.

Preserve assignment/deadline authority, workload validation, task correctness, next-Class synthesis and rolling allocation within already scheduled classes. Missing/excused/system-affected work does not become unsupported weakness or punitive workload.

### Work package 7.4 — Connect formal assessment owners

Provide instructional guidance to existing planning/generation/validation/marking services. Preserve eligibility, package locking, source/coverage standards, integrity, grading/moderation/appeal and protected keys. Non-classroom diagnostic/re-entry/practice callers migrated to the coordinator must use their own registered permissions/context, not live-Class defaults.

Actual protected takeover invokes the correct work shell/resources. Historic/outside-class help cannot leak future assessment content or silently count as formal coverage/attendance.

### Work package 7.5 — Retain and integrate TPF-20

Supply versioned chapter/plan/closure, actual delivered explanation, useful examples, corrections, answered/unresolved questions, eligible sources/cards and later accepted evaluation updates. Preserve pre-Class private preparation and post-Class actual-teaching reconciliation, binding validation and stale-result refusal.

Private validated notes await authorized D27/Study Pack publication. Render Chapter, Class Summary and Class-grounded Study Notes as distinct artifacts. Missing route/source/card-set produces a truthful hold, not fabricated notes. Late reconciliation creates a new linked version without rewriting historical evidence.

### Main integration points

D11 closure/summary, D12 post-closure reconciliation, D14 note/queue repositories, TPF-05 planning modes, coordinator continuity/assessment modes, D13/D16/D17–20/D27 integrations and course/history UI.

### Reviewable deliverables

Closure transaction/summary integration; exact history retrieval and provenance summaries; cross-Class unresolved links; homework and formal guidance adapters; retained TPF-20 flow and publication-state UI; non-classroom caller fixtures.

### Validation and acceptance

Test first Class/short/missing history, useful versus forced historical connection, summary conflict needing original record, unfinished Class, pending questions, late evaluation, no-homework decision, workload hold, exposure-aware guidance, protected packages absent from context, TPF-20 hold/publication and next-Class resumption.

**Gate:** the Class and its successors tell one accurate story of preparation, actual events, demonstrated evidence, unresolved work and approved next steps.

**Handoff to Delivery 8:** complete remodeled flow and compatibility routes ready for final qualification/cutover.

## Delivery 8 — Qualification, migration, rollout and retirement

### Outcome

The remodeled Classroom is verified end to end, released through compatible frontend/backend versions and observed in the actual deployment. Old active bindings are retired only when their replacements and non-classroom callers are qualified.

### Entry conditions

Deliveries 1–7 acceptance gates passed. Every release configuration field has an actual adopted version/value or explicit feature disablement. No mandatory role/route/schema is represented by a placeholder implementation.

### Work package 8.1 — Reconcile traceability and migration

Mechanically compare all 22 old capabilities/callers to the final destination ledger. Check aliases, ceiling/owner preservation, specialized outputs, current manifest/body/schema hashes, preparation stages, tests/workflows and historical readers. Qualify retained TPF-05/08 modes and TPF-20 integration as well as coordinator modes.

No old 04/06/07 active binding is removed until every consumer has a working replacement. Their historic bodies/provenance remain readable. New coordination capabilities are registered explicitly; a migrated alias cannot grant hidden additional authority.

### Work package 8.2 — Qualify teaching quality and runtime

Run the blueprint's 44 scenarios and cross-delivery integration/fault/race tests. Use representative lessons requiring different explanation depth and response forms. Compare new Presenter behavior with the old baseline for coherence, sufficiency, over-explanation, interruption frequency, correction and resumption—not word count alone.

Fixture success proves deterministic contracts. Observe actual authorized provider generation and applicable visual/fallback output, asset retrieval, publication, client rendering, question/answer, reconnect, closure and study notes before claiming live readiness. Maintain test evidence with commit/deployment/prompt/schema versions and clear remaining limits.

### Work package 8.3 — Verify infrastructure and security

Inspect actual API/worker/static/database ownership. On the real API host verify durable workers/restart, leases, health/readiness, stream/proxy behavior, auth refresh, concurrency and environment policy. On PostgreSQL/Supabase verify migration history, grants/RLS, indexes, transaction/race behavior and recovery. On the frontend host verify asset versioning, auth origins/API routing, cache controls and compatible client version.

Use Render/Vercel/Supabase capabilities where those services actually own the work; do not create duplicate infrastructure. Preserve secrets. Verify cross-student/session IDs, asset refs, cursors, receipts, subscriptions, prompt injection, sanitized output and protected-mode cache/stream behavior.

### Work package 8.4 — Rehearse active-session rollback

Test rollback while a Teacher task is open and another question is unresolved. Stop new remodeled session admission when needed. Existing sessions remain on a compatible engine or pause with preserved state; they never downgrade blindly into latest-message-only UI.

Verify no timer reset, quota loss, unpublished content leakage, duplicate JOIN or missing pending message. Coordinate code, migrations, registry, workers, schemas/prompts and client assets. Rehearse worker restart and deployment version skew.

### Work package 8.5 — Roll out and observe

Release first through the actual authorized test-instance/cohort process. Monitor readiness, buffer starvation, receipt lag, queue age, task-window anomalies, stale rejection, interpretation holds, provider cost/failure and closure reconciliation.

Expand only after gates remain healthy and live academic/accessibility reviews pass. Stop expansion on lost commitments, unauthorized/private release, unfair task behavior or persistent incompatible state. Do not treat a successful deployment status as sufficient Classroom acceptance.

### Work package 8.6 — Retire obsolete active paths

After successful cutover, remove obsolete active 04/06/07 bindings and new-session Need Help/latest-message delivery paths. Update registry/catalog/hash/counts, source/task accounting, documentation and CI. Keep legacy session readers and historical provenance required by retention/compatibility policy. Remove compatibility code only under a later evidence-based cleanup decision, not automatic deletion at launch.

### Reviewable deliverables

Qualified capability/caller ledger; complete CI/database/browser/provider evidence; final release manifest; actual policy configuration; infrastructure readiness record; staged rollout evidence; rehearsed rollback/runbook; obsolete-active-path cleanup with preserved history.

### Final acceptance

- All eight deliveries meet their gates and all blueprint scenarios have evidence.
- Complete chapters and coherent continuous teaching work in the actual connected UI/backend.
- Every visible control has a functioning permitted route and truthful outcome.
- Message/task/receipt/closure transactions survive retries, crashes and races.
- No lost questions, inflated evidence, private leakage, invented timing or conflicting decision owners.
- Formal/attendance/SKM/identity/publication boundaries are preserved.
- All migrated non-classroom responsibilities remain functional.
- Mobile, keyboard, screen reader, zoom and reduced-motion QA passed.
- Frontend/backend/worker/prompt/schema/registry/database versions are compatible.
- Active-session rollback is demonstrated, not merely documented.

**Gate:** the actual student experience and the durable academic record match the blueprint. Only then is the remodeling considered delivered.

## Appendix A — Backend/frontend contract checklist

The following target routes are proposed by the blueprint. Confirm repository conventions during Delivery 1, then keep one versioned route manifest consumed by server registration, client bindings and contract tests. Existing `/api/teaching` auth/ownership and legacy routes remain compatible.

- **Session snapshot — Delivery 3:** `GET /classes/:id/classroom/session`. Returns bound session/schema/Controller/delivery versions, epoch, server time, cursor, released chapter references and permitted capabilities. Deliveries 5–7 extend through compatible fields for balances, queue, tasks and history. Private buffers/criteria never appear.
- **Released conversation — Delivery 3:** `GET /classes/:id/classroom/conversation?after=...`. Bounded cursor deltas/history with stable server order and reset behavior. Pagination cannot skip or reintroduce events.
- **Chapter — Delivery 2, UI in Delivery 4:** `GET /classes/:id/classroom/chapter`. Complete validated public material for the exact version and active authorization; protected mode checks apply every time.
- **Public stream — Delivery 3:** `GET /classes/:id/classroom/stream`. Authorized released events/state only, resumable cursor and polling fallback. It is not a delivery receipt or raw internal outbox subscription.
- **Client control — Delivery 3:** `POST /classes/:id/classroom/client-lease`. Claims/renews/takes over the permitted active control client and returns epoch/expiry. No direct academic mutation.
- **Presentation controls — Delivery 3, UI in Delivery 4:** `POST /classes/:id/classroom/presentation-controls`. Typed pause/resume/pace intent, relevant expected state/epoch and idempotency. Response says requested versus applied and carries resulting state.
- **Render receipts — Delivery 3:** `POST /classes/:id/classroom/delivery-receipts`. Valid released portion/client binding, accessible representation readiness and duplicate-safe limited confirmation. Cannot certify mastery/attendance or backdate a question.
- **Student messages — Delivery 5:** `POST /classes/:id/classroom/messages`. Saves admission/allowance/queue/event atomically and returns message receipt, authoritative balance and public status.
- **Queue projection — Delivery 5:** `GET /classes/:id/classroom/questions`. Public question disposition/commitment/outcome and unresolved links; excludes private decision rationale and criteria.
- **Task responses — Delivery 6:** `POST /classes/:id/classroom/tasks/:taskId/responses`. Exact task/window/version, server-timed acceptance and immutable context. No arbitrary first-Learning-Unit fallback.
- **More time — Delivery 6:** `POST /classes/:id/classroom/tasks/:taskId/extensions`. Policy-bound request/outcome; same active window, no Teacher-granted extension.

Reuse existing course Classes, JOIN, Notebook, asset, Blueprint/Controller, formal work and history routes where their semantics fit. Outside-Class follow-up requires its own authorized admission/workflow, not a completed live Class write.

### A.1 Required request/response semantics

Commands include operation identity/idempotency, typed intent, exact target and expected relevant versions. The server returns acceptance/applied distinction, receipt/current state and any reconciliation requirement. Every expected version is checked at the relevant transaction, not only at initial API parsing.

Define distinguishable public errors for unauthenticated/not-owner, incompatible client/schema, invalid content, idempotency conflict, unavailable qualification/dependency, quota exhaustion, protected activity, stale task/window/controller/client epoch, closed Class, and transient system failure. A stale-state response provides safe refresh/retry guidance. It must not invent success or leak raw provider/SQL details.

### A.2 Transaction and constraint allocation

- Delivery 2: immutable academic versions, anchor uniqueness/remaps and validated plan/chapter binding.
- Delivery 3: one published effect per portion; one receipt per valid receipt key; monotonically ordered conversation; current delivery/control epoch; publication plus outbox atomicity; lease-guarded due work.
- Delivery 5: message plus allowance charge plus queue plus acceptance event; exact-key retry matching; group/commitment ownership and persistent unresolved state.
- Delivery 6: task/window exclusivity; response plus accepted context plus window transition/evaluation event; interpretation acceptance; version-fenced correction/replan with invalidation.
- Delivery 7: closure plus open-work disposition/continuity and outbox; source-linked summary/note versions; late evaluation reconciliation without live reopening.

All network/provider calls occur outside long database transactions. Database constraints and guarded transactions enforce invariants; AI wording and browser disabling alone do not.

## Appendix B — Precise prompt amendments to implement

Use the existing prompt-authoring/governance mechanism and preserve all unaffected requirements. The following wording expresses the required semantics; final formatting may follow the governed family template.

**Coordinator unit ownership:** “Preserve the chapter author's teaching-unit identities, structure and source anchors. Create presentation subgroups within those units. Propose a structural change only through an authorized revision with an explicit reference map.”

**Coordinator local references:** “Preserve every supplied reference exactly, including document-local chapter anchors. Prefix only new coordinator-proposed identifiers with `local_`. Runtime assignment of authoritative identifiers is separate.”

**Failed-strategy rule, both coordinator and Presenter:** “Do not repeat a materially ineffective strategy without addressing its identified cause. A paraphrase alone is not a substantive strategy change. Repetition is permitted for a specific clarification, requested recap or recovery of undelivered content; record its purpose and preserve the resumption point.”

**TPF-05 continuation:** “For a partial chapter, return completed units intact, the continued candidate/version, preserved reference map, last completed unit, remaining required units, content to preserve and next authoring task. Continue without restarting, renumbering unchanged anchors or compressing the remaining material into summaries.”

**Owner resolution:** “Ordinary classroom question design, interpretation and immediate strategy use the registered Teaching Coordinator modes through their owning services. Substantial lesson replanning remains Lesson Planner responsibility. Official grades, knowledge state, attendance, eligibility, progression, formal work and publication remain authorized domain decisions.”

**Timing and execution:** “Use authoritative runtime policy and confirmed effects for deadlines, pacing, queues, counts, follow-up and overtime. Missing values are unknown. A generated proposal is not an executed action. Do not promise a system effect before its required confirmation.”

**Exposure:** “Keep prepared assistance, released/accessibly available content, render confirmation and demonstrated evidence separate. Missing receipt is not proof of no exposure. Do not upgrade independence because a previously exposed resource was later hidden.”

**Interpretation acceptance:** “Ordinary classroom findings can inform Presenter feedback after the engine validates and confirms acceptance for the exact task, criteria, source, assistance and state. This is not independent academic verification. Formal or explicitly external validation remains with its owner.”

**Output compatibility:** “Use only the registered compatible mode-specific schema. Preserve all required authority, evidence, private/public and confirmation distinctions. If the schema cannot represent required work, return its contract-error form rather than silently dropping fields.”

Apply these in Delivery 1; verify their actual runtime effects in Deliveries 2–7 and benchmark them in Delivery 8. Do not add a fixed minimum explanation length or maximum universal turn length that recreates shallow teaching. Budget controls portion density and authorized horizon while preserving essential reasoning.

## Appendix C — Blueprint section ownership

Each blueprint section has a primary delivery owner and cross-delivery integration where required:

- Delivery 1 owns sections 1–5, 9–10 and the executable foundation of 14: decisions, invariants, baseline, authority, vocabulary, prompt governance, migration and state contracts.
- Delivery 2 owns sections 6–8 preparation implementations and 11: authoring/planning, guidance/Presenter preparation and readiness. Live coordinator/Presenter behavior completes in Deliveries 3, 5 and 6.
- Delivery 3 owns sections 15, 22–24: pacing/delivery, persistence/transactions, APIs/events and concurrency/recovery. Message/task/closure entities are extended by Deliveries 5–7.
- Delivery 4 owns sections 12–13: full student composition, reading, Board/Notebook, historical and protected surfaces. Composer/tasks become operational with Deliveries 5–6.
- Delivery 5 owns section 16: admission, dispositions, allowances, queue and interruption commitments.
- Delivery 6 owns sections 17–19: checks/windows, interpretation, assistance/evidence, correction and replanning.
- Delivery 7 owns sections 20–21: exact memory/continuity, closure, homework, formal guidance and TPF-20.
- Delivery 8 owns sections 25–30 final verification: security/accessibility, performance/observability, real infrastructure, rollout/rollback, qualification and release traceability. Their implementation requirements apply from the relevant earlier delivery, not only at the final audit.

Blueprint appendices A–C are binding contract/scenario/evidence references across deliveries. No blueprint requirement is deferred merely because it is not a standalone delivery title.

## Appendix D — All 44 qualification scenarios allocated

Numbers refer to blueprint section 29. The named delivery owns scenario completion; other deliveries supply required components. Delivery 8 reruns/integrates all scenarios against the final release.

- **Delivery 1:** contract/migration fixtures supporting 39 and 40; final all-caller qualification belongs to Delivery 8.
- **Delivery 2:** 1 simple concept, 2 dense equation content, 3 long chapter continuation. Scenario 2 pacing/dependency behavior is also exercised through Deliveries 3–4.
- **Delivery 3:** 4 ordinary automatic flow; 17 reload presentation; 19 lost acknowledgement; 20 multiple devices; 21 background/offline; 22 worker crash; 23 provider stall; 24 visual failure. Deliveries 5–6 extend acknowledgement/offline cases to messages/tasks.
- **Delivery 4:** 38 historical UI; 42 accessibility/mobile, with repeated task/queue accessibility checks when those features activate.
- **Delivery 5:** 5 immediate blocker; 6 boundary deferral; 7 grouped questions; 8 unrelated/protected request; 9 exhausted allowance; 31 unresolved queue at closure. Delivery 7 adds actual next-Class links for 31.
- **Delivery 6:** 10 wrong/partial answer; 11 assistance; 12 chapter copyability; 13 question asset delay; 14 extra time; 15 no response; 16 open-window clarification; 18 reload timed task; 25 correction; 26 replan; 27 lateness; 28 break/early dismissal; 29 protected takeover; 30 closure race.
- **Delivery 7:** 32 first/short history; 33 real prior connection; 34 older-summary conflict; 35 homework; 36 formal guidance; 37 TPF-20.
- **Delivery 8:** 39 full migration; 40 schema drift; 41 ownership/security; 43 actual deployment; 44 rollback, plus end-to-end regression of 1–44.

Each scenario record must contain given state, action/failure, expected public behavior, expected persisted facts, forbidden effects, tested versions and evidence. Test academic assertions and transaction effects, not only HTTP success status.

## Appendix E — Runtime configuration adoption record

Delivery 1 defines typed fields, constraints and owners; development tests use explicit fixture values that are not presented as production policy. Delivery 8 adopts/calibrates final values and proves their compatibility. Required fields include:

- Presentation pace profiles, content-type dwell handling and minimum/maximum bounds.
- Prepared-buffer count/byte/cost/source-horizon limits and response-decision stopping rules.
- Message allowance, admission lane/rate policy, refund exceptions if any and exhaustion behavior.
- Task-specific duration, authorized accommodations, extension bounds, grace/admission and closure policy.
- Active-client lease/renewal/takeover and reconciliation limits.
- Closure lead time, coherent-boundary handling and no-overtime default unless actual policy grants an exception.
- Generation timeout/retry/ambiguous-outcome handling and per-capability/session budgets.
- Asset capability/fallback policy, existing visual bounds and any governed changes.
- Exact-history retention, summary generation/versioning and authorized retrieval scope.
- Transport reconnect/backoff, delta pagination/reset and protected cache-control requirements.
- Cohort admission, route qualification, feature/session version and rollback support.

For each field record the owner, authority/source, adopted value/version, validator, session-effective rules, UI behavior, failure behavior and qualifying scenario. Never let an absent number silently become unlimited permission, zero student evidence or an invented Teacher promise.

## Definition of the completed project

The student starts an authorized Class with a complete chapter, receives coherent paced teaching, asks contextual questions through persistent chat, answers fair Teacher checks, gets accepted evidence-based feedback and resumes correctly after interruption. The Class closes honestly, pending work survives, and later lessons/notes reflect actual events.

The backend and frontend agree on references, versions, time, permitted actions and recorded outcomes. The prompt merger preserves all 22 mapped capabilities and their authority. TPF-20 remains. Old active bindings are retired only after the complete replacement works and rollback is demonstrated.




## Appendix F — Exact 22-capability migration destinations

This ledger is carried directly from the blueprint. Delivery 1 validates and extends it with every actual caller/schema. Deliveries 2, 6 and 7 implement the appropriate preparation, live and non-classroom adapters. Delivery 8 qualifies all replacements before active retirement.

### F.1 TPF-04 destinations

- `teaching.curriculum.targeted_placement_prior_knowledge_diagnostic_design` → coordinator `design_check` in the Curriculum/Assessment-owned diagnostic workflow; returns a bounded specification/candidate, not official placement.
- `teaching.lesson.fresh_verification_task_selection_after_answer_exposure` → `design_check`, with exposed-item lineage, fresh task validation and evidence restrictions.
- `teaching.scheduling.makeup_re_entry_diagnostic_design` → `design_check` using `prepare_continuity` output, actual absence/missed dependencies, and planner-owned re-entry context.

### F.2 TPF-06 destinations

All seven below route to coordinator `interpret_response` through the Response Evaluator/D12 boundary, preserving distinct requested findings:

- `teaching.lesson.response_correctness_quality_evaluation`.
- `teaching.lesson.response_error_taxonomy_classification`.
- `teaching.lesson.correct_but_insufficient_evidence_detection`.
- `teaching.lesson.partial_response_decomposition`.
- `teaching.lesson.procedural_slip_detection`.
- `teaching.lesson.misconception_detection`.
- `teaching.lesson.prerequisite_failure_detection`.

They do not become official marking or permanent diagnosis authority. Formal uses retain their validation and owner-specific constraints even when sharing a prompt body.

### F.3 TPF-07 destinations

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


## References and status

The full remodeling blueprint and four supplied source files are the design inputs. The baseline registry and source implementation were inspected previously; repository main was rechecked at plan creation. This plan adds sequencing and execution details without claiming production verification.

[KIWI repository baseline](https://github.com/happysolomon43-boop/KIWI/tree/a77aec6fbd49b89a4538610e434151e2f5fb8cde)

Planning is complete. Implementation, deployment, prompt activation and retirement are future work under these eight delivery gates.
