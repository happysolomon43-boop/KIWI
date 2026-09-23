# Reckoning V2 — Phase 1 Architecture Boundary

Phase 1 creates the backend module boundary for the future Reckoning V2 assessment engine. It is intentionally architecture-only.

## Safety contract

- Existing Reckoning remains production-authoritative.
- No route, lockout, Brain, CBT, SRS, Pressure, KS, database, or frontend behavior changes in Phase 1.
- The new engine cannot be enabled through configuration in Phase 1.
- Unimplemented V2 operations fail closed with `ERR_RECKONING_V2_NOT_IMPLEMENTED`.
- The root `index.js` does not import or instantiate the new subsystem.

## Public engine facade

`services/reckoning/index.js` exposes a stable facade with:

- `prepare()`
- `start()`
- `recordAnswer()`
- `getState()`
- `finalize()`
- `describe()`

Only `describe()` is operational in Phase 1. The remaining methods deliberately throw until their implementation phases are complete.

## Internal boundaries

The subsystem separates future responsibilities into dedicated modules:

- state machine
- deterministic risk engine
- planner
- scheduler
- evidence engine
- question bank
- structural/semantic validator
- recovery scoring
- learning effects
- persistence port

This prevents the Reckoning redesign from adding another large block of tightly coupled behavior to the root backend.

## Accepted domain vocabulary

Phase 1 centralizes the already accepted question roles:

- Diagnostic
- Control
- Challenge
- Confirmation

Risk levels:

- Critical
- High
- Supporting

Evidence states are also centralized so later migrations and routes can share one canonical vocabulary.

## Phase 1 exit condition

Phase 1 is complete when:

1. the subsystem is importable;
2. the facade contract is test-protected;
3. all internal component boundaries are importable;
4. production authority is impossible to enable accidentally;
5. existing KIWI runtime behavior remains unchanged.

Database persistence, risk scoring, planning, AI generation, adaptive scheduling, scoring and production wiring belong to later phases.
