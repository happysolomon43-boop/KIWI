# D01 — Repository, Module & Test Foundation

D01 establishes structure only. Academic behavior belongs to later deliveries.

## Task coverage

- TCH-0016: `teaching/` is the dedicated module boundary.
- TCH-0017: canonical domain module folders are under `teaching/modules/`.
- TCH-0018: `teaching/integrations/kiwi-subjects.js` is a read-only, user-scoped Subject interface.
- TCH-0019: `teaching/integrations/kiwi-exam-interface.js` describes the existing KIWI CBT surface without reimplementing it.
- TCH-0020: `teaching/integrations/kiwi-notifications.js` is an injected KIWI notification interface.
- TCH-0021: `teaching/services/teaching-service.js` is the UI-facing application service boundary.
- TCH-0022: `teaching/repositories/` prevents controller/AI code from issuing ad-hoc database calls.
- TCH-0023: `teaching/domain/ids.js` provides dedicated identifier constructors.
- TCH-0024: `teaching/domain/time.js` requires timezone-aware academic timestamps.
- TCH-0025–0026: `teaching/events/` defines dispatcher/event names/contracts without implementing D02 durable runtime.
- TCH-0027: `teaching/events/idempotency.js` defines replay-safe handler/store interfaces; the included memory store is test/dev only.
- TCH-0028: `teaching/events/audit.js` defines structured audit events without D04 persistence.
- TCH-0029 and TCH-0675: flags default off and are evaluated server-side.
- TCH-0030: `teaching/config/` owns Teaching environment/config parsing; provider/model settings are opaque and remain owned by KIWI AI routing.
- TCH-0031: `teaching/security/secret-audit.js` plus D01 tests fail on source credentials/provider SDK imports in Teaching code.
- TCH-0032: `teaching/security/privileged-operations.js` defines browser-trust prohibition for grading finalization, package locking, formal request decisions and schedule-authority updates.
- TCH-0033: `tests/teaching/unit/` tests domain/foundation logic without UI.
- TCH-0034: `tests/teaching/integration/` is strictly gated to a non-production Supabase connection.

## Deliberate non-goals

D01 does not create Teaching tables, RLS policies, durable event storage, formal academic mutation endpoints, Capability Registry runtime, prompts, model routes, Course behavior, Scheduler behavior, Gradebook behavior, or assessment behavior.
