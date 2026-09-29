# KIWI Teaching D13 — Student Knowledge Model

D13 implements exactly `TCH-0048`, `TCH-0049`, `TCH-0216–TCH-0237`, and `TCH-0764`.

The Student Knowledge Model is the durable owner of learning inference, not Gradebook truth and not Progression truth. The canonical D04 Evidence Event layer remains the evidence source of record. D13 adds deterministic, versioned inference over those events; TPF-09 model output never commits SKM state directly.

## Task accounting

- **TCH-0048:** persistent misconceptions are append-only versioned D13 records. D12 candidates are evidence inputs only. Recurrence requires repeated supported evidence; resolution requires later independent corrected evidence and, for full v1 resolution, delayed confirmation or repeated delayed verification.
- **TCH-0049:** the canonical per-student × Learning Unit SKM is an append-only state-version history. The latest version is the read model; there is no parallel mutable mastery percentage.
- **TCH-0216:** state versions retain conceptual understanding, procedural ability, independence, retention, transfer, fluency, and confidence-calibration dimensions with explicit not-assessed states.
- **TCH-0217:** the only base states are `UNSEEN`, `INTRODUCED`, `ASSISTED`, `EMERGING`, `INDEPENDENT`, `SECURE`, and `TRANSFERABLE`.
- **TCH-0218:** `FRAGILE`, `BLOCKED`, and `REGRESSED` are separate overlays and do not overwrite base-state history.
- **TCH-0219:** D13 extends the D04 Evidence Event with task/claim, multidimensional demand, lineage, assistance/exposure, tools/accessibility, control/purpose, confidence sample, misconception/prerequisite/path context, validity, qualitative strength, information gain, comparability, and redundancy.
- **TCH-0220:** qualitative evidence classes plus redundancy handling prevent weak repetition from manufacturing stronger state merely by count.
- **TCH-0221:** delayed independent success is retention evidence and is required for `SECURE`.
- **TCH-0222:** transfer requires an eligible same construct, valid prerequisite boundary, no method cue, independent performance, no contaminating answer/method exposure, and legitimate varied/integrated demand. Cosmetic novelty alone does not count.
- **TCH-0223:** time can lower effective certainty after the demonstrated retention horizon; time never mutates the durable base state by itself.
- **TCH-0224:** sufficiently strong failed delayed retrieval after established competence can produce `FRAGILE`.
- **TCH-0225:** repeated substantive later independent contrary evidence can produce `REGRESSED`.
- **TCH-0226:** confidence is optional/selectively sampled. Missing confidence is missing evidence, not low confidence.
- **TCH-0227:** high-confidence wrong responses strengthen confidence-calibration/misconception investigation signals without becoming an ability label.
- **TCH-0228:** low-confidence correct responses are calibration/fragility context; D13 does not infer guessing, intent, emotion, or motivation.
- **TCH-0229:** path-to-success memory stores evidence-linked helpful strategies/representations, recurring errors, assistance dependence, and prerequisite weakness as context-specific instructional memory, never a permanent learning-style/personality profile.
- **TCH-0230:** D11 Planning receives a bounded versioned SKM read model. Every current SKM state becomes a `SKM_STATE` preparation dependency so stale pre-Class preparation can be superseded by the existing D11 PPL materiality mechanism.
- **TCH-0231:** future owner-validated assessment evidence can enter through the same normalized Evidence Event seam. D13 does not implement D17 assessment generation/administration/marking and does not copy a raw mark into knowledge state.
- **TCH-0232:** D13 contains no Gradebook mutation path and rejects Gradebook as a direct SKM state assigner.
- **TCH-0233:** historical marks cannot freeze or dictate SKM state; D13 recomputes from its own current validated evidence history.
- **TCH-0234:** student Learning Analysis emits simplified labels: strong, improving, fragile, needs reinforcement, or needs verification.
- **TCH-0235:** the Learning Analysis API omits raw model probabilities, raw evidence weights, and hidden reasoning. Internal D13 inference columns are not directly readable by the authenticated browser role.
- **TCH-0236:** longitudinal tests cover early failure/improvement, delayed fragility, regression, assistance/exposure, transfer, misconception persistence/resolution, contradictory evidence, weak-evidence flooding, invalid/system-failure protection, replay, and out-of-order evidence.
- **TCH-0237:** every durable state/application/misconception record carries `skm-evidence-state-machine.v1`.
- **TCH-0764:** TPF-09 remains interpretive. Schema/authority guards reject direct durable SKM, Gradebook, or Progression mutation; only deterministic D13 state code commits state.

## Deterministic state rules

The first-release algorithm is `EVIDENCE_QUALITY_STATE_MACHINE_V1`.

A Learning Unit begins `UNSEEN`. Meaningful exposure without successful evidence yields `INTRODUCED`. Successful performance requiring material support yields `ASSISTED`. One credible independent success yields `EMERGING`. At least two distinct credible independent successes establish `INDEPENDENT`. Delayed independent success after independent evidence supports `SECURE`. Legitimate uncued varied/integrated independent success supports `TRANSFERABLE`.

The engine recomputes from the complete immutable normalized evidence history ordered by authoritative occurrence time. Arrival order therefore cannot become academic truth. State application locks the Learning Unit and validates the snapshot digest/current state version before append, retrying once on a stale snapshot.

Weak or highly repetitive evidence does not count as repeated independent proof. Strong contrary later evidence adds `FRAGILE` or, when repeated and substantive, `REGRESSED` without deleting the historical base-state record. `BLOCKED` is an orthogonal planning condition: only a trusted Teaching Controller/Lesson Planner condition fact may set or clear it. D12 prerequisite evidence and a D12 `blocked_proposal` can motivate planning investigation but cannot directly commit the durable overlay.

## Misconception, confidence, and path memory

Misconception records have stable evidence-derived identity and immutable versions. A candidate becomes recurring only through repeated supported evidence. Later independent evidence explicitly showing the misconception is no longer supported may produce resolution support. Full v1 resolution requires an independent correction plus delayed verification, or repeated delayed verification.

Confidence is never a grade input. High-confidence wrong and low-confidence correct are calibration patterns only. Missing confidence is never interpreted negatively.

Path-to-success memory is evidence-linked and context-specific. It records helpful strategies/representations, recurring errors, assistance dependence, and prerequisite weakness without creating identity or personality claims.

## Persistence and security

D13 extends `public.teaching_evidence_events` and retains `public.teaching_evidence_event_learning_units` as the canonical Evidence Event owner. It adds exactly these D13 owner histories:

- `public.teaching_student_knowledge_state_versions`;
- `public.teaching_skm_evidence_applications`;
- `public.teaching_persistent_misconception_versions`.

All three D13 tables are RLS-enabled, service-owned, append-only, and immutable after insertion. No direct anonymous/authenticated authoritative DML exists. Because D13 adds internal inference metadata to the pre-existing Evidence Event table, authenticated direct SELECT is narrowed to its legacy student-safe columns; normal student Learning Analysis is served through the application API.

## Runtime and route qualification

D13 subscribes after D12 to the existing durable `teaching.student.response_submitted` event. D12 therefore performs its idempotent current-response evaluation first; D13 consumes only a validated evaluation. If the D12 route is held or no validated evaluation exists, D13 returns an explicit no-op and manufactures no knowledge state.

Optional TPF-09 analysis is wired only through the central Teaching Orchestrator and remains production route-held until D30. All TPF-09 requests set `commit:false`; validators require official-record mutation flags to remain false. No provider/model is selected inside D13.

The public D13 surface is read-only Learning Analysis. Owner-validated evidence ingestion remains an internal server seam for future authoritative domains.
