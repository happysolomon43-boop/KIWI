# KIWI Teaching D17 — Assessment Domain, Blueprinting, Generation, Validation & Eligibility

## Delivery boundary

D17 implements exactly the canonical D17 Assessment domain. It does not implement D18 Assessment Shell presentation/renderers, D20 Gradebook/mark finalization, D27 Study/FSRS integration, D30 model-route qualification, or any later delivery.

The 56 canonical D17 tasks accounted for by this implementation are:

- `TCH-0052`–`TCH-0056`
- `TCH-0326`–`TCH-0356`
- `TCH-0676`
- `TCH-0717`–`TCH-0725`
- `TCH-0727`
- `TCH-0733`–`TCH-0734`
- `TCH-0891`–`TCH-0897`

The implementation keeps the accepted predecessor ownership boundaries intact: D04 owns Assessment Eligibility, D09 owns time/schedule, D10 owns Requests, D13 owns SKM, D16 owns Homework/Assignment truth, the shared Integrity Session Guard owns controlled-session lifecycle facts, D17 owns formal Assessment definition/blueprint/candidates/validation/package/attempt/response truth, and D20 remains the only future Gradebook owner.

## Authoritative state model

D17 deliberately separates four state axes rather than collapsing them into one lifecycle:

- Assessment Definition state describes the durable assessment object and its declared purpose/type.
- Blueprint/Package state describes the measurement design and the immutable exposed package version.
- Attempt state describes student administration lifecycle (`CREATED`, `ACTIVE`, `SUBMITTED`, `EXPIRED`, invalidated/cancelled paths).
- Result state describes whether a final result exists; D17 never promotes this into official Gradebook truth.

The browser is never authoritative for package scope, response-form architecture, time expiry, final submission, device transfer, item invalidation, or package locking.

## Eligibility and Course-scope authority

`public.teaching_assessment_eligibility` from D04 remains the authoritative Assessment Eligibility Ledger. D17 does not create a competing eligibility truth.

An eligible-candidate Blueprint snapshots D04 eligibility with source Course Plan/coverage versions and a deterministic snapshot hash. Graded scope accepts only the canonical bases represented by the D04 record: taught content, validated prior knowledge, or an explicitly allowed assumed prerequisite. Unknown/ambiguous eligibility reasons fail closed.

Forecast/PPL planning is a separate `FORECAST_PLANNING` lane. Forecast scope can prepare planning metadata but cannot create Assessment Eligibility, protected candidate questions, or a lockable package. Candidate generation requires the separate `ELIGIBLE_CANDIDATE` lane and a persisted eligibility snapshot.

The Course audit exposes required Learning Units, instructionally complete Learning Units, and formally assessed Learning Units. Final Examination lock is blocked when required Course scope remains instructionally incomplete; an exam cannot compensate for untaught Course content by silently testing it.

## Assessment Blueprint and response-form architecture

Blueprints are immutable/versioned records. They fix intended marks, Learning Unit lineage, measurement demand, response family, timing budget, resource policy, accommodation policy, and response-form architecture before package exposure.

Scheduled Tests may be `mcq_only`, `constructed_only`, or `mixed` when legitimate for the approved construct and renderer/policy/time limits. Mid-Semester and Final Examination designs that use a single response mode require an explicit academic justification rather than inheriting a universal mixture percentage.

Rubric criteria require positive marks and explicit Learning Unit/skill lineage and cannot expand beyond the Blueprint slot. Dynamic marks are based on creditable cognitive work rather than equal-question defaults.

Timing is derived from predicted item workload plus explicit review capacity. The normal timer is one overall authoritative expiry. Per-question timing is reserved for an explicitly timed skill contract.

Accommodations may change access conditions, presentation, breaks, assistive technology, or approved time allowance while recording that the underlying academic standard remains unchanged.

## MCQ and candidate generation contract

