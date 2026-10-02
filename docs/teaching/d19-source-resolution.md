# KIWI Teaching D19 — Canonical Source Resolution

D19 started from accepted GitHub `main` SHA `71800eb6ae1e10260c93f551c5961f487ba5094e`, the exact accepted D18 merge recorded by the D18→D19 handoff. No later accepted commit or pre-existing D19 branch existed at implementation start.

The authoritative Delivery Roadmap v1.6 Revised and Delivery Task Map v1.7 agree that D19 is `Assessment Types & Measurement Behaviour`, hard predecessor D18, with exactly 20 permanent tasks: `TCH-0376`, `TCH-0378`–`TCH-0394`, `TCH-0909`, `TCH-0910`. The Master Backlog retains the same permanent task responsibilities. No task identity was renamed or moved.

The live Production Supabase ledger was directly re-queried before coding and remained at `20261002110401 / teaching_d17_assessment_domain`. Live schema inspection confirmed D17 already owns the required durable fields for Assessment type, purpose, graded status, announced scope, policy version, source lineage, Blueprint state/version data, Package policy snapshot, Attempt/result state, invalidation and eligibility. D19 therefore requires no migration and must not create a parallel type-policy persistence owner.

The accepted D06 policy registry closes the D19 surprise-budget and eligibility decisions. D19 consumes `impromptu-budget.v1` and `assessment-eligibility-exceptions.v1` exactly; it does not invent another numeric frequency, time or grade cap and it does not permit merely assumed prerequisites to become first-release graded scope without validation.

The accepted D17 Assessment domain remains owner of formal package truth and the accepted D18 shell remains the attempt UX/projection. D08 remains Course Plan/Coverage owner, D09 Scheduler/Calendar remains time owner, D11 Controller remains live Class state owner, D13 remains SKM owner, D15 remains Attendance owner, D20 remains formal marking/Gradebook owner and D21 remains Progression/Resit owner.

## TCH-0394 boundary

`TCH-0394` names a full Mid-Semester/Final generation, validation, attempt, mark and review cycle, while the frozen delivery roadmap assigns formal marking/moderation/Gradebook implementation to D20 after D19. The accepted D18→D19 handoff explicitly identifies this as a cross-delivery boundary and forbids pulling D20 forward.

D19 resolves the boundary without weakening the task: it validates the D19-owned type/scope path through D17 Blueprint/package locking and D17/D18 Attempt preservation, then emits/tests a typed handoff whose owner is D20 and whose state is `AWAITING_D20_MARKING`. The handoff contains no official mark, no Gradebook mutation and no D19 rubric-credit authority. D20 must implement the later mark/review portion against this preserved Attempt lineage.

This is not an architecture exception because the accepted handoff already defines the permitted resolution. No Blueprint, prompt, authority, task-map or delivery-map amendment is required.

## Prompt/runtime resolution

D19 does not change TPF-12/13/14 or any other frozen prompt-family bytes/bindings. It does not add a capability or model route. Existing Assessment model work continues through Teaching Orchestrator / central KIWI AI Orchestrator boundaries established by predecessors. D30 empirical route qualification remains required; D19 cannot self-qualify or hard-code a model/provider.

## Deployment preflight

At D19 start, Vercel production deployment `dpl_2doLn3x2KRw3WtG8SRTfqeYJy7yz` was `READY` on SHA `71800eb6ae1e10260c93f551c5961f487ba5094e`. Render KIWI service deployment `dep-davqu6avcj2c738j00mg` was `LIVE` on the same SHA with `main` auto-deploy enabled. D19 completion must verify the exact accepted D19 merge reaches those intended production services.
