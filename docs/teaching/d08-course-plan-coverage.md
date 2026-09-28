# KIWI Teaching D08 — Course Plan, Coverage & Course-Creation Review

**Delivery:** D08  
**Hard predecessor:** D07  
**Canonical task count:** 33  
**Route posture:** all model-backed Teaching routes remain UNQUALIFIED until D30.

D08 turns the D07 validated curriculum/source state into a versioned Course Plan authority and deterministic Course Coverage lifecycle without changing Subject truth, scheduling authority, Course activation ownership, SKM/mastery, Gradebook, Assessment Eligibility, or provider/model routing.

## Implemented delivery scope

- TCH-0101 — student-facing Course Coverage Report contains mapped, pending, VPK-complete, taught-complete, assumptions, exclusions, and safe coverage messages without raw ledger identifiers.
- TCH-0103 — Course Plan generation consumes the current validated Curriculum Audit, applicable Diagnostic/VPK state, frozen TPF-03 contract, state reference, and current source snapshot; unresolved required Diagnostic state fails closed.
- TCH-0104 — Course Plan version 1 is durable before downstream Semester/activation work and is bound to Course snapshot, Curriculum Audit, source-inventory digest, schema/contract version, and execution provenance.
- TCH-0105 — assumed prerequisites are persisted with disclosure text, resolution state, VPK reference where available, and policy version.
- TCH-0106 — Learning Unit exit conditions are deterministic domain-validated; high/foundational units require independent evidence conditions.
- TCH-0107 — Learning Unit criticality/foundational state and instructional-load bounds are persisted.
- TCH-0108 — split/merge/replaced/refined Learning Unit lineage is represented as version-to-version relationships instead of rewriting historical unit identifiers.
- TCH-0109 — authoritative Subject changes are detected against the Course source baseline and stored as explicit scope-change candidates.
- TCH-0110 — deterministic scope classification distinguishes no change/minor supplement from review-required material scope.
- TCH-0111 — successor Course Plans receive monotonic versions, immutable predecessor links, checksums, and material scope-diff summaries.
- TCH-0112 — current Course Plans never silently inherit later Subject state; source adoption marks the previous plan REVIEW_REQUIRED and requires a new Audit/Plan version.
- TCH-0114 — Stage 2 review exposes validated source analysis, meaningful/excluded content counts, assumptions, plan state, and Coverage state.
- TCH-0115 — Course Plan review uses expandable Topic/Subtopic/Learning Unit detail and intentionally omits internal database identifiers.
- TCH-0116 — seven curriculum-profile fixtures cover mathematics, biology, chemistry, history, literature, computer science, and mixed-profile units.
- TCH-0117 — fixtures and contract tests verify different pedagogical structures without hard-coding subject personality stereotypes.
- TCH-0118 — mid-Semester/backend Subject change tests verify the persisted Course Plan remains historical until reviewed version adoption.
- TCH-0704 — deterministic Coverage reconciliation compares every current source item with Course Plan mappings.
- TCH-0705 — pre-activation Coverage fails closed for one unmapped required meaningful item; exclusions require an explicit validated classification reason.
- TCH-0706 — pre-activation Coverage Audit stores machine-readable result plus student-safe summary and state-version reference.
- TCH-0707 — end-of-Course audit accepts instructional completion only through TAUGHT or VALIDATED_PRIOR_KNOWLEDGE.
- TCH-0708 — unresolved required content blocks normal completion and routes to incomplete-required-content.v1; D08 does not itself complete the Course.
- TCH-0709 — Coverage remains separate from mastery/SKM truth; student reporting explicitly states that coverage is not a mastery claim.
- TCH-0710 — adopted authoritative scope additions create new source-inventory rows/version impact and force new Curriculum Audit/Course Plan reconciliation.
- TCH-0711 — student-facing coverage surfaces avoid raw ledger IDs and engineering terminology.
- TCH-0715 — validated prior knowledge may compress/skip redundant initial instruction while preserving cumulative academic responsibility; no raw source-presence eligibility mutation is performed.
- TCH-0716 — later controlled contradictory evidence inserts a new immutable NOT_VALIDATED VPK decision superseding the previous decision and marks the plan for review without rewriting history.
- TCH-0726 — hard Coverage Invariant tests prohibit silent source disappearance.
- TCH-0728 — hard Personalization Invariant tests prove planning accommodations cannot lower audited competence/required content.
- TCH-0729 — self-reported prior knowledge alone cannot create VPK, mastery, or Assessment Eligibility.
- TCH-0730 — self-reported weakness may affect planning attention only; D08 contains no SKM mutation path.
- TCH-0731 — activation gate fails when one required source item remains unmapped.
- TCH-0735 — validated VPK permits compressed instruction while retaining cumulative responsibility and does not invent ordinary instruction.
- TCH-0736 — Course Plan/source snapshot freshness tests prohibit silent inheritance of later Subject changes.

## Authority and invariant boundaries

The canonical flow is:

KIWI Subject snapshot → D07 source inventory → validated Curriculum Audit → Diagnostic/VPK where applicable → frozen TPF-03 provisional Course Plan → schema/domain/provenance/state validation → deterministic Coverage reconciliation → versioned Course Plan + Coverage Audit → downstream activation/completion consumer.

TPF-03 can only propose planned_only coverage. D08 deterministic reconciliation owns official mapping/accounting. D08 never equates Coverage with mastery, never mutates SKM or Gradebook, never turns raw Subject scope into Assessment Eligibility, never owns Course activation, and never selects an AI provider/model.

Student Intake remains an untrusted non-evidence planning lane. D08 derives required Learning Units, intended competence, exit conditions, source accounting, and academic criticality from the validated Curriculum Audit. Intake accommodation notes can affect delivery only.

## Persistence and security

D08 extends the D04 kernel with version-bound plan provenance, source-scope lineage, plan prerequisites, source-to-unit mappings, explicit exclusions, Coverage Audits, scope-change state, and immutable scope applications.

Authenticated browser access is owner-scoped read-only for D08 truth tables. Server mutation is reserved for service_role / teaching_domain_service. Immutable mapping/audit/application snapshots use the Teaching immutable-row trigger. Existing Course Plan rows gain an update guard: academic contents are immutable; only governed plan_state transitions are permitted.

## Runtime posture

Production wiring deliberately passes d08Intelligence: null until D30 qualifies Teaching model routes. Deterministic review, source/coverage reporting, readiness checks, and safe failure behavior can run; TPF-03 generation/impact calls return the accepted route-hold response until qualification.

D08 does not begin D09 scheduling/semester feasibility or D10 lifecycle activation.
