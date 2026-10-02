# KIWI Teaching D19 — Assessment Types & Measurement Behaviour

## Delivery boundary

D19 implements exactly the type-specific measurement layer over the accepted D17 Assessment domain and D18 Assessment Shell. D17 remains authoritative for Assessment Definition/Blueprint/Candidate/Validation/Package/Attempt/Response/finalization truth. D18 remains the browser-safe attempt/rendering layer. D19 owns type purpose, scope posture, announcement/release posture, cumulative coverage guards, governed surprise controls and Make-Up/Incomplete semantics. D20 remains the exclusive owner of formal marking, moderation, appeals and Gradebook truth; D21 remains Progression/Resit owner.

Canonical D19 scope is `TCH-0376`, `TCH-0378`–`TCH-0394`, `TCH-0909`, `TCH-0910`.

## Architecture

`teaching/d19/contracts.js` defines the provider-independent `d19.measurement.v1` contract. It preserves the existing D17 type taxonomy: Diagnostic, Classwork, Impromptu Test, Scheduled Test, Mid-Semester, Final Examination, Make-Up, Resit and Verification. It deliberately does not invent a new `IMPROMPTU_EXAM` enum because the accepted first-release D17 taxonomy does not retain one; broader surprise-assessment behavior therefore remains outside the first-release type set unless changed through canonical change control.

`teaching/d19/service.js` is a deterministic wrapper around the accepted D17 service. It consumes authoritative D06 policy, D08 Course Plan/Learning Unit facts, D11 Class/Controller state and D14 Class history. No provider SDK, model choice or prompt text is added. Existing D17 planning/generation/independent-validation paths remain the only model-backed Assessment paths and remain subject to the D30 qualification hold.

`teaching/d17/routes.js` now constructs the D19 wrapper and uses it for Assessment definition, Blueprint preparation, deterministic lock preflight and attempt exposure while retaining all existing D17 endpoints and the D18 shell mount. A student-safe `GET /teaching/assessments/:id/measurement-policy` projection exposes purpose/posture without protected Blueprint/question/answer material.

## Persistence

D19 introduces no migration, table, column, role, grant or RLS change. The live D17 schema already has the authoritative carriers required by D19: `teaching_assessments.assessment_type/purpose/graded/announced_scope/policy_version/source_lineage`, Blueprint `source_state_versions`, and Package `policy_snapshot`. D19 binds its contract and D06 policy versions through those existing owner-controlled fields. It creates no shadow assessment-type table and grants no browser role direct authoritative DML.

## D06 policy binding

D19 consumes the accepted D06 decision registry rather than inventing local numbers.

- `TCH-0079 / impromptu-budget.v1`: at most one graded Impromptu Assessment per three completed Classes, no consecutive scheduled Classes, at most 20% of the Class block, default Course grade influence cap 10%, legitimate academic trigger required, eligible content only, and Package ready/validated before Class.
- `TCH-0694 / assessment-eligibility-exceptions.v1`: first-release graded scope must be Taught or Validated Prior Knowledge. A merely labelled assumed prerequisite is not sufficient until validated. Ungraded Diagnostic is the explicit probing exception.

## Canonical task accounting

