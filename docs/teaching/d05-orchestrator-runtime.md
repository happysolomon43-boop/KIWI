# Teaching D05 — Orchestrator & Durable Event Runtime Integration

D05 connects the accepted D02 durable runtime, D03 capability/prompt control plane, and D04 kernel/PPL persistence. It does not replace any of them and does not implement D06+ academic policy/domain behavior.

## Scope

D05 accounts for exactly these 30 permanent tasks:

- TCH-0759
- TCH-0767–TCH-0776
- TCH-0778–TCH-0786
- TCH-0791
- TCH-0798
- TCH-0817
- TCH-0879–TCH-0885

No D06 task is implemented here.

## Operative authority source for D05

D05 uses the project-owner-authorized `KIWI_Teaching_Intelligence_Inventory_Authority_Spec_Phases_4-6_v1.2_PPL.md`, SHA-256 `3d0bf8503df58c2126692119353d5c6eb29d157b8891de18ffaade1dd1f3e0ec`, under `docs/teaching/change-control/KIWI_Teaching_D05_Authority_Source_Resolution_v1.0.md`.

The selected source preserves the original 165 capability authority intent and adds only the four PPL T0 responsibilities. Registry v1.1 remains 169 = 147 model-eligible + 22 T0/no-direct-prompt. D03 prompt bindings remain v1.3 and all routes remain UNQUALIFIED pending D30.

## Architecture

The D05 path is:

`legitimate trigger → D02 durable event/runtime → D05 trigger normalization → Registry/contract preflight → capability-scoped context → deterministic T0 or central KIWI AI boundary → schema/domain/provenance/authority validation → authoritative state re-read → owning-domain handoff → authoritative mutation + durable resulting event`

The Teaching Orchestrator coordinates. It does not own Course scope, Scheduler truth, live-Class state, Assessment Package/Attempt truth, marks, Gradebook, SKM, Attendance, Request decisions, Progression, or Teacher Identity.

### TCH-0759 — authority-boundary harness

`tests/teaching/unit/d05-orchestrator-runtime.test.js` covers representative T0, T1, T2, T3 and T4 paths. T0 never reaches the model; T1 fallback cannot mutate academic truth; invalid T2 cannot mutate evidence; stale T3 is rejected before owner handoff; validated T4 can reach only the registered owner service.

### TCH-0767–0776 — Teaching Orchestrator

`teaching/orchestrator/` provides:

- a separate Teaching Orchestrator service boundary;
- canonical execution envelopes with correlation/causation/idempotency/state/provenance/result contracts;
- trigger normalization that preserves command/fact/due/recovery distinctions;
- server-authoritative time for authenticated client actions;
- capability-scoped context retrieval with an explicit server-side reference authorization hook;
- deterministic preflight with Registry binding, capability availability and configured gate resolution;
- one adapter into KIWI's existing central AI Orchestrator boundary;
- explicit post-model provenance validation in addition to D02 schema/domain/deterministic validation;
- post-model state/precondition revalidation;
- exact Registry owner-boundary routing for permitted commits;
- dependency-aware orchestration composition with parallel independent work and explicit independent-validation separation;
- authority-aware failure/cancellation behavior.

Production route execution stays fail-closed while D03 routes are UNQUALIFIED. D05 does not add provider/model IDs or bypass D30.

### TCH-0778–0786 — event/runtime integration

D05 continues to use the D02 canonical event envelope and `teaching_runtime.due_events` for scheduled due events. It does not create a competing scheduled-event store.

D05 adds a transactional `teaching_runtime.event_outbox` for academically significant committed-domain event publication. A domain mutation and its resulting event can be written in one database transaction; outbox publication is durable/retryable and never silently dropped after the current retry budget is exhausted.

`teaching_runtime.orchestration_executions` persists replay/idempotency, capability, authority, state-version, validation, stale-rejection and safe audit metadata. Prompt bodies, model raw responses, protected payloads and hidden chain-of-thought are not stored there.

The follow-up D05 service-policy hardening migration adds explicit `service_role` SELECT/INSERT/UPDATE RLS policies on `orchestration_executions`. This does not broaden browser access or add DELETE/TRUNCATE; it makes the private service-only RLS posture explicit and removes the D05-specific no-policy advisor finding.

Per-aggregate correctness is based on aggregate/state versions, preconditions, owner transactions and reconciliation; D05 never assumes one global event order. Existing D02 catch-up dispositions remain `ACTIONABLE`, `ALREADY_SATISFIED`, `SUPERSEDED`, and `FAIRNESS_RECOVERY_REQUIRED`.

