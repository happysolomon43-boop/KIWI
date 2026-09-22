# KIWI AI Orchestrator — Phase 4 IP Migration

Phase 4 moves the seven low-risk IP tasks from the legacy Gemini wrapper to live orchestrator routing.

## Live IP tasks

- CARD_EXPLANATION
- RECLASSIFICATION_ALERT
- MASTERY_MOMENT
- ZONE_DESCRIPTION
- HIDDEN_DISCOVERY
- RETURN_GREETING
- CHRONICLE_ARTIFACT

These now call `ai.run(taskId, { content })` directly.

## Routing

IP tasks use the centralized Flash-Lite policy:

```text
gemini-3.5-flash-lite
        ↓
gemini-3.1-flash-lite
```

Model choice, project/key selection, quota state, thinking level, timeout, retries, telemetry, and fallback are all owned by the orchestrator.

Feature code no longer contains provider-specific thinking settings for these tasks.

## Safety

This phase intentionally leaves all VIP and VVIP features on the legacy wrapper in shadow mode.

Legacy direct Gemini calls:

```text
27 before Phase 4
20 after Phase 4
```

Live orchestrator calls:

```text
0 before Phase 4
7 after Phase 4
```

The existing deterministic fallbacks for the migrated features remain unchanged.
