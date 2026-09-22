# KIWI AI Orchestrator — Phase 8 Final Hardening

Phase 8 closes the original AI-orchestrator migration by enforcing the architecture repository-wide, exposing safe operational health, and bounding telemetry retention.

## Final architecture contract

Production feature code may call AI only through the centralized orchestrator.

The repository-wide test suite now enforces:

- versioned Gemini model IDs exist only in `services/ai/model-catalog.js`;
- the Google Generative Language endpoint exists only in `services/ai/gemini-transport.js`;
- Gemini API-key environment variables are read only by `services/ai/project-pool.js`;
- feature code cannot supply provider `thinkingConfig`, `modelOverride`, or the removed `geminiModel.generateContent` wrapper;
- every statically referenced `ai.run('TASK_ID', ...)` task exists in the canonical task registry;
- all canonical registry task IDs remain wired into production.

This turns the AI architecture from a convention into a CI-enforced boundary.

## Secret-free operational health

The runtime now exposes a `status()` snapshot used by the authenticated admin health check.

It includes:

- enabled/total project slots;
- current VVIP, VIP, and IP primary model and bounded fallback chain;
- model-catalog lifecycle counts;
- quota-state counts;
- automatic discovery status and last cycle summary;
- operational-history retention status and last cleanup.

It does not expose API-key values, prompts, study content, or model response text.

## Bounded operational-data retention

AI request/attempt telemetry is deliberately operational rather than permanent learner history.

Defaults:

- request + attempt telemetry: **30 days**;
- model qualification audit rows: **180 days**;
- aggregated daily AI rollups: **365 days**.

The cleanup runs once asynchronously after startup and then every 24 hours.

The latest qualification record for every model is retained even when older qualification history expires, preserving the reason behind the current lifecycle decision.

Configuration:

```text
AI_REQUEST_RETENTION_DAYS
AI_QUALIFICATION_RETENTION_DAYS
AI_ROLLUP_RETENTION_DAYS
AI_RETENTION_CLEANUP_INTERVAL_MS
```

Safety bounds prevent accidental zero-day deletion or unbounded retention from malformed environment values.

## Operational controls inherited from Phase 7

```text
AI_AUTO_DISCOVERY
AI_AUTO_PROMOTE
AI_MODEL_DENYLIST
AI_PIN_VVIP_MODEL
AI_PIN_VIP_MODEL
AI_PIN_IP_MODEL
AI_QUALIFICATION_PROJECT_SLOT
AI_DISCOVERY_PROJECT_SAMPLE
AI_DISCOVERY_INTERVAL_MS
```

Model pins are downgrade ceilings and cannot revive a suspended or denied model.

## End state

A new KIWI AI feature should add one canonical task policy and call:

```js
await ai.run('NEW_TASK', { content });
```

It must not add its own provider model, key selection, thinking configuration, quota handling, response transport, or fallback loop.
