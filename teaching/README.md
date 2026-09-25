# KIWI Teaching module boundary

This directory contains the server/domain foundation for KIWI Teaching.

D01 established the repository/module boundaries. D02 adds low-level authoritative runtime/event/validation primitives only. Course, scheduling, grading, assessment, attendance, SKM, progression and other academic-domain behavior remain owned by their later deliveries.

## Entry boundaries

- `public/teaching.html` and `public/teaching.js` own the Teaching presentation shell.
- `teaching-backend.js` is the HTTP adapter.
- `teaching/services/` owns application-facing service composition.
- `teaching/repositories/` is the only Teaching academic data-access seam.
- `teaching/integrations/` adapts existing KIWI-owned capabilities.
- `teaching/domain/` holds value contracts with no transport/database concerns.
- `teaching/events/` defines the canonical event vocabulary/envelope validation.
- `teaching/runtime/` owns D02 durable due-event execution, reconciliation and server-time projection primitives. It owns no academic truth.
- `teaching/ai/` owns the D02 central-AI execution and trusted-output validation boundary. It does not implement D03 Capability Registry/prompt runtime.
- `teaching/authority/` enforces deterministic precedence and validated-result handoff to the real domain owner.
- `teaching/observability/` records safe execution metadata without prompt/student-content/chain-of-thought logging.
- `teaching/security/` defines server-only privilege and untrusted-context boundaries.
- `teaching/accessibility/` defines the minimum reusable UI accessibility contract.
- `teaching/modules/` reserves the canonical academic-domain package boundaries.

The UI must not own academic truth. Browser timers are projections of authoritative server timestamps. AI/controller code must not issue ad-hoc academic SQL. Provider/model SDK calls are forbidden in Teaching feature/domain code; model execution remains owned by the central KIWI AI Orchestrator.

Teaching does not use generic feature-availability toggles or per-user development allowlists. Implemented/accepted capabilities are exposed normally; incomplete capabilities remain absent until their owning delivery is complete. Academic/runtime qualification gates remain mandatory and are not feature toggles.

D02 operational persistence lives in the private `teaching_runtime` PostgreSQL schema. It is deliberately separate from D04's future Teaching academic-domain persistence and from the pre-existing public `background_jobs` table.
