# KIWI Teaching D13 — Canonical Source Resolution

Delivery: **D13 — Student Knowledge Model**  
Scope: **TCH-0048, TCH-0049, TCH-0216–TCH-0237, TCH-0764 only**  
Starting implementation baseline: `8abad1a764b8764d2184631ada1ebac733839daf` (accepted D12 merge and live `main` at source-resolution time).

## Canonical routing and precedence used

D13 was resolved from the active successor baseline routed by `KIWI_Teaching_Implementation_Context_Pack_v1.9.md`. Context Pack v1.9 supersedes v1.7 for new delivery source routing while preserving accepted predecessor evidence. `KIWI_Teaching_Phase22_Final_Implementation_Freeze_v1.5.md` plus its manifest supply implementation authorization; the Change-Control Protocol governs overlaps rather than filename/version guessing.

Materially read canonical sources:

- `KIWI_Teaching_Implementation_Context_Pack_v1.9.md`;
- `KIWI_Teaching_Phase22_Final_Implementation_Freeze_v1.5.md` and `KIWI_Teaching_Phase22_Manifest_v1.5.json`;
- `KIWI_Teaching_Phase19_Delivery_Roadmap_Overlay_v1.6_REVISED.md`;
- `KIWI_Teaching_Delivery_Task_Map_v1.7.json`;
- `KIWI_Teaching_Master_Implementation_Backlog-9.7.md`;
- `KIWI_Teaching_System_Blueprint-11.7.md`, especially Part IX §§112–129 and Evidence Event §§491–493;
- `KIWI_Teaching_Capability_Registry_v1.3.md`;
- `KIWI_Teaching_Capability_Traceability_Matrix_v1.3.json`;
- `KIWI_Teaching_Intelligence_Inventory_Authority_Spec_Phases_4-6_v1.4_PPL.md`;
- `KIWI_Teaching_Orchestrator_Event_Runtime_Spec_Phases_7-8_v1.3.md`;
- `KIWI_Teaching_Critical_Invariant_Trace_Map_v1.3.md`;
- `KIWI_Teaching_Phase15_Final_Prompt_Manifest_v1.4.json`;
- `KIWI_Teaching_Phase15_All_20_Prompt_Families_FINAL_DESIGN_FROZEN_v1.4.md`, especially exact TPF-09 v1.2 and the TPF-19 Learning Analysis presentation boundary;
- `KIWI_Teaching_Progressive_Preparation_Lifecycle_Standard_v1.2.md` for confirmation that PPL is not an SKM owner;
- `KIWI_Teaching_Implementation_Change_Control_Protocol_v1.0.md`;
- accepted `KIWI_Teaching_D12_to_D13_Handoff-1.md`;
- accepted D06 policy implementation `teaching/policy/d06-decision-registry.json`, especially TCH-0074.

The canonical Assessment Variation / evidence-distance behavior material to D13 is already bound into TPF-09 v1.2 and Blueprint evidence-progression rules: evidence demand is multidimensional; near-clone quantity is not transfer; representation/context/integration changes support transfer only inside the same eligible construct/prerequisite envelope with appropriate cueing/assistance/exposure conditions.

## Exact delivery resolution

Roadmap/Task Map resolve D13 to exactly 25 tasks: `TCH-0048`, `TCH-0049`, `TCH-0216–TCH-0237`, `TCH-0764`.

Acceptance requires durable evidence-derived SKM inference that remains separate from Gradebook and Progression and remains replay/contradiction safe. D13 must not copy Gradebook percentages into SKM state or finalize Progression.

## Authority and prompt resolution

The registry resolves the D13 evidence/SKM capability family as follows:

