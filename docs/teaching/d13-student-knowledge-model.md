# KIWI Teaching D13 — Student Knowledge Model

D13 implements exactly `TCH-0048`, `TCH-0049`, `TCH-0216–TCH-0237`, and `TCH-0764`.

The Student Knowledge Model is the durable owner of **learning inference**, not Gradebook truth and not Progression truth. The canonical D04 Evidence Event layer remains the source evidence record. D13 adds deterministic, versioned inference over those events and an explicitly bounded TPF-09 interpretation seam; model output never commits SKM state directly.

## Persistence lane

- **TCH-0048:** `teaching_persistent_misconceptions` holds current durable recurring misconception hypotheses; immutable `teaching_persistent_misconception_history` preserves version/provenance/repair/resolution history. A single D12 candidate does not create durable misconception truth. Resolution requires valid independent correction evidence; delayed or repeated independent correction can close the record.
- **TCH-0049:** `teaching_student_knowledge_states` is the current one-row-per-student×Learning-Unit owner projection. `teaching_student_knowledge_history` is immutable state history; `teaching_skm_evidence_applications` makes each Evidence Event application replay-safe and algorithm-versioned.

## Knowledge-state lane

- **TCH-0216:** the current/history records carry separate conceptual understanding, procedural ability, independence, retention, transfer, fluency, and confidence-calibration dimension statuses. Inapplicable/insufficient evidence remains explicit.
- **TCH-0217:** only `UNSEEN`, `INTRODUCED`, `ASSISTED`, `EMERGING`, `INDEPENDENT`, `SECURE`, `TRANSFERABLE` are durable base states. The implementation pins D06 policy `skm-evidence-state-machine.v1`.
- **TCH-0218:** `FRAGILE`, `BLOCKED`, and `REGRESSED` are orthogonal overlays; contradiction never erases historical competence by rewriting old evidence.
- **TCH-0223:** certainty can project to `REVIEW_DUE` only from an authoritative/versioned retention-review due timestamp. Elapsed time does not decrement the base knowledge state and D13 invents no universal decay constant.
- **TCH-0224:** a meaningful delayed independent failure after prior independent competence can create FRAGILE.
- **TCH-0225:** REGRESSED needs repeated substantive later independent contrary evidence; one miss or one transfer failure is insufficient.

## Evidence lane

- **TCH-0219:** D13 extends the existing immutable `teaching_evidence_events` rows with task/construct, lineage/familiarity, demand vector, assistance, answer/method exposure, allowed tools/accessibility support, control/purpose, confidence sampling, comparability/redundancy, misconception/path signals, validity/system-failure protection and schema version. Existing generic `difficulty_context`/`novelty_context` remain compatibility fields but are not the D13 inference contract.
- **TCH-0220:** deterministic categorical evidence quality (`STRONG`, `MODERATE`, `WEAK`, `UNUSABLE`) plus redundancy keys prevent repeated near-clones from manufacturing stronger state merely by count. No hidden numeric mastery weight exists.
- **TCH-0221:** successful delayed independent retrieval is the retention evidence required for SECURE.
- **TCH-0222:** transfer needs the same eligible construct, valid prerequisite boundary, no method cue, legitimate variation/integration, independent performance and no contaminating exposure. Cosmetic unfamiliarity is insufficient.
- **TCH-0231:** future validated assessment evidence enters through the same trusted owner-side normalized Evidence Event contract; the state machine still requires multiple appropriately distinct evidence opportunities for stronger states. D17 Assessment implementation is not pulled forward.

## Confidence, misconception and instructional-memory lane

- **TCH-0226:** student confidence is stored only when explicitly sampled; absent confidence remains absent evidence.
- **TCH-0227:** high-confidence wrong becomes a stronger misconception/calibration signal only inside the evidence rules; it does not affect official marks or become an ability label.
- **TCH-0228:** low-confidence correct is retained as calibration/possible-fragility context, not interpreted as guessing.
- **TCH-0229:** Path-to-Success memory stores provenance-linked representations that helped, recurring errors, hint dependence and prerequisite weaknesses; it explicitly forbids personality/identity inference.

## Planner / owner boundaries

- **TCH-0230:** D11's existing `knowledgeModelSignals` seam is upgraded from `OWNER_PENDING_D13` to a bounded versioned D13 read model. D11 remains Lesson Planner/Controller owner; D13 supplies current knowledge context only.
- **TCH-0232:** D13 repository/service code has no Gradebook INSERT/UPDATE path; database grants are restricted to D13 owner tables and existing Evidence Events. The SKM cannot write official grades.
- **TCH-0233:** historical grades may later arrive as evidence/context, but cannot veto stronger current validated learning evidence. D13 never copies a percentage into a knowledge state.

## Student-facing Learning Analysis

- **TCH-0234:** `/learning-analysis` and `/learning-units/:id/learning-analysis` expose a derived projection such as `strong`, `improving`, `fragile`, `needs reinforcement`, `needs verification`, or `not enough evidence`. It is not a second mutable truth.
- **TCH-0235:** the public projection explicitly omits raw model probabilities, hidden evidence weights, hidden reasoning, official grades and Progression outcomes. D13 owner tables are server-only; normal browser roles receive no direct DML or table read grant.

## Model/runtime authority

TPF-09 v1.2 is wired only through the Teaching Orchestrator. Production intentionally injects no D13 intelligence until D30 empirical qualification. A qualified future TPF-09 call may produce a version-bound T2 interpretation artifact in `teaching_skm_interpretations`; `durable_state_committed` is database-enforced `false`. The deterministic state engine re-reads current SKM state before owner commit. No DB transaction spans model execution.

- **TCH-0236:** longitudinal unit/integration fixtures cover early failure→improvement, immediate success→later fragility, hint-dependent success, transfer boundaries, persistent misconception, contradiction, replay/out-of-order application and system-failure fairness.
- **TCH-0237:** every durable state/history/application/misconception record carries `algorithm_version = skm-evidence-state-machine.v1`, enabling future audited recalibration/replay rather than rewriting history as if a new algorithm had always been used.
- **TCH-0764:** validators, DB checks and negative tests prove T2 output cannot directly set SKM state, create numeric mastery, mutate Gradebook or bypass the deterministic state engine.
