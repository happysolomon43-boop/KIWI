# KIWI Teaching D12 Migration / Recovery Notes

Migration: `20260929_teaching_d12_response_pedagogy.sql`.

D12 is forward-additive. It extends `teaching_student_responses` with Learning Unit/controller/idempotency lineage and creates immutable D12 interpretation/decision/profile/correction/handoff tables. It does not alter or delete D11 Controller history, Closure Facts, Course Plan truth, evidence-owner truth, Gradebook truth, Attendance truth or SKM truth.

Recovery rule: correct forward. Do not recover by deleting validated Response Evaluator artifacts, correction records or evidence handoffs after real student use. If a D12 contract defect is found, add a versioned successor evaluation/profile/decision and preserve provenance to the superseded interpretation. Handoff rows remain immutable events; the receiving future owner should create its own receipt/state rather than update the D12 event.

If deployment code reaches production before the migration, D12 readiness must fail closed with `TEACHING_D12_SCHEMA_MISSING`. If the migration reaches production before code, existing D01–D11 behavior is unaffected because all new columns are nullable and new tables are additive.

No D12 rollback may create browser-authoritative DML, remove RLS, collapse D11 Controller authority, or convert D12 misconception candidates into durable SKM state.
