# KIWI Teaching module boundary

This directory is the server/domain foundation for KIWI Teaching.

D01 establishes boundaries only. It intentionally does **not** implement Course academic rules, durable event execution, Teaching persistence, grading, assessment locking, scheduling authority, or model/provider routing.

## Entry boundaries

- `public/teaching.html` and `public/teaching.js` own the Teaching presentation shell.
- `teaching-backend.js` is the HTTP adapter.
- `teaching/services/` owns application-facing service composition.
- `teaching/repositories/` is the only Teaching data-access seam.
- `teaching/integrations/` adapts existing KIWI-owned capabilities.
- `teaching/domain/` holds value contracts with no transport/database concerns.
- `teaching/events/` defines event vocabulary and in-process abstractions only. Durable event runtime is D02.
- `teaching/security/` defines server-only privileged boundaries. Later domain owners implement the actual academic mutations.
- `teaching/modules/` reserves the canonical domain package boundaries.

The UI must not own academic truth. AI/controller code must not issue ad-hoc SQL. Provider/model SDK calls are forbidden in Teaching feature/domain code; model execution remains owned by the central KIWI AI Orchestrator.
