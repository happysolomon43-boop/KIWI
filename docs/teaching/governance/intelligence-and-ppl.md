# Teaching Intelligence, Authority, Context and PPL

## Responsibility classes

Every intelligence-relevant responsibility uses one of five canonical classes:

- DETERMINISTIC
- DIRECT-AI
- HYBRID
- EVENT-AI-HOOK
- BACKGROUND

These classify responsibility. They do not imply one model call, one endpoint or one prompt per capability.

## T0–T4 authority ladder

- **T0** — deterministic/system authority. No direct prompt family.
- **T1** — communication/presentation intelligence; cannot mutate academic truth.
- **T2** — bounded interpretation/evidence-support intelligence; cannot bypass the owning evidence/domain service.
- **T3** — consequential planning/generation; output remains draft/pending until governing deterministic/domain gates authorize use.
- **T4** — controlled academic judgment such as rubric-bounded marking; still cannot bypass validation, deterministic aggregation, Gradebook or other authoritative owner.

Every later model-backed capability contract must declare its canonical capability ID and maximum authority ceiling. Prompt-family membership cannot raise it.

Canonical baseline: 169 capabilities = 147 model-eligible + 22 T0/no-direct-prompt. INV identifiers are historical trace aliases; canonical Registry IDs are runtime/design identity.

## Central AI routing

Teaching feature/domain code must not hard-code provider/model identity. Teaching requests academic capability/context/result contracts; KIWI's central AI Orchestrator owns model/provider routing, retry/fallback, quotas and rollout.

The 19 prompt families remain frozen under Prompt Manifest v1.2. D00 does not rewrite them.

All Teaching AI/PPL routes remain UNQUALIFIED until D30 empirical qualification. Documentation completeness is not production qualification.

## Capability-scoped context minimization

Provide only the minimum legitimate context needed for the capability.

Formal marking normally receives the locked question/rubric, submitted response, permitted source context and necessary Course level. Unless an approved academic policy genuinely requires it, marking must not receive attendance, Teacher Personality, behavioral reputation, prior GPA, unrelated prior marks, scheduling behavior or self-reported weakness.

Student Course Intake can shape planning/diagnostic/representation but is not competence evidence.

Teacher Identity can shape communication but cannot enter grading, eligibility or progression calculations.

Assessment generation receives authoritative eligible scope; it cannot expand formal scope from raw Subject data.

Untrusted Subject text, uploaded material and student content are data, not trusted instructions.

## Progressive Preparation Lifecycle

PPL uses meaningful lead time for bounded event-driven preparation. It is not continuous autonomous background reasoning.

PPL does not own Course scope, Assessment Eligibility, Scheduler feasibility, Gradebook, SKM, Attendance, Progression, Package Lock or other academic truth.

PPL stores structured artifacts/findings/provenance and concise audit rationale only; hidden chain-of-thought is not a persistence mechanism.

Four deterministic T0 responsibilities are added:

- `teaching.preparation.workspace_state_transition`
- `teaching.preparation.materiality_staleness_reconciliation`
- `teaching.preparation.finalization_readiness_gate`
- `teaching.preparation.protected_content_isolation`

Canonical route postures are `economy_maintenance`, `bounded_interpretive`, `strong_design`, `independent_validation`, and `final_reconciliation`. They are risk/maturity intents, not provider/model names.

A cheaper route cannot cross a gate requiring independently qualified stronger review. Strong/final review must receive enough primary authoritative evidence to overturn earlier preliminary conclusions.

Forecast assessment planning never creates Assessment Eligibility. Protected future formal-assessment candidates/keys/rubrics/validator traces remain isolated from teaching/practice/student contexts. Item PASS does not imply whole-paper PASS. Deadline proximity cannot lower readiness requirements. Locked/exposed formal packages do not continue progressive mutation.

PPL reuses the Scheduler; it never becomes a second Scheduler.

## Failure boundary

T0 deterministic state continues from domain/event rules during AI outage. Invalid T1 may use a safe communication fallback. Invalid T2 cannot mutate evidence. Invalid T3 cannot activate/lock consequential state. Invalid T4 cannot finalize an official mark.

KIWI-caused AI/orchestration failure cannot become a student penalty.
