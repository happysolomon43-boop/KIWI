# KIWI Teaching D12 — Response Evaluation, Hinting & Pedagogy

D12 implements exactly `TCH-0192–TCH-0215` on top of the accepted D11 Controller. D11 remains the live-Class owner; D13 remains the durable SKM/mastery/misconception owner. Model-backed D12 capabilities are wired only through the Teaching Orchestrator and remain production route-held until D30 qualification.

## Response Evaluator lane

- **TCH-0192:** `teaching/d12/contracts.js` validates the TPF-06 v1.3 structured current-response contract; `teaching/d12/intelligence.js` binds `teaching.lesson.response_correctness_quality_evaluation`; `service.js` persists only validated/current-state Response Evaluator artifacts.
- **TCH-0193:** free-text prose cannot directly mutate academic state. Schema, enum, authority-key, trusted-prerequisite, recurrence, penalty-protection and current Controller version checks precede persistence.
- **TCH-0194:** correct-but-insufficient evidence deterministically selects a bounded probe/justification action rather than treating the final answer as sufficient evidence.
- **TCH-0195:** partial responses route to decomposition/probe behavior so supported and missing components remain distinct.
- **TCH-0196:** procedural slips route to a self-correction probe rather than default full reteaching.
- **TCH-0197:** misconception output is candidate/recurrence evidence with explicit D13 owner handoff; no persistent misconception or mastery truth is committed in D12.
- **TCH-0198:** validated misconception candidates may invoke TPF-07 conceptual-conflict repair (counterexample/comparison/prediction/contradiction family) when a qualified route exists; deterministic policy preserves the bounded action when route-held.
- **TCH-0199:** trusted prerequisite candidates route to surgical micro-remediation; prerequisite refs not present in D08 dependency truth are rejected.
- **TCH-0200:** after a trusted blocker and a materially failed prerequisite-repair path, D12 can emit a BLOCKED/replan proposal. `blocked_proposal` never commits the durable state; Controller/SKM owners decide.

## Assistance / evidence / correction lane

- **TCH-0201:** the full assistance ladder is explicit (`none → attention → directional → conceptual → partial_step → strong_scaffold → worked_example → full_instruction`). D11 learning/evidence descriptors and instructional substate provide the deterministic ceiling; repeated help-request count cannot raise it. Accessibility/permitted tools remain separate fields.
- **TCH-0202:** assistance deterministically maps to `FULL`, `LIMITED`, `ASSISTED`, or `CONTAMINATED` evidence strength independently of evaluator prose.
- **TCH-0203:** worked-example/full-instruction or explicit answer/method exposure contaminates the current item for independent-evidence purposes.
- **TCH-0204:** contaminated items require fresh-equivalent verification; the registered TPF-04 fresh-verification capability is wired through the Teaching Orchestrator when qualified.
- **TCH-0205:** productive-struggle decisions use only observable pending-response time, attempt count, meaningful progress, repeated observable error and remaining-time context. No emotion/motivation/guessing inference is used.
- **TCH-0206:** a supplied materially failed strategy class cannot be returned unchanged unless the replacement materially differs; otherwise D12 changes representation/prerequisite route or recommends replan.
- **TCH-0207:** TPF-08 teacher self-correction is wired as a bounded T2 Content Integrity analysis with explicit correction state.
- **TCH-0208:** confirmed teacher errors can create an immutable `PENDING_OWNER` evidence recheck/invalidation handoff. D12 does not rewrite SKM/Gradebook/evidence-owner truth.

## Pedagogy profile lane

- **TCH-0209:** TPF-07 Pedagogical Profile classification supports factual, conceptual, procedural, analytical, interpretive, applied, communicative, experimental/practical and mixed profiles.
- **TCH-0210:** profiles carry primary student-action metadata including recall, explain, calculate, derive, compare, interpret, argue, create, debug, predict, classify, analyze evidence and related bounded actions.
- **TCH-0211:** profiles carry acceptable-answer-space metadata: single objective, multiple valid approaches, open interpretation, and bounded/mixed extensions needed by heterogeneous Learning Units.
- **TCH-0212:** profiles carry representation metadata including text, equation, diagram, graph, timeline, source, code, data, image, simulation and physical-performance/modality boundaries.
- **TCH-0213:** subject templates are explicitly non-authoritative defaults. A validated Learning Unit Pedagogical Profile overrides them without changing Course Plan authority.

## QA lane

- **TCH-0214:** unit fixtures cover mathematics, sciences, humanities, languages, computer science, geography, economics/business, government/civics, accounting and visual/practical limitations.
- **TCH-0215:** Literature/History fixtures preserve open/defensible interpretation; programming fixtures retain debug/trace process evidence; mathematics fixtures retain derivation/multiple-method process evidence.

## Persistence and state contracts

`migrations/20260929_teaching_d12_response_pedagogy.sql` adds response lineage (`learning_unit_id`, `controller_version`, idempotency) to the existing immutable student-response table and creates immutable, server-owned D12 tables for response evaluations, pedagogy decisions, Learning Unit pedagogy profiles, teacher corrections, and evidence-recheck handoffs. D12 tables have RLS enabled and grant no direct anon/authenticated access. Pedagogy decisions have a database check that `durable_state_committed=false`, and profiles have a check that `subject_template_authoritative=false`.

## Route qualification

The D12 module accepts an injected `d12Intelligence` implementation built over the D05 Teaching Orchestrator. Production composition intentionally supplies `null` until D30 qualifies the relevant model routes. Response capture may still persist, but the evaluation is explicitly `ROUTE_HELD`; no fake interpretation is manufactured. Deterministic assistance ceilings, authority guards, contamination rules and subject-template defaults do not depend on model availability.
