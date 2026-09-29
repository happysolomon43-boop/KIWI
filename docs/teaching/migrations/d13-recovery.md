# KIWI Teaching D13 Migration / Recovery Notes

Migration: `20260929_teaching_d13_student_knowledge_model.sql`.

D13 is forward-additive. It extends the existing immutable `teaching_evidence_events` contract with normalized evidence-demand, assistance/exposure, confidence, provenance, validity and replay fields; it does not create a parallel evidence truth. It adds the D13-owned current SKM projection plus immutable state history/evidence-application history, durable misconception current/history records, and immutable TPF-09 interpretation artifacts.

Recovery rule: correct forward. Do not delete real Evidence Events, state history, misconception history or interpretation artifacts after student use. If an algorithm defect is found, introduce a new versioned SKM algorithm and replay/audit from the immutable Evidence Event history. The current projection may be recalculated by an explicitly versioned migration/replay procedure, but historical versions must remain distinguishable by `algorithm_version`.

If code reaches production before the migration, D13 readiness must fail closed with `TEACHING_D13_SCHEMA_MISSING`; D01–D12 remain available. If the migration reaches production before code, all added Evidence Event columns are nullable/defaulted or additive, and no existing D01–D12 write path acquires new authority.

Never recover by granting `anon`/`authenticated` direct mutation access, copying Gradebook percentages into SKM state, deleting contradictory evidence, converting TPF-09 output into direct state writes, or weakening the D30 route-qualification hold.