For MCQ slots, deterministic D17 code creates the authoritative choice-set contract before model execution: option count, stable option IDs, and final ordering authority are not invented by the generator. The model may generate bounded candidate content and distractor/error-model evidence, but cannot change the deterministic choice-set authority.

Candidate generation is provisional T3 work through the Teaching Orchestrator and central KIWI AI Orchestrator. It receives the locked Blueprint slot and eligibility snapshot; it cannot inspect raw Subject scope to expand graded coverage.

Protected candidate pools are risk-bounded per Blueprint slot. One candidate is the default. More than one requires an explicit risk/importance reason and is capped by a deterministic pool limit. Candidate content, answer keys, rubrics, distractor traces, and other protected fields remain server-only.

Equivalent make-up/resit/verification variants are generated through the governed equivalent-variant capability and remain candidates until the same independent validation path passes.

## Independent validation and repair

Generation never self-validates.

Every current candidate must pass an independent validation pipeline. The pipeline includes general answerability/scope/ambiguity/clue/mark/demand checks plus, where applicable:

- independent out-of-scope/untaught hidden-dependency detection;
- objective-key uniqueness/correctness checks;
- independent quantitative solution verification;
- code-item test-case validation;
- interpretive-rubric defensibility and legitimate-alternative-answer review.

A candidate with `FAIL`, `REPAIR`, `REVIEW_REQUIRED`, `REJECTED`, `REPAIR_REQUIRED`, `RETIRED`, or `CONTAMINATED` posture cannot be delivered merely because an older validator output existed.

After all current item versions pass, a separate whole-package validator checks coverage, response-form adequacy, timing, duplication, leakage, and policy compliance. Item PASS never implies whole-package PASS.

## PPL forecast, candidate, contamination, and finalization

D17 persists an Assessment PPL workspace per lane with maturity, authoritative input versions, open findings, materiality digest, route posture, and finalization readiness.

Forecast preparation may use an economy/bounded route posture only for planning artifacts. Eligible candidate development uses the stronger design/validation posture. Route posture is metadata for the central orchestrator; D17 never hard-codes provider/model identifiers and never marks an unqualified route production-ready.

Protected-candidate contamination records are durable. Contamination immediately makes the candidate unusable and makes finalization fail closed. The contamination fact is immutable; only the narrow `selective_recheck_required=true → false` resolution transition is permitted, and only with a resolution timestamp/reference after a replacement/current candidate independently passes.

Final package reconciliation requires all of the following at current state:

- persisted eligible-candidate PPL workspace at candidate/pre-lock maturity;
- current authoritative Assessment Eligibility still permits every required Learning Unit;
- authoritative source versions are not stale;
- every current candidate has an independent PASS;
- a separate whole-package PASS exists;
- no unresolved contamination remains;
- Final Examination required Course coverage is complete;
- response-form, resource, accommodation, timing and policy constraints remain valid.

Deadline proximity cannot lower these requirements.

## Deterministic package lock and exposure protection

The Package owner deterministically creates a content-addressed package hash from the Blueprint version, validated candidate versions and policy snapshot. The locked package fixes scope, timing, response-form architecture, resources, accommodations and item identities before exposure.

Core locked-package and locked-item content is immutable at the database layer. Later intelligence cannot silently mutate an exposed package. Explicit defect/invalidation metadata and answer-exposure retirement are the only permitted narrow post-lock mutations.

When an exact item answer is exposed, D17 retires that item/candidate as clean future evidence rather than pretending the original item remains independent evidence.

## Assessment Attempt and response truth

An Attempt can start only against a locked package. Exactly one active Attempt per Assessment/student is enforced by a partial unique index.

D17 binds the authoritative Attempt ID into the already accepted shared Integrity Session Guard using `TEACHING_ASSESSMENT_ATTEMPT`; it does not create a parallel browser-lock ledger. Mid-Semester/Final/Resit attempts receive the shared high-stakes posture, while ordinary controlled tests use the scheduled-test posture.

Responses are append-only server-accepted versions containing renderer JSON. D17 creates the renderer-agnostic persistence contract but deliberately leaves the complete D18 Assessment Shell/renderers UX for D18.

