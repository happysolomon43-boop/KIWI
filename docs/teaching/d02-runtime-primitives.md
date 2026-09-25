# D02 — Authoritative Runtime, Event & Validation Primitives

D02 implements low-level cross-cutting foundations only. It does not implement Course, Scheduler, Gradebook, SKM, Assessment, Attendance, Request, Progression, Teacher Identity or live-Class academic behavior.

## TCH coverage

- TCH-0738: private PostgreSQL-backed durable due-event store and server worker.
- TCH-0739: authoritative server-time snapshot and projection-only timer utility.
- TCH-0740: claim leases, replay/idempotency, stale/late reconciliation and retry/fairness recovery.
- TCH-0741: unit/integration coverage for duplicate, stale, delayed, restart/claim recovery and KIWI-failure behavior.
- TCH-0742: one Teaching model-execution adapter accepts only the injected central KIWI AI Orchestrator runner.
- TCH-0743: deterministic T0 work is explicitly rejected from the model path; intelligence responsibility is not equated with a network call.
- TCH-0745: safe event/AI execution correlation and validation telemetry.
- TCH-0746: initial Teaching threat model under `docs/teaching/security/`.
- TCH-0747: reusable UI accessibility baseline under `docs/teaching/accessibility/` plus a code-level contract.
- TCH-0753: trusted schema/domain/deterministic model-output validation boundary.
- TCH-0754: branded validated results plus authoritative-owner commit gateway; raw model output has no direct mutation path.
- TCH-0755: authority-aware T0–T4 fail-closed policy.
- TCH-0756: structurally separated trusted/provenance/untrusted context lanes and formal-marking minimization guard.
- TCH-0757: deterministic-authority checks reject conflicting model output.
- TCH-0758: Teaching execution telemetry records class, authority, validation/rejection and eventual owner mutation reference without content/chain-of-thought logging.

## Runtime persistence

D02 adds only operational persistence in the private `teaching_runtime` schema:

- `due_events`;
- `event_attempts`;
- `ai_execution_audit`.

These are runtime coordination/audit records, not academic truth stores. D04 still owns Teaching kernel academic persistence.

The browser roles `anon` and `authenticated` receive no access to the schema. The existing public `background_jobs` table is deliberately not reused.

## Durable event lifecycle

The runtime accepts only validated scheduled due events with authoritative timestamps and idempotency keys.

Workers claim due rows with `FOR UPDATE SKIP LOCKED` and a bounded lease. An expired claim returns to retry. Every registered academic handler must provide a reconciliation function that re-reads authoritative state before the handler can act.

Reconciliation produces exactly one of:

- actionable;
- already satisfied;
- superseded;
- fairness recovery required.

A handler error retries with bounded exponential backoff. When the configured retry ceiling is exhausted, runtime state becomes fairness-recovery-required. The runtime never invents a student action or academic penalty.

## AI execution boundary

Teaching model-backed work calls only the injected KIWI AI Orchestrator runner.

D02 does not create the D03 Capability Registry runtime, prompt-family dispatcher, Constitution binder or route manifest. Consequently D02 records a responsibility key, intelligence class and authority ceiling without inventing canonical capability resolution.

T0 is not model-executed. T2–T4 require both schema and domain validation before a result can receive the internal validated-result brand. Applicable deterministic-authority checks run after those validations and veto conflicts.

The authoritative commit gateway accepts only branded validated results and only dispatches to a registered owner service. The gateway itself does not own academic truth.

## Failure semantics

T0 continues from deterministic rules, independent of AI availability. T1 may use a safe communication fallback. Invalid T2 cannot mutate evidence. Invalid T3 remains draft/pending. Invalid T4 remains unfinalized.

All KIWI-caused runtime/model failure paths are non-punitive.

## Operational boundary

The runtime worker is initialized by the KIWI backend from the normal server-side PostgreSQL connection. If the D02 operational schema is unavailable, the worker remains stopped and reports a fail-closed initialization error; it never falls back to in-memory academic timing.

No browser tab is required for event execution.


<!-- post-merge CI validation branch: do not merge -->
