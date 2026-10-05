# KIWI Teaching — D31 Owner AI Release Authorization Amendment v1.0

**Decision date:** 2026-10-05  
**Decision authority:** Product Owner  
**Delivery:** D31 — Final Release Readiness & Production Gate  
**Change-control disposition:** `D31_OWNER_RELEASE_AUTHORIZATION_EXCEPTION`  
**Runtime authorization state:** `OWNER_OVERRIDE_ENABLED` when the exact server-side release mode is active  
**D30 qualification state changed by this amendment:** NO

## 1. Owner decision

The Product Owner explicitly authorizes D31 to enable every existing production-mounted KIWI Teaching AI route/feature that is already implemented behind the Teaching central AI execution boundary, including the mounted intelligence seams for D07, D08, D09, D11, D12, D13, D16 and D17.

This is a deliberate D31 release-authorization exception to the default D31 rule that only empirically evidence-qualified Teaching AI routes may be enabled. It is not an empirical qualification decision.

## 2. Truthfulness requirement

This amendment does **not** convert missing D30 evidence into qualification evidence. Any route whose D30 evidence state is `INSUFFICIENT_EVIDENCE` remains `INSUFFICIENT_EVIDENCE` until the D30 qualification contract is actually satisfied. The release record, in-product limitations and future handoffs must distinguish:

1. D30 implementation completion;
2. empirical route qualification state; and
3. D31 production release authorization under this owner exception.

No route may be labeled `QUALIFIED`, `PASS`, empirically validated, or production-qualified merely because this amendment authorizes its runtime activation.

## 3. Non-negotiable protections retained

The override does not authorize any of the following:

- direct provider/model calls outside the central KIWI AI Orchestrator;
- bypass of D28 execution controls, validation, telemetry, retention or cost controls;
- bypass of schema/domain/provenance/current-state validation;
- AI output directly becoming authoritative academic state;
- bypass of Gradebook, SKM, Progression, Scheduler/Calendar, Assessment, Request, Attendance, Course Plan, Teacher Identity or other frozen owner boundaries;
- bypass of RLS, service-role boundaries, authentication or protected-content isolation;
- expansion of Assessment Eligibility or exposure of protected active-assessment answers;
- provider secrets or privileged credentials being exposed to browser code;
- mutation of frozen prompt text or provider routing inside prompt prose;
- hidden chain-of-thought storage, logging, export or exposure;
- representation of AI review as human academic review;
- removal of KIWI-failure fairness, replay/idempotency or stale-state protections.

## 4. Runtime activation contract

Activation is server-side only and requires the exact release configuration:

`TEACHING_D31_AI_RELEASE_MODE=OWNER_OVERRIDE_V1`

The browser cannot activate the override. Any missing, empty or different value fails closed and leaves all affected Teaching AI intelligence adapters unmounted.

When active, the release composition must instantiate the existing D07, D08, D09, D11, D12, D13, D16 and D17 intelligence adapters against `teachingRuntimePlatform.aiBoundary`. That boundary remains responsible for routing through KIWI's central orchestrator and D28 execution controls.

## 5. Scope boundary

This amendment enables existing **production-mounted** Teaching AI seams. It does not authorize D31 to invent new route surfaces, new academic owners or new provider infrastructure. Intelligence modules that exist in source but are not part of the current production-mounted Teaching router must be reconciled through D31 traceability before any separate route-surface change is made.

## 6. Rollback / disable path

Rollback is immediate and does not require an academic-record migration: remove `TEACHING_D31_AI_RELEASE_MODE` from the server environment, or set it to any value other than `OWNER_OVERRIDE_V1`, then restart/redeploy the service. The D31 release composition must then return the affected Teaching AI adapters to their held/null state while deterministic owner-domain functionality remains available where designed.

A code revert of the D31 release-wiring commit is the secondary rollback path.

## 7. D31 release-record requirement

The terminal D31 release record must explicitly state, for every released AI route/feature:

- its actual D30 qualification/evidence state;
- that runtime activation is owner-authorized under this amendment where empirical qualification is absent;
- the central-orchestrator/D28 boundary used;
- any academically meaningful limitation that users must be told about;
- the exact rollback/disable path.

This amendment changes release authorization only. It does not create a second academic truth source and does not erase the evidence requirements of the D30 qualification system.
