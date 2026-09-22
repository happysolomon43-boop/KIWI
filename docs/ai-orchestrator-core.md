# KIWI AI Orchestrator — Phase 2 Core

Phase 2 builds the provider-routing core without moving any production feature off the legacy Gemini wrapper.

## Modules

- `orchestrator.js` — one entry point for future `ai.run(taskId, request)` calls.
- `model-catalog.js` — approved stable Gemini models and capability metadata.
- `model-router.js` — VVIP/VIP/IP model-chain selection and generation affinity.
- `capability-adapter.js` — maps KIWI reasoning intent to a thinking level the selected model supports.
- `project-pool.js` — discovers independent API-key/project slots and keeps model-specific round-robin cursors.
- `gemini-transport.js` — the only new module allowed to know the Gemini HTTP endpoint.
- `response-normalizer.js` — removes thought parts and preserves finish/usage/model metadata.
- `errors.js` — typed provider-error classification.

## Routing policy

With the approved catalog at the end of Phase 2:

- VVIP: `3.8 Flash -> 3.7 Flash -> 3.6 Flash`
- VIP: `3.7 Flash -> 3.6 Flash -> 3.5 Flash`
- Degradable VIP: the VIP Flash chain, then `3.5 Flash-Lite -> 3.1 Flash-Lite`
- IP: `3.5 Flash-Lite -> 3.1 Flash-Lite`

The routing code uses abstract policies rather than embedding those IDs in feature code. When automatic model qualification is added later, the top-three/second-through-fourth policy can move forward without changing feature services.

## Failure semantics

- `400/422`: fail fast; request/config bug.
- `401/403`: disable the affected project slot in memory and continue.
- `404`: stop trying other keys for that model; move directly to the next model.
- `408/5xx/network/timeout`: retry through the bounded route.
- `429`: distinguish RPD/RPM/TPM where possible and continue through independent project slots.
- safety block: stop immediately; never fail over to evade a safety decision.

Persistent quota/cooldown state is deliberately deferred to Phase 3.

## Thinking compatibility

KIWI's registry specifies reasoning intent as `MINIMAL/LOW/MEDIUM/HIGH`.

The adapter treats that as a minimum. It never silently lowers reasoning. For example, a MINIMAL task routed to Gemini 3.8/3.7 becomes LOW because those models do not support MINIMAL. HIGH remains HIGH-only.

## Security boundaries

- Feature code cannot provide `thinkingConfig`.
- API keys are read only by `project-pool.js`.
- Public pool snapshots never contain secret values.
- Provider model IDs are centralized in `model-catalog.js`.
- The Gemini API endpoint is centralized in `gemini-transport.js`.
- Orchestrator logs include task/model/project-slot/error metadata only; they do not include API keys or prompt content.

## Production status

Phase 2 is dormant infrastructure. `index.js` still uses the legacy Gemini wrapper. Migration begins only after the persistent quota/telemetry layer and observe-only routing are added.