- `TCH-0376` — Diagnostic is explicitly non-graded. D19 rejects a graded Diagnostic definition and publishes Gradebook posture as prohibited; diagnostic learning evidence can only leave through the later authoritative SKM/evidence path.
- `TCH-0378` — Classwork requires an authoritative Class reference and measures the intended/recent taught Class scope rather than arbitrary Course content.
- `TCH-0379` — D19 declares the graded Classwork standard locked after start. Blueprint/package mutation remains governed by D17; live response performance cannot rewrite the locked standard.
- `TCH-0380` — Scheduled Test is an announced recent-scope formal graded type. Public scope is allowed, while exact questions and hidden Blueprint material are rejected from the student-facing scope payload.
- `TCH-0381` — Mid-Semester is cumulative over current eligible material and is checked against Course Plan facts so older eligible content cannot disappear through pure recency selection.
- `TCH-0382` — Final Examination is terminal cumulative measurement. D19 requires strategic Course representation and D17 additionally preserves the existing fail-closed incomplete-required-coverage gate.
- `TCH-0383` — Any Blueprint slot spanning multiple Learning Units must preserve decomposable Learning Unit lineage through rubric criteria or an explicit measurement lineage contract.
- `TCH-0384` — Impromptu Test requires a canonical academic trigger: delayed retention verification, previously strong retention check, cumulative checkpoint, uncontrolled-work independence verification, or a planned governed surprise.
- `TCH-0385` — D19 exposure requires the already locked D17 Package; no live-answer-adaptive next-question generation is introduced.
- `TCH-0386` — Anti-overuse uses D06 `impromptu-budget.v1`; no additional magic numeric budget is invented.
- `TCH-0387` — Future Impromptu Assessments are removed from the student Assessment list projection until the intended Class has ended; D19 creates no pre-exposure Calendar/Today/notification event and does not corrupt Scheduler truth to preserve surprise.
- `TCH-0388` — Impromptu Attempt start requires the authoritative D11 Controller to be in `ASSESSMENT`, enforces D06's Class-time ratio and requires the locked Assessment duration to fit within remaining scheduled Class time. Schedule extension is exactly zero; remaining lesson time is returned for Controller replanning.
- `TCH-0389` — D19 defines a D13 retention-evidence-candidate handoff after a resolved result reference exists. It cannot directly mutate SKM, erase prior evidence or decide progression.
- `TCH-0390` — the first-release type registry retains `IMPROMPTU_TEST` only. No broader `IMPROMPTU_EXAM` product type is silently created.
- `TCH-0391` — D19 binds the configured 10% default unannounced grade-influence cap as type/category metadata and enforces the frequency/time budget. It does not calculate official Gradebook totals; D20 remains owner.
- `TCH-0392` — all non-Diagnostic formal measurement uses the stricter D06 first-release eligibility bases: Taught or Validated Prior Knowledge. Untaught/unvalidated/merely-assumed prerequisite content is rejected before lock.
- `TCH-0393` — Mid/Final lock preflight runs a deterministic Course Plan coverage audit. It rejects recency-only selection when older eligible material exists, rejects complete omission of High/Foundational content when such eligible content exists, and for Finals rejects one-topic representation when eligible scope spans multiple topics.
- `TCH-0394` — D19 exercises and protects the type declaration → Blueprint → D17 validation/lock → D18/D17 Attempt boundary, then emits an explicit `AWAITING_D20_MARKING` handoff with no mark or Gradebook mutation. This satisfies the frozen delivery ordering without implementing D20 early.
- `TCH-0909` — `missedDisposition` preserves System-Protected, Invalidated, approved Not-Attempted and Final Incomplete meanings. Make-Up is distinct from Resit and valid academic failure. Original history is never rewritten.
- `TCH-0910` — `createMakeUp` binds the replacement to the source Assessment and exact intended source Blueprint/version, uses a stable idempotency key, copies only Blueprint architecture/scope, never candidate/question/answer payloads, and requires fresh candidate generation. Source-answer release remains blocked while the equivalent replacement is live; KIWI/system failure never becomes academic failure.

## TCH-0394 source-boundary resolution

The permanent task text names a full Mid/Final generation→validation→attempt→mark→review cycle, while the frozen roadmap places formal marking/moderation/Gradebook in D20 after D19. D19 therefore tests and exposes the existing D20 boundary rather than implementing D20. `markReviewHandoff` requires a finalized D17 Attempt and returns owner `D20`, state `AWAITING_D20_MARKING`, `officialMark:null`, `gradebookMutation:false`. No prompt, mark algorithm, rubric credit decision, moderation or Gradebook row is added by D19.

This is an implementation of the accepted handoff's explicit boundary resolution, not a permanent task rename or architecture exception.

## Security and authority

D19 rejects protected answer/question/rubric/Blueprint keys from announced-scope payloads. Impromptu student visibility is always `HIDDEN_UNTIL_EXPOSURE`. The wrapper never receives provider credentials and does not add provider/model calls. It does not mutate Scheduler, Attendance, SKM, Gradebook or Progression truth. D17's locked Package, one-authoritative-device, append-only responses, server expiry/finalization and D18's browser-safe projection remain unchanged.

## Deployment and later-delivery boundaries

D19 changes backend Assessment behavior and therefore requires exact-merge Render verification; route-level frontend/API integration also requires exact-merge Vercel production verification. D19 has no production database migration to apply. D30 route qualification remains open and D31 production-release gate remains authoritative.
