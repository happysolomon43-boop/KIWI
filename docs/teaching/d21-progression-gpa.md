# KIWI Teaching D21 — Progression, Remediation, Resit, Recovery, Repeat & GPA

D21 implements exactly TCH-0037, TCH-0063, TCH-0427–TCH-0461, TCH-0732 and TCH-0890.

## Authority boundary

- D20 remains the only Gradebook/Course-score owner. D21 consumes its versioned Course Result snapshots and uses the D20-owned resit adapter for component replacement.
- D13 remains the Student Knowledge Model owner. D21 reads current versioned states for readiness and repeat compression input but never assigns SKM states.
- D17 remains Assessment/Package/Attempt/Response owner. D21 creates only Assessment definitions/handoffs for fresh equivalent Resit or Verification work.
- D21 alone commits progression outcomes, pathway/eligibility consequence, Course Attempt repeat lineage and D21 GPA snapshots.
- TPF-17/PPL is planning only. TPF-19 is translation only. Neither can commit progression, grades, GPA, eligibility, attempts or packages.

## Deterministic progression gate

A Course needs a locked explicit Progression Policy; there is no hidden KIWI pass mark. Certification independently checks required coverage, D20 trustworthy Topic-evidence finalization, required formal Assessment completion, unresolved appeals/invalidations, configured terminal floor and essential outcomes. Missing or unresolved evidence yields `INCOMPLETE`, never an inferred Fail.

Weakness distribution is evaluated separately from overall percentage. Narrow recoverable failure can produce Resit; distributed/systemic weakness produces Recovery; a failed reasonable Recovery can produce Repeat. A passing overall score with an unresolved essential/prerequisite gap produces Pass—Remediation Required.

## Repair pathways and PPL

Every D21 pathway carries exact source versions. Its generic `teaching_preparation` Workspace records authoritative input bundles and TPF-17 artifact lineage. Model work occurs outside database transactions. Immediately before accepting a refined plan, D21 re-reads D20/D13/D21 state and discards stale output. Plan maturity never means academic clearing.

Verification eligibility is server-derived from fresh authoritative evidence relative to the pathway's SKM baseline and completed owner-recorded required steps. A browser cannot self-assert readiness.

## Resit and Recovery

Resit definitions are owned by D17 and carry D21 lineage to the original failed Assessment Result. The D20-owned adapter reuses D20 marking and performs the policy-authorized Gradebook replacement while preserving both original and resit result history. Category rebalance, Topic snapshots, Course Result recalculation and grade-change audit remain D20-owned.

Recovery and targeted verification use fresh controlled Verification Assessments and do not silently become Gradebook marks.

## Repeat and GPA

Repeat creates a new Course plus a linked `teaching_course_attempts` record. The previous Course/Gradebook history remains untouched. Prior SKM version refs and a new D17 Diagnostic are exposed as inputs for TPF-17 repeat compression.

Semester GPA requires an explicit locked Semester GPA Policy. Each Course percentage is mapped through that Course's configured D20 grading scale. Academic credits are used when configured; equal weighting is accepted only under an explicit no-credit-system policy. Study hours are rejected as credits. Repeated-Course GPA treatment must also be explicit.

## Conditional surfaces

D21 exposes dedicated Remediation, Resit, Recovery, Repeat, Incomplete and Semester Record projections. The surfaces explain authority and history preservation instead of becoming a second academic ledger. D23/D24 global IA/visual-system work remains deferred.