The Orchestrator performs authoritative reads before model work, holds no authoritative DB transaction across the central AI call, then re-reads/revalidates state before any owner handoff.

### TCH-0791, TCH-0798, TCH-0817 — D03 control-plane integration

Every requested capability resolves through Registry v1.1. Unknown IDs and authority/owner/family mismatches fail closed. Feature code does not choose prompt prose/family versions. `createStructuralPromptInvocation()` remains the central D03 contract resolver. Non-T0 model work is bound to an authoritative state reference and preconditions before model execution.

### TCH-0879–0882 — deterministic PPL T0 runtime

`teaching/preparation/t0-handlers.js` implements the four promptless PPL T0 capabilities:

- `teaching.preparation.workspace_state_transition`
- `teaching.preparation.materiality_staleness_reconciliation`
- `teaching.preparation.finalization_readiness_gate`
- `teaching.preparation.protected_content_isolation`

The transition handler rejects illegal lifecycle/maturity transitions, cannot be driven by model confidence, requires configured deterministic gates for maturity advancement, and requires the fail-closed finalization gate before `PRE_LOCK_READY`, `FINALIZED`, or `HANDED_OFF`.

Materiality reconciliation compares captured vs current authoritative dependency versions and invalidates only affected components when the D04 dependency graph makes that safe. Non-material triggers are audited no-ops; stale background completions are rejected.

Finalization readiness rechecks authoritative dependency versions, current artifact/input presence, open findings, contamination/protection state, configured policy/feasibility checks, and target-owner preconditions. A deadline never turns NOT_READY into READY.

Protected content access rejects ordinary teacher/lesson/homework/practice/student/retrieval contexts and requires both an allowed preparation/validation purpose and the D04 explicit protected server authorization.

### TCH-0883–0885 — PPL event/staged workflow/version safety

D05 adds durable PPL event names for seed, material input change, review due, finalization due, finding resolution, contamination, supersession, cancellation and handoff readiness.

`teaching/preparation/events.js` validates those PPL triggers and provides deterministic coalescing of compatible material-change events. Coalescing preserves the latest per-dependency version/reference rather than dropping material changes.

`teaching/preparation/workflow.js` defines the canonical purpose stages:

`Seed → Shape → Challenge → Repair → Reconcile → Candidate Development → Independent Validation → Whole-Artifact Review → Final Revalidation → Handoff`

Preparation Profiles decide which optional/review stages are justified; there is no universal pass count and stages never name providers/models. Version tokens capture workspace/artifact/input-bundle state and are revalidated before artifact persistence. Failed work never clears the last valid artifact.

## Transactional event publication

`teaching/runtime/transactional-mutation.js` is the D05 TCH-0780 seam. The owning domain mutation and the resulting validated Teaching event are written through the same supplied transaction client. Scheduled due events go to the existing D02 store; committed-domain/result/recovery events go to the D05 outbox. The browser has no write grant to either store.

## Security

- browser roles have no access to D05 runtime tables;
- `teaching_domain_service` receives only INSERT/SELECT on the event-publication surfaces needed by owner transactions, never outbox worker UPDATE/DELETE/TRUNCATE;
- only server `service_role` workers can claim/publish outbox rows;
- protected payload access remains through `teaching_protected_service` / explicit protected authorization;
- D05 execution audit stores identifiers/versions/provenance/safe metadata, not prompt bodies, raw protected payloads, assessment answers, secrets, or hidden reasoning;
- event payload remains bounded routing metadata and cannot become a duplicate academic source of truth.

## Runtime integration

`createTeachingD05RuntimePlatform()` composes D02 runtime + D03 prompt control + D05 orchestration persistence + D04 preparation persistence + outbox delivery. It reuses the central AI execution boundary. It does not select a provider/model.

Production `index.js` now boots `createTeachingD05RuntimePlatform()` rather than the D02-only constructor. It starts both the D02 due-event worker and the D05 durable event-outbox worker. Outbox delivery goes through a fail-closed `createTeachingEventSubscriberRegistry()`; an event with no registered owner/subscriber remains durable and retryable instead of being silently marked published.

D05 does not add a Teaching web mutation endpoint. Future domain deliveries will expose only their own authenticated owner surfaces.

## Recovery

See `docs/teaching/migrations/d05-recovery.md`. D05 recovery stops orchestration/outbox workers first and preserves D04 academic/PPL truth. Never recover by granting browser writes or bypassing RLS.

## Acceptance posture

D05 is structurally complete only when the D01–D05 verifiers, Teaching/full regression suites, web build, schema checks and production post-apply checks pass. The non-production integration suite must continue refusing the production Supabase project.
