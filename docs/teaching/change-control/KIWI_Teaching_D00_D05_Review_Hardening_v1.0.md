# KIWI Teaching D00–D05 review hardening v1.0

Class A implementation correction under the Implementation Change-Control Protocol v1.0.
Base: c44eff66e5deb5a30ca7b183079c67c6ab2821ff. Date: 2026-09-26.

The review identified incomplete outbox duplicate validation, unbounded academic input and a concurrent duplicate race in the generic idempotency helper.

Outbox duplicates now compare all 19 immutable persisted event fields. JSONB object key order, timestamp representation and PostgreSQL numeric representation are normalized without weakening payload or provenance comparisons. Conflicting reuse fails with TEACHING_D05_EVENT_IDEMPOTENCY_CONFLICT. No migration is required.

Academic input is serialized as plain JSON with a 65,536-byte UTF-8 ceiling, maximum depth 16 (root depth zero) and maximum 4,096 total member/element entries. These are local resource limits, not academic truncation: oversized input is rejected, never shortened. Cycles, non-finite numbers, unsupported types, custom prototypes, accessor properties, sparse arrays and custom serialization are rejected without executing getters or toJSON. Frozen prompt bytes and the structural contract remain unchanged. Future large-source consumers must provide bounded task input through the established context/reference contracts.

The generic idempotency handler now requires atomic runOnce on its store. The in-memory implementation shares pending work across wrappers using the same store and key, caches successful completion and allows retry after failure. This guarantee is process-local; it is not a claim of distributed exactly-once execution. Durable consumers retain the PostgreSQL claim/transaction paths. No production caller relied on the former get/put-only handler store interface.

Validation: 509 unit/regression tests passed, zero failed/skipped; 24 new regression tests included. D00, D01, D02, D03, D04 and D05 verifiers passed. Web build passed. Integration suite: four passed, four skipped because no non-production database is configured. Skips do not establish deployed RLS or migration correctness. D03 still verifies 19/19 frozen body hashes.

No frozen prompt, capability assignment, authority boundary, provider/model policy or route qualification changes. Teaching routes remain UNQUALIFIED pending D30. D06 is not started. Merge/CI evidence is recorded in the corrective pull request; this document does not assert production acceptance before that evidence exists.
