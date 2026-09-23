# Reckoning V2 — Phase 3 Question-Metadata Compatibility

Phase 3 formalizes the boundary between normal CBT questions and future adaptive Reckoning questions.

The physical columns were intentionally added in the Phase 2 persistence migration because the evidence foreign key and question metadata form one database contract. Phase 3 adds the compatibility guarantees around them.

## Normal CBT invariant

Normal CBT does not know Reckoning V2 exists.

The following columns are optional and have no default that changes an ordinary exam insert:

- `reckoning_evidence_id`
- `reckoning_role`
- `variant_index`
- `reckoning_blueprint`
- `is_unlocked`
- `unlocked_at`
- `response_time_ms`
- `evidence_effect`

A normal CBT row can continue using the exact existing insert shape.

## Index isolation

Reckoning-specific question indexes are partial and only include rows where `reckoning_evidence_id IS NOT NULL`.

This keeps the new adaptive lookup path separate from the normal CBT population.

## Existing question-integrity system

The current student flag / AI audit fields remain owned by the existing CBT integrity implementation:

- `flagged_by_student`
- `flagged_at`
- `ai_audit_status`
- `ai_audit_result`
- `ai_audit_reviewed_at`
- `bonus_awarded`

Phase 3 does not redefine them. Later Reckoning adjudication will consume their result without rewriting the learner's historical answer.

## Production wiring

The root backend still has no references to Reckoning V2 question metadata. No adaptive unlocking, scheduling, answering, or recovery logic is active.

## Phase 3 exit condition

Phase 3 is complete when:

1. all V2 question metadata remains optional for normal CBT;
2. Reckoning indexes are isolated to V2-linked rows;
3. legacy backend code does not reference the new fields;
4. existing flag/audit fields are not duplicated or replaced;
5. compatibility tests pass in CI.
