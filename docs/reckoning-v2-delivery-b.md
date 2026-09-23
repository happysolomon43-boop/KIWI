# Reckoning V2 — Delivery B: Shadow Intelligence

Delivery B implements Phases 5–8 only. It does not make Reckoning V2 authoritative.

## Phase 5 — Deterministic risk engine

`services/reckoning/risk-engine.js` now scores card/concept risk using normal code.

The initial version combines:

- current KIWI card state;
- Bubble-critical membership;
- learning debt;
- verification status;
- FSRS retrievability when available;
- FSRS stability;
- overdue duration;
- subject exam proximity;
- recent exam misses;
- recent Again/Hard responses.

Risk output is bounded to 0–100 and includes explicit reason records with their contribution. Identical inputs/configuration produce identical results.

Initial state bases and modifiers live in `services/reckoning/config.js`, not scattered through route code.

## Phase 6 — Evidence planner in shadow mode

The planner remains conservative:

- one source card = one evidence unit;
- no AI semantic clustering controls lockout assessment;
- Critical, High and Supporting classifications come from deterministic risk;
- healthy controls are sampled deterministically;
- Critical units require one later independent confirmation;
- soft question budget is bounded;
- hard cap remains 30.

The existing legacy Reckoning trigger still computes its existing `questionCount` first and creates the legacy session first.

Only after that durable legacy state exists, `setImmediate` schedules the shadow planner. Shadow failure is caught and cannot fail the learner's trigger request.

The shadow planner may persist:

- `engine_mode = SHADOW`;
- planner/config versions;
- soft/hard budgets;
- per-card risk evidence in `reckoning_evidence`.

It deliberately does not change `engine_version`, legacy `question_count`, lockout, scoring, or pass/fail.

## Historical evidence inputs

The shadow runner uses the live KIWI schema:

- recent Again/Hard responses from `review_logs.response`;
- recent incorrect exam evidence from `exam_questions.is_correct`;
- FSRS stability and last-review timestamp from `cards`.

The FSRS retrievability calculation matches KIWI's existing exponential forgetting curve:

`R(t,S) = 0.9^(t/S)`.

## Phase 7 — Blueprint-driven question generation

`services/reckoning/question-bank.js` creates explicit question-family blueprints.

Critical evidence receives blueprint slots for:

- Diagnostic;
- Challenge;
- Confirmation.

High evidence receives:

- Diagnostic;
- Challenge.

Supporting evidence receives a Diagnostic.

Healthy sampled controls receive Control blueprints.

KIWI chooses all of those roles before AI is called.

When generation is invoked, content goes through the existing centralized `RECKONING_CBT` task. The model receives one blueprint and source snapshot and is instructed to write exactly one grounded four-option question.

Delivery B does not call this generator from the live Reckoning flow yet.

## Phase 8 — Strict validation

Structural validation rejects:

- missing/short stems;
- anything other than four options;
- blank options;
- duplicate options;
- placeholder options;
- invalid correct-answer mappings;
- role mismatch;
- Challenge/Confirmation stems that are too similar to the previous question.

Semantic validation fails closed unless a semantic reviewer is provided.

The provided AI semantic-review adapter routes through the existing centralized `CBT_QUESTION_AUDIT` task and asks for explicit checks of:

- source grounding;
- one defensible best answer;
- variant distinctness.

Generated questions are not accepted merely because JSON parsed successfully.

## Delivery B authority boundary

Delivery B does **not** implement:

- adaptive question scheduling;
- per-answer evidence transitions;
- one-way adaptive exam navigation;
- recovery score/pass logic;
- SRS consequences;
- Pressure/KS outcome integration;
- repeated-attempt partial recovery;
- adaptive frontend changes.

Those belong to later deliveries.

## Completion criteria

Delivery B is complete when:

1. deterministic risk scoring is versioned and tested;
2. planner output is deterministic and bounded;
3. live Reckoning invokes only non-authoritative shadow analysis;
4. shadow failure cannot change legacy Reckoning behavior;
5. blueprints encode Diagnostic/Control/Challenge/Confirmation roles;
6. generation routes through the centralized AI orchestrator;
7. structural and semantic validation fail closed;
8. CI passes with legacy Reckoning and normal CBT integrity tests still green.
