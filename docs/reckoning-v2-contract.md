# Reckoning V2 — Frozen Compatibility Contract (Phase 0)

This contract defines the boundary for Reckoning V2 before adaptive assessment behavior is introduced.

Delivery A may add architecture, persistence, compatibility metadata, and safety regression coverage. It must not change the learner-facing Reckoning lifecycle or make V2 production-authoritative.

## Existing lifecycle that remains authoritative

The surrounding Reckoning system remains unchanged:

1. Brain Pressure remains the trigger source.
2. Only one active Reckoning may govern a user at a time.
3. Existing Deferral semantics remain authoritative.
4. Existing Buffer semantics remain authoritative.
5. When mandatory, Reckoning continues to impose the global KIWI lockout.
6. Brain remains an approved Reckoning recovery/access surface.
7. Settings remains available during global Reckoning lockout.
8. The exact server-linked Reckoning exam remains accessible during lockout.
9. Normal or historical CBT exams remain blocked during mandatory lockout.
10. Refresh, reconnect, or process restart must not be treated as Reckoning completion.
11. A failed Reckoning continues to preserve the surrounding lockout/failure semantics.
12. Existing repeated-failure failsafe and its existing subject-KS consequence remain authoritative.
13. Successful resolution continues to clear the surrounding Reckoning state according to the existing lifecycle.

## Lockout safety invariant

KIWI must never deny access to the mechanism required to resolve an active Reckoning.

The protected recovery surfaces are:

- Brain/Reckoning endpoints;
- Settings endpoints explicitly exempted by the current lockout middleware;
- generation of a mandatory Reckoning exam;
- the exact exam session linked by `reckoning_sessions.exam_session_id`.

The exact linked exam exception must never become a blanket exemption for all exams.

If the backend cannot verify Reckoning state for a protected feature, it must fail closed rather than silently unlock the application. Brain and Settings remain the recovery surfaces.

## V2 authority boundary

During Delivery A:

- `engine_version = 1` remains the default for existing/legacy Reckonings;
- `engine_mode = LEGACY` remains the default;
- the V2 engine facade is fail-closed;
- root production routes do not instantiate Reckoning V2;
- normal CBT does not need V2 question metadata;
- no AI model decides pass/fail;
- no risk engine, planner, scheduler, recovery scoring, or adaptive answering behavior is production-active.

## Persistence compatibility

Delivery A may create the schema required by future V2 sessions, but that schema must be additive.

It must not:

- drop legacy Reckoning columns;
- rewrite existing Reckoning statuses;
- replace existing failure/failsafe fields;
- replace the existing student flag / AI question audit fields;
- require ordinary CBT rows to populate Reckoning V2 metadata.

## Delivery A completion boundary

Delivery A contains only Phases 0–4:

- Phase 0 — frozen compatibility contract;
- Phase 1 — modular backend boundary;
- Phase 2 — persistent V2 schema/store contract;
- Phase 3 — normal-CBT question metadata compatibility;
- Phase 4 — lockout/access safety regression contract.

Risk scoring and all adaptive-assessment behavior begin in the next delivery and are explicitly out of scope here.