The shared Exam interface now exposes an explicit `d17.v1` Assessment Shell handoff/compatibility contract: server autosave required, local draft non-authoritative, server timestamps authoritative, locked package required, and existing KIWI Exam data/ownership preserved rather than rewritten.

## Time, autosave, submission and device transfer

Attempt expiry is a durable D05 due event derived from authoritative server timestamps; an open browser tab is not required.

Autosave stores append-only server snapshots. The browser may also keep local drafts for recovery, but a local draft does not become final academic truth until accepted by the server.

Manual submit and expiry share one compare-and-set finalization path. An authenticated final submission accepted at or before `expires_at` while the Attempt is still Active wins; otherwise expiry atomically finalizes the latest server-accepted response snapshot. Only one finalization transition/version can succeed.

Early submission requires explicit confirmation and reports unanswered/partial risk before using the same authoritative finalization path.

Controlled device transfer updates the one authoritative active-device binding server-side; another device cannot save into an Attempt merely by presenting stale browser state.

## Assessment Mode assistance and student challenge

D17 defines an allowed-action set above model output. Prompt/content injection cannot grant prohibited content help.

Procedural clarification is separated from content help. Direct answer/method/hint requests during an active formal Attempt are deterministically blocked before model execution. Ambiguous clarification may be routed through the bounded classification capability without granting academic-help authority.

Students can flag/challenge a potentially faulty item during an active Attempt without answer revelation. The challenge becomes review input, not a student-controlled invalidation or answer key.

## Defects, invalidation and fairness

Item/attempt invalidation has explicit scope and reason lineage. KIWI/system-caused defect handling structurally records `student_penalty_allowed=false`.

A faulty package item may be neutralized without rewriting the student's response history. D17 computes deterministic remaining-mark/reweight metadata for the later authoritative marking owner and preserves the original mark total; D17 itself does not commit an official mark.

Missed Classwork, Scheduled Tests, Impromptu Tests and Final Examinations use distinct pathways. A missed Final is an incomplete/make-up pathway rather than an automatic academic fail. KIWI-caused administration failure becomes `SYSTEM_PROTECTED` rather than a student penalty.

## Persistence and security

D17 introduces server-owned Assessment definition, Blueprint/eligibility snapshot, protected candidate/version, validation, Package/item, Attempt/event/response, challenge, invalidation, contamination and PPL workspace tables.

All D17 tables enable RLS. `anon` and `authenticated` have no direct table grants. `service_role` gets only the required server operations. Blueprints, eligibility snapshots, candidate versions, validation evidence, Attempt events, responses and invalidation records are append-only. Contamination records have a deliberately narrow governed resolution transition.

Protected marking/candidate fields are never returned by browser package projections.

## Model/runtime posture

All model-backed D17 work routes through the existing Teaching Orchestrator into the central KIWI AI Orchestrator. No provider SDK or provider/model identifier is hard-coded in D17.

The current frozen prompt-family bindings are:

- assessment planning/Blueprinting: TPF-12 v1.3;
- candidate/item generation: TPF-13 v1.3;
- independent item/package validation/control: TPF-14 v1.4.

These bindings do not raise capability authority. D17 cannot use model output to decide eligibility, lock a package, write Gradebook truth, change progression, or prove misconduct.

All Teaching AI routes remain subject to the canonical D30 empirical qualification hold.

## Acceptance and deferrals

D17 acceptance requires its canonical verifier, focused unit tests, full Teaching regressions, full repository regressions, web build, isolated PostgreSQL reconstruction through D17, D02–D17 integration regressions, and production-safe Supabase security/schema verification.

Deliberately deferred owners are unchanged: full Assessment Shell/renderer UX is D18; assessment-type measurement behavior is D19; formal marking/moderation/Gradebook is D20; Study/FSRS integration is D27; empirical route qualification is D30.

No architecture exception is introduced by this delivery.
