# KIWI Teaching D13 Migration / Recovery Notes

Migration: `20260929_teaching_d13_student_knowledge_model.sql`.

D13 is forward-additive to academic history. It extends the existing immutable D04 Evidence Event record and adds append-only SKM state, evidence-application, and misconception-version histories. It does not delete or rewrite D11/D12 history, official Gradebook truth, Course Plan/Coverage truth, Assessment Eligibility, or Progression.

Recovery must correct forward. Do not recover a production defect by deleting or updating historical SKM state versions, evidence applications, misconception versions, or Evidence Events. Introduce a versioned algorithm/normalization correction, preserve the original evidence/provenance, and recompute through the owner-controlled D13 path.

If code reaches production before the migration, `assertD13Ready()` fails closed with `TEACHING_D13_SCHEMA_MISSING`. If the migration reaches production before code, D01–D12 behavior remains valid; the new Evidence Event columns are nullable/defaulted and the new owner tables are additive.

D13 intentionally revokes table-wide authenticated SELECT on `teaching_evidence_events` and re-grants only the legacy student-safe columns. This prevents direct browser access to internal qualitative inference metadata while preserving the pre-D13 Evidence Event read surface.

No rollback may:
- grant browser-authoritative DML to SKM/evidence state;
- remove RLS or immutability;
- copy official Gradebook marks into SKM state;
- allow TPF-09/T2 output to commit durable state directly;
- collapse Gradebook, Knowledge Model, and Progression truth into one store;
- replace immutable replayable evidence with a mutable score-only projection.
