# KIWI AI Orchestrator — Phase 3 State, Telemetry, and Shadow Routing

Phase 3 adds persistent operational state and observes every legacy Gemini call without changing which model serves the user.

## What is now persistent

Supabase stores:

- approved/discovered model metadata in `ai_model_catalog`;
- project-slot × model health in `ai_project_model_state`;
- one logical AI request record in `ai_requests`;
- per-attempt provider metadata in `ai_attempts`;
- privacy-safe daily operational totals in `ai_daily_rollups`.

No API key, prompt, study note, exam question, flashcard body, or AI response text is persisted in these tables.

All five tables have RLS enabled and direct access revoked from the `anon` and `authenticated` Supabase client roles.

## Quota state model

Quota state is tracked by:

```text
project slot × model
```

rather than by API key alone.

Supported states:

- `READY`
- `COOLDOWN_RPM`
- `COOLDOWN_TPM`
- `EXHAUSTED_RPD`
- `MODEL_UNAVAILABLE`
- `KEY_INVALID`
- `DISABLED`

RPD state resets by the date in `America/Los_Angeles`, matching Gemini's Pacific-time daily quota window. RPM/TPM states use temporary cooldowns and automatically return to READY after expiry.

## Shadow mode

Every existing legacy call now carries a canonical task ID into the legacy Gemini wrapper.

The wrapper still performs the exact same legacy model request as before. Separately and asynchronously, the new orchestrator records what it *would* have routed:

```text
legacy request
    ├─ legacy Gemini request → still serves the user
    └─ shadow plan → records VVIP/VIP/IP candidate route only
```

Shadow planning never sends a second Gemini request, consumes no additional Gemini quota, and cannot delay or fail the user's legacy AI request.

Normal CBT and Reckoning CBT are distinguished before they reach shadow routing.

## Startup

At backend startup the AI runtime:

1. seeds the approved model catalog into Supabase;
2. hydrates persisted project/model quota state into memory;
3. leaves all production requests on the legacy wrapper.

If AI state initialization fails, the backend logs the error and legacy AI remains available.

## Migration status

- Phase 1: inventory and contracts — complete.
- Phase 2: orchestrator core — complete.
- Phase 3: persistent state, telemetry, shadow routing — implemented here.
- Phase 4: migrate IP features to live orchestrator routing — next after shadow verification.
