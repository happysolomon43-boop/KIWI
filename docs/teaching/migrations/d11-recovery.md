# D11 migration and recovery notes

Migration: `20260929_teaching_d11_lesson_controller.sql`.

The migration is additive over the accepted D04/D08/D09/D10 schema. It extends existing Lesson Blueprint/Class Session rows and creates D11 immutable history/fact/translation/note tables. It does not delete Course, Plan, timetable, Request, evidence or preparation history.

Recovery is forward-corrective. After real Class records exist, do not recover by dropping D11 truth tables or deleting immutable Controller history/closure artifacts. Correct schema defects with a successor migration that preserves Controller versions, Blueprint lineage, PPL dependencies and closure provenance.

If application code is present before the migration, `assertD11Ready()` fails closed and D11 routes remain unavailable; D02/D05 predecessor state is not replaced by in-memory/browser authority. If a model route is unavailable, model-backed preparation remains held while T0 Class timing and safe Controller state remain durable.

Before production application, apply and inspect the migration in the non-production Teaching integration project. After production application verify the migration ledger, required columns/constraints/indexes, RLS, authenticated DML revocation, student Summary read policy, private Teacher Note visibility and immutable triggers.
