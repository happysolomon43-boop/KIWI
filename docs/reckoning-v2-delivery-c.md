# Reckoning V2 — Delivery C: Adaptive Execution Core

Delivery C implements the deterministic execution layer only. It does not activate V2 for existing learners and does not apply SRS, KS, Pressure, rewards, or final-report UI consequences.

## Authority boundary

Current production Reckonings remain Legacy/Shadow.

The adaptive endpoints accept a session only when both are true:

- `engine_version = 2`
- `engine_mode IN ('PILOT', 'LIVE')`

Delivery C does not convert any current row to either mode.

## Evidence transitions

The backend, never the browser, owns evidence changes.

Critical:
- clean Diagnostic correct -> Provisional;
- Provisional requires delayed Confirmation;
- Diagnostic miss -> delayed Challenge;
- successful Challenge -> delayed Confirmation;
- failed Challenge -> Unresolved;
- Confirmation correct -> Recovered;
- Confirmation miss -> Unresolved.

High:
- clean Diagnostic correct -> Recovered;
- Diagnostic miss -> delayed Challenge;
- Challenge correct -> Recovered;
- Challenge miss -> Unresolved.

Supporting:
- clean Diagnostic correct -> Recovered;
- Diagnostic miss promotes the evidence into the High flow.

Control:
- correct -> healthy/recovered evidence;
- miss -> `discovered_by_control = true`, promoted to High flow.

A terminal Recovered/Unresolved/Invalidated evidence row cannot be mutated again through the evidence engine.

## Spacing

A revisit is normally not eligible until two unrelated questions have occurred.

Delivery C adds the generic persisted field:

`reckoning_evidence.next_eligible_question`

This replaces the need to overload the older Confirmation-specific spacing column.

The scheduler first looks for unrelated valid work. If the persisted hidden bank has no other possible question, spacing may be explicitly relaxed rather than deadlocking the learner.

## Bounded paths and hard cap

A concept never receives arbitrary repeated variants.

Question families remain bounded by the hidden bank:
- Critical: Diagnostic, one Challenge path when needed, one Confirmation;
- High: Diagnostic, one Challenge when needed;
- Supporting/Control: primary item plus one hidden Challenge if newly exposed as weak.

The global hard cap remains 30 answered questions.

## Idempotent adaptive answer endpoint

Delivery C adds:

`POST /api/exams/:id/reckoning/answer`

The server:
1. verifies the session is an explicit V2 Pilot/Live session;
2. locks the Reckoning session, current question and evidence inside a transaction;
3. verifies the submitted question is the single persisted unlocked question;
4. treats an already-answered question as an idempotent retry;
5. computes correctness internally from the stored answer key;
6. records response time as supporting telemetry only;
7. applies exactly one evidence transition;
8. chooses/unlocks the next question;
9. persists the exact current question and state version before committing.

The client cannot specify evidence IDs, evidence state, correctness, next role, or next question.

## Resume endpoint

Delivery C adds:

`GET /api/exams/:id/reckoning/state`

The response is rebuilt only from persisted Postgres state and contains:
- engine/review phase;
- questions used;
- current block/state version;
- evidence summaries;
- recovery progress;
- answered history;
- exactly one currently unlocked question.

Hidden future questions and their answer keys are never returned.

Answered history can include the finalized answer/explanation because those answers are already irreversible.

## Recovery scoring

Raw accuracy remains visible but secondary.

Per-evidence contribution:
- clean Recovered = 1.0;
- Recovered after remediation = 0.8;
- Provisional/awaiting Confirmation = 0.5;
- Unresolved/untested = 0;
- Invalidated evidence is excluded.

Each value is weighted by deterministic `risk_score`.

The first Delivery C recovery decision requires:
- no unresolved Critical evidence;
- recovery score >= 75;
- raw accuracy >= 65%;
- enough distinct evidence units have been observed: five where available, or every eligible evidence unit when the subject contains fewer than five.

A high percentage can therefore never hide an unresolved Critical concept.

## Finalization boundary

When evidence is sufficient, no valid questions remain, or the hard cap is reached, Delivery C moves the internal engine to `FINALIZING`.

It intentionally does **not**:
- complete the surrounding legacy Reckoning row;
- change Brain Pressure;
- change KS;
- apply SRS/card consequences;
- award rewards;
- render the adaptive UI/final report.

Those effects remain a later delivery so the execution engine can be validated independently.

## Checkpoints

The engine records block progress in groups of five and reports `checkpointDue` from persisted state. Delivery C does not render checkpoint UI.

## Safety window

The configured adaptive safety window is 45 minutes, but Delivery C does not change the existing production timer/forfeit behavior because no adaptive session is active yet. Time alone never changes a correct answer into an incorrect one.

## Delivery C completion criteria

1. evidence transitions match the design;
2. concept paths are bounded;
3. revisit spacing is persisted and deterministic;
4. one active question is server-authoritative;
5. duplicate submissions are harmless;
6. restart state comes entirely from Postgres;
7. hidden future questions do not leak;
8. recovery scoring blocks unresolved Critical evidence;
9. hard cap ends deterministically;
10. legacy CBT/Reckoning behavior remains unchanged;
11. full CI passes.