# KIWI Teaching D07 — Course Intake, Curriculum Audit & Prior-Knowledge Verification

Status: implemented; AI routes remain UNQUALIFIED pending D30 and production release remains blocked until D31.

All 23 tasks are accounted for:

- TCH-0094, TCH-0095, TCH-0096 and TCH-0113: authenticated Draft Course entry, existing KIWI Subject selection, authoritative corpus retrieval and Stage 1 UI.
- TCH-0097, TCH-0098, TCH-0099, TCH-0100, TCH-0102 and TCH-0703: provenance-preserving inventory, TPF-02 capability request, structured schema, hierarchy/dependency/exit-condition validation, six-class D06 source policy and complete source census.
- TCH-0695, TCH-0696, TCH-0697, TCH-0698, TCH-0699, TCH-0700, TCH-0701 and TCH-0702: original Intake capture, optional controls, TPF-01 extraction contract, signal separation, explicit non-evidence state, downstream diagnostic/planning signals, minor preference updates without Course Plan versioning, and concise change explanations.
- TCH-0377, TCH-0712 and TCH-0748: TPF-04 targeted non-graded Diagnostic contract, material uncertainty selection and clean NOT_REQUIRED path with Stage 3 UI responsibility.
- TCH-0713 and TCH-0714: deterministic `validated-prior-knowledge.v1` application from server-held diagnostic evidence with two independent/distinct opportunities, critical criteria, varied/uncued evidence where applicable, contradiction rejection, and immutable validator/version/provenance records.

The implementation reuses D04 tables and adds curriculum-audit, diagnostic-plan and VPK-decision records. It does not create Subject, SKM, Gradebook, Course Plan, Scheduler or provider/model authority. Raw Subject scope and Intake never create Assessment Eligibility. Audit candidates do not become an approved D08 Course Plan.
