# KIWI Teaching — D06 Canonical Source Resolution v1.0

**Delivery:** D06 — Academic/Product Decision Gate Closure  
**Date:** 2026-09-27  
**Status:** RESOLVED_FOR_IMPLEMENTATION  
**Starting live main:** `cb7d567ab413b67c6c51502bbeef1dc28d02cc72`

## Resolution result

D06 is authorized because D05 is accepted and the current live `main` is a strict descendant of the minimum D05 baseline. D06 owns exactly 27 GATE tasks: TCH-0071–TCH-0093 and TCH-0691–TCH-0694. It is a versioned policy/decision-closure delivery, not a runtime implementation of the later Gradebook, SKM, Scheduler, Attendance, Assessment, Course lifecycle, response renderers, cross-system integrations or visual system.

No D06 gate requires a new database truth store. The canonical outcome is stored as version-controlled policy/configuration consumed later by the existing authoritative domain owners.

## Canonical sources materially resolved

The resolution pass used:

- Implementation Context Pack v1.7 as the routing/index source;
- Final Pre-Implementation Freeze v1.3 and Phase-22 manifest;
- System Blueprint v11.5;
- Master Implementation Backlog v9.5;
- Delivery Roadmap v1.4 and Delivery Task Map v1.5;
- Capability Registry v1.1 and Capability Traceability Matrix v1.1;
- Critical Invariant Trace Map v1.1;
- Orchestrator/Event Runtime Spec v1.1;
- Progressive Preparation Lifecycle Standard v1.0;
- accepted v1.3 frozen prompt-family runtime baseline where D06 policy touches a model-backed family;
- Implementation Change-Control Protocol v1.0;
- accepted D05 → D06 handoff;
- D05 authority-source resolution record.

The exact Phase-22 v1.1 Authority Spec body is still not the operative retained implementation source. D06 inherits the accepted D05 source-resolution decision using the owner-authorized `v1.2_PPL` source for operative authority details without globally rewriting the historical Phase-22 manifest.

## Governing invariants

D06 decisions preserve, at minimum:

- `INV-TRUTH-01` — Gradebook, SKM and Progression remain distinct truths;
- `INV-EVENT-01` — academic time/state remains server-authoritative and event-driven;
- `INV-FAIL-01` — KIWI failure cannot directly become student penalty;
- `INV-INTAKE-01` — Student Intake is planning context, not mastery evidence;
- `INV-COVERAGE-01` — meaningful required content cannot silently disappear;
- `INV-ELIG-01` — graded eligibility derives from Taught/Validated scope rather than raw Subject scope;
- `INV-ASSESS-LOCK-01` — formal packages are validated/locked before attempt;
- `INV-VALIDATE-01` — generated assessment content is independently validated at required risk;
- `INV-MARK-01` — formal marking is criterion based and Gradebook mutation remains deterministic/owner controlled;
- `INV-CONTEXT-01` — irrelevant attendance/personality/GPA/history cannot alter rubric marks;
- PPL forecast, protected-content and package-lock invariants.

## Live repository reconciliation

Current `main` includes post-D05 accepted hardening and D03 prompt-body runtime closure work. D06 must preserve those changes and does not reset to the historical D05 handoff SHA.

Relevant existing implementation facts:

- Teaching already has isolated module, service, repository, event/runtime and orchestration boundaries.
- The shared KIWI Exam integration points to existing CBT technology but does not own Teaching assessment policy.
- D05 preserves central KIWI AI Orchestrator ownership of provider/model selection.
- D03 keeps all Teaching AI routes UNQUALIFIED pending D30.
- D04/D05 protected preparation and runtime persistence are already authoritative server boundaries.

## Supabase reconciliation

Production Supabase project `nqdwifqskxkblgdgeutn` is ACTIVE_HEALTHY.

Migration head at D06 start remains:

`20260926180811_teaching_d05_orchestration_service_rls`

D06 adds no migration and no database policy table.

The pre-existing security-advisor debt remains outside D06 scope: `background_jobs`, `biome_zones`, `biome_zone_descriptions`, `onboarding_state` and `notifications` have RLS disabled. D06 does not blindly modify them because their owning access contracts are outside this delivery.

## Deployment reconciliation

Vercel project `kiwi` is connected to the current GitHub repository. Pre-D06 production state is READY on `cb7d567ab413b67c6c51502bbeef1dc28d02cc72`.

Render is not mutated by D06. The connected Render tool requires explicit workspace selection before inspection; no workspace is selected in this chat. Because D06 adds no backend runtime execution path or database migration, this does not change the D06 policy decisions. Final handoff must classify Render as NOT RE-VERIFIED unless a workspace is explicitly selected before acceptance.

## Change-control conclusion

No canonical contradiction requiring Class B–E change control was found. D06 is the planned closure point for these deliberately open decisions. The implementation therefore proceeds as a normal bounded realization of D06, preserving all frozen ownership, state, prompt, qualification and release boundaries.