- `teaching.evidence.evidence_event_interpretation` — HYBRID/T2/TPF-09;
- `teaching.evidence.evidence_quality_weighting_proposal` — HYBRID/T2/TPF-09; exact state math remains deterministic/configured;
- `teaching.evidence.knowledge_state_update` — DETERMINISTIC/T0/no prompt/SKM State Engine;
- `teaching.evidence.fragile_detection`, `regressed_detection`, `misconception_record_synthesis`, `confidence_calibration_interpretation`, `path_to_success_memory_extraction` — T2 proposals/interpretations under TPF-09;
- retention-check scheduling recommendation — T3 proposal only, never Scheduler authority;
- transfer and independence interpretation — T2 under TPF-09;
- pre-Class SKM synthesis — background/T2 bounded planning input;
- assessment-result learning interpretation and contradiction detection — T2, no Gradebook mutation;
- student-identity safeguard — deterministic/T0;
- `teaching.pedagogy.learning_analysis_translation` remains T1/TPF-19 presentation only.

TPF-09 is frozen at v1.2, C4, SHA-256 `311e35a3edb67267a357b787b79c496a1660f297fc33e62776c457146946bab6`. Its structured output may support/weaken/qualify state signals, but cannot commit durable state, invent numeric mastery probabilities/weights, modify Gradebook, certify VPK, change Assessment Eligibility, or decide Progression. D30 empirical route qualification remains open, so production D13 composes model intelligence as `null`/route-held.

## D06 algorithm gate

TCH-0074 was already deliberately closed in D06. D13 must implement policy version `skm-evidence-state-machine.v1`, algorithm `EVIDENCE_QUALITY_STATE_MACHINE_V1`:

- states: UNSEEN → INTRODUCED → ASSISTED → EMERGING → INDEPENDENT → SECURE → TRANSFERABLE;
- overlays: FRAGILE, BLOCKED, REGRESSED remain orthogonal;
- INTRODUCED requires authoritative instruction exposure;
- ASSISTED means successful performance only with material support;
- EMERGING requires at least one independent success with evidence still thin/inconsistent;
- INDEPENDENT requires at least two successful independent opportunities with no unresolved material contradiction;
- SECURE adds successful delayed independent retrieval;
- TRANSFERABLE adds legitimate varied/integrated independent application required by the construct;
- FRAGILE is uncertainty after prior competence;
- REGRESSED requires repeated substantive independent contrary evidence;
- BLOCKED is an authoritative instructional-planning condition after materially different remediation/prerequisite failure;
- time may reduce certainty, never knowledge by decree;
- Gradebook marks are not direct SKM state assignments;
- raw mastery probabilities/weights are not student-facing.

No new probabilistic mastery formula or decay constant was invented.

## Live implementation and infrastructure reconciliation

Before code modification:

- GitHub `main` was verified identical to accepted D12 merge `8abad1a764b8764d2184631ada1ebac733839daf`;
- production Supabase `Kiwi` was ACTIVE_HEALTHY with migration head `20260929163239 / teaching_d12_response_pedagogy`;
- non-production `KIWI Teaching Integration` was ACTIVE_HEALTHY and also ended at D12;
- the canonical D04 `teaching_evidence_events` / `teaching_evidence_event_learning_units` tables already existed and were immutable/RLS-protected, so D13 must extend them rather than create another evidence-event truth;
- no D13 SKM tables existed;
- D12's `candidate_misconception` remained an upstream candidate, not durable misconception truth;
- D11's planner seam explicitly returned `knowledgeModelSignals.status = OWNER_PENDING_D13` and already passed that bundle into TPF-05;
- Vercel production was READY on SHA `8abad1a764b8764d2184631ada1ebac733839daf`;
- Render KIWI service was LIVE on the same SHA;
- all Teaching model routes remained D30-held.

## Resolved overlap and change-control result

The apparent D12 `TCH-0197` wording overlap with D13 persistent misconception ownership was already reconciled in the accepted D12 source-resolution record: D12 owns current-response candidate/recurrence interpretation; D13 owns durable misconception synthesis/update/resolution after recurrence, provenance and deterministic evidence rules. This matches the Registry/Traceability/Authority sources and requires no architecture exception.

No genuine frozen-design contradiction requiring an architecture exception was found for D13.
