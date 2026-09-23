# KIWI AI Orchestrator — Resilience Delivery A

Delivery A hardens the routing core before any Reckoning-specific resilience work.

## Scope

This delivery changes only central AI routing, failure classification, transient model health, and model-lifecycle behavior. It does not add Reckoning resumable preparation, traffic queues, global concurrency control, or persistent transient-provider health. Those belong to later deliveries.

## Failure taxonomy

- `400/422` -> `BAD_REQUEST`: request-scoped, non-retryable.
- `401/403` -> `AUTH`: project/key scoped.
- `404` -> `MODEL_NOT_FOUND`: model-scoped.
- `429` -> `RATE_LIMIT_RPM`, `RATE_LIMIT_TPM`, `RATE_LIMIT_RPD`, or `RATE_LIMIT_UNKNOWN`: project+model scoped.
- `503` -> `PROVIDER_OVERLOADED`: short-lived provider/model availability failure.
- other `5xx` -> `TRANSIENT`.
- timeout/network/empty response remain retryable availability failures.
- `CAPACITY_EXHAUSTED` is reserved for cases where no project+model route is genuinely eligible.

## Project health versus model health

Persistent quota state remains project+model scoped in `quota-manager.js`.

Short-lived model/provider instability is tracked separately by `transient-model-health.js`. A single 503 from one project slot does not open a model-wide circuit. The default circuit requires failures from two distinct project slots inside a 30-second evidence window.

On success, transient evidence is cleared immediately. When a circuit expires, the model becomes eligible for a natural half-open probe.

## Retry and fallback contract

VVIP, VIP, and IP policies now allow two bounded transient attempts per model.

For a provider overload:

1. try the selected model on one healthy project slot;
2. if it fails transiently, probe one independent healthy project slot;
3. if both independently fail, open a short model circuit;
4. then fall to the next approved model in the quality-preserving chain.

429 handling remains different: it rotates project slots because quota is route-specific.

## Capacity exhaustion invariant

An in-memory transient circuit may temporarily hide all approved models. That condition is now reported as `PROVIDER_OVERLOADED`, not `CAPACITY_EXHAUSTED`, when persistent project/model capacity still exists.

`CAPACITY_EXHAUSTED` therefore means the routing layer has no genuinely eligible project/model capacity, rather than merely "all models are cooling down."

## Model lifecycle isolation

Automatic model promotion rollback no longer treats provider overload, timeout, or generic transient failures as evidence that a model itself is incompatible. Those failures are handled by the runtime transient circuit.

Persistent model rollback remains available for compatibility signals such as model-not-found, invalid request behavior on a newly promoted model, repeated empty responses, and task-validation failures.

## Configuration

Optional environment controls:

- `AI_MODEL_TRANSIENT_FAILURE_SLOTS` — distinct project-slot failures required to open a model circuit; default 2, bounded 2–5.
- `AI_MODEL_TRANSIENT_FAILURE_WINDOW_MS` — evidence window; default 30000 ms.
- `AI_MODEL_TRANSIENT_COOLDOWN_MS` — default circuit duration; default 20000 ms.

Provider `Retry-After` / Gemini RetryInfo still overrides the default cooldown within safe bounds.

## Explicitly deferred

Delivery A does not implement:

- global AI concurrency scheduling;
- priority queues or backpressure;
- persistent transient-provider circuit state across Render restarts;
- Reckoning incremental question persistence;
- Reckoning adaptive generation concurrency.

Those remain Delivery B and Delivery D responsibilities.
