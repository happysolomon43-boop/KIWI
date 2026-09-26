# KIWI Teaching Decision and Exception Log

This file is append-only. Entries may be superseded only by a later explicit entry that references the prior decision and the canonical change-control class used.

## DEC-D00-001 — Freeze implementation baseline

Date: 2026-09-25  
Status: ACCEPTED FOR IMPLEMENTATION GOVERNANCE  
TCH: TCH-0001, TCH-0744

Adopt Blueprint v11.5, Backlog v9.5, Final Freeze v1.3, Delivery Roadmap v1.4 and Delivery Task Map v1.5 as the D00 implementation baseline. TCH IDs are permanent identities; delivery order follows explicit dependency metadata, not numeric order. Silent interpretation changes are prohibited.

Migration impact: none.

## DEC-D00-002 — Canonical authority and capability baseline

Date: 2026-09-25  
Status: ACCEPTED  
TCH: TCH-0749, TCH-0750, TCH-0751

Adopt the five responsibility classes DETERMINISTIC, DIRECT-AI, HYBRID, EVENT-AI-HOOK and BACKGROUND as responsibility classes rather than model-call topology. Adopt T0–T4 as authority ceilings. Canonical runtime/design identity comes from Capability Registry IDs, not INV aliases.

Current baseline is 169 capabilities: 147 model-eligible plus 22 T0/no-direct-prompt, with 19 prompt families.

Migration impact: none.

## DEC-D00-003 — PPL adoption

Date: 2026-09-25  
Status: ACCEPTED  
TCH: TCH-0871

Adopt PPL as an event-driven, versioned, bounded preparation lifecycle over existing capabilities. It is not a twentieth prompt family, continuous autonomous agent, hidden chain-of-thought store, academic owner, second Scheduler, or route around eligibility/fairness/deadline rules.

Four new PPL T0 capabilities are pinned in `canonical-baseline.json`. Route postures contain no provider/model identity. All Teaching AI/PPL routes remain UNQUALIFIED until D30.

Migration impact: none.

## DEC-D00-004 — Separate Teaching application surface

Date: 2026-09-25  
Status: IMPLEMENTATION REALIZATION RECORDED; D01 OWNER  
TCH impact: future TCH-0016 through TCH-0034

Teaching will switch from KIWI into a separate application surface. This is permitted only as a deployment/UI boundary: the separate app must consume the same canonical Subject/integration contracts and authoritative Teaching domain services. It may not fork Gradebook, SKM, Progression, Attendance, Course scope, Assessment Attempt, Request, Teacher Identity, Scheduler or other academic truth.

The existing in-monolith Teaching prototype remains non-canonical and is not expanded by D00. D01 must decide the exact repository/module/deployment seam and retire or reduce the prototype safely.

Change-control classification: Class A local realization unless implementation would change academic ownership, public academic behavior, schema truth or canonical contracts; such a change escalates to the applicable higher class.

Migration impact: none in D00.

## DEC-D00-005 — Stale local authority-spec artifact rejected

Date: 2026-09-25  
Status: RECORDED SOURCE-INTEGRITY EXCEPTION

A retained local file bearing the Authority Spec name does not match the v1.1 frozen hash. It is not used as current authority. Hash-valid Registry/Traceability/Blueprint/Freeze/PPL sources govern current D00 rules.

This entry does not amend the design. Any delivery needing details unique to the exact Authority Spec body must resolve the canonical v1.1 artifact before implementation.

Migration impact: none.

## DEC-D01-006 — Remove generic Teaching feature-availability toggles

Date: 2026-09-25  
Status: ACCEPTED PRODUCT AMENDMENT  
Change class: Class E  
TCH: TCH-0029, TCH-0675

Teaching is a normal authenticated KIWI application surface. Present and future Teaching capabilities are not controlled by generic runtime feature on/off flags or development-user allowlists.

A capability that is not yet implemented/accepted remains absent until its owning delivery. Once implemented and valid under its governing academic/runtime contracts, it is available normally.

This decision does not weaken authentication, authoritative academic gates, server privilege boundaries, D30 AI qualification, D31 release readiness, or any other safety/quality prerequisite. Those are contract/qualification gates rather than product feature toggles.

Paired versioned amendments:
- `KIWI_Teaching_Master_Implementation_Backlog_Amendment-9.6.md`
- `KIWI_Teaching_Delivery_Task_Map_Amendment_v1.6.json`
- `KIWI_Teaching_Feature_Availability_Amendment_v1.0.md`

Migration impact: none.



## DEC-D03-007 — Close frozen prompt-body runtime integration gap

Date: 2026-09-26  
Status: IMPLEMENTATION DEFECT CORRECTION  
TCH impact: D03 prompt-runtime acceptance; no TCH reassignment

The D03 runtime already hash-locked Prompt Manifest/Pack v1.3, capability-to-family mappings, the Teaching Constitution, structural contracts and route-control posture, but did not package/load the actual frozen prompt-family prose into the model request. That gap is corrected by a hash-locked 19-family runtime prompt-body bundle and deterministic prompt composer.

The correction preserves the exact manifest/family hashes, changes no frozen prompt prose, changes no authority owner, keeps all 22 T0 capabilities promptless, keeps every Teaching AI route UNQUALIFIED, and does not replace D30 empirical qualification.

Versioned implementation record:
- `docs/teaching/change-control/KIWI_Teaching_D03_Prompt_Body_Runtime_Closure_v1.0.md`

Migration impact: none.


## COR-D03-001 — Complete exact frozen prompt-body runtime import

Date: 2026-09-26  
Status: CLASS A IMPLEMENTATION DEFECT CORRECTED  
Change class: Class A — implementation defect/local realization  
Affected accepted delivery: D03, with D05 execution-adapter integration hardening  
TCH impact: TCH-0795, TCH-0796, TCH-0798, TCH-0799, TCH-0802, TCH-0804, TCH-0807, TCH-0808, TCH-0812, TCH-0816; no task reassignment

Post-D05 verification found that the accepted D03 runtime had correctly registered the user-authorized Prompt Manifest/Pack v1.3 family identities, versions, source filenames and SHA-256 values, but had not made the exact frozen prompt-family prose runtime-resolvable. The D05 adapter consequently supplied Teaching invocation metadata to the central KIWI AI boundary without a composed `request.content` payload.

The correction imports the exact 19 manifest-frozen prompt bodies without rewriting them, stores them in a hash-locked runtime bundle, revalidates the compressed bundle, decompressed payload and every individual family SHA-256, exposes body resolution through the D03 prompt control plane, composes the unmodified family body with the structural Teaching contract and bounded academic-input data, and sends that content through the existing D05 adapter to KIWI's central AI Orchestrator.

This correction does not change a frozen TPF prompt, family boundary, capability authority ceiling, authoritative owner, output contract, route qualification, provider/model routing, PPL semantics, task scope, delivery assignment, or academic state/schema. All 22 T0 capabilities remain promptless. All Teaching AI/PPL routes remain UNQUALIFIED pending D30 and production release remains held to D31.

Source identities retained:
- Prompt Manifest v1.3 SHA-256: `4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce`
- Combined Prompt Pack v1.3 SHA-256: `173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae`
- Runtime compressed body-bundle SHA-256: `cda3c9959aade4ee187827708096cb89942d10b209bcefdfeae36b37115ba4ff`
- Runtime decompressed body-payload SHA-256: `ee68f82a48efb038134371cb33aa34e60986a177661be401d2386c54596d2fd1`

Migration impact: none.
