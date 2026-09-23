# Reckoning V2 — Delivery D: Consequence Finalization

Delivery D completes the backend finalization boundary after Delivery C has collected enough evidence. It intentionally does not activate V2 for current learners and does not add the adaptive frontend or final-report presentation.

## Authority boundary

Delivery D retains the same fail-closed authority rule:

- `engine_version = 2`
- `engine_mode IN ('PILOT', 'LIVE')`

No existing Reckoning is converted to either mode.

## One learning consequence per evidence/card

Adaptive Reckoning questions never run the ordinary per-question exam SRS loop.

Final card effects are derived once from terminal evidence and are committed in the same transaction as `learning_effect_applied_at`.

### Clean recovered

A clean Diagnostic/Confirmation recovery does not promote the card, change its stage, grant verification, or manufacture mastery.

### Recovered after remediation

A concept that failed before later recovery:

- keeps its current stage;
- receives an earlier follow-up review no later than three days from finalization;
- keeps an already-earlier review date;
- loses VERIFIED status when that verification is now overconfident;
- does not receive a repeated penalty for the number of adaptive variants used.

### Unresolved

An unresolved source card:

- loses at most one stage;
- never falls below Stage 1;
- has repetition reset;
- has verification cleared;
- is due urgently, no later than one day from finalization;
- preserves an already-earlier review;
- preserves an already-more-severe risk state such as DANGEROUS/GHOST/STUCK/AVOIDED, otherwise becomes STUCK.

### Nonterminal evidence

UNTESTED, PROVISIONAL, CHALLENGE_REQUIRED and CONFIRMATION_REQUIRED evidence receives no final card consequence and is not marked as applied. This is required for failed Reckoning retries: already recovered concepts retain their work, while unfinished concepts remain eligible for future evidence.

## No fake mastery

Correct adaptive Reckoning questions are excluded from the ordinary exam-history signal that can grant VERIFIED status. Reckoning recovery therefore restores trust without manufacturing Stage 5, VERIFIED, Mastered, or 100 KS.

## Exam closure

Finalization closes the linked adaptive exam using persisted answers only:

- `score_pct` stores raw accuracy for understandable history;
- `correct_answers` and `total_questions` are derived server-side;
- completion timestamp and duration are persisted;
- no client-supplied final score is trusted.

## Evidence-authoritative Reckoning completion

The existing Reckoning Pressure/failsafe/reward machinery remains authoritative for consequences outside cards, but adaptive pass/fail is supplied by the recovery engine:

- V2 survival uses `recovery.survived`, never a raw percentage threshold;
- surviving retains the existing Pressure relief behavior;
- failing retains the existing +Pressure/retry/failsafe behavior;
- the six-failure 90% KS failsafe is preserved;
- legacy numeric Reckoning completion still uses the existing 70% rule unchanged.

This means an 85% raw score with an unresolved Critical concept fails, while the raw percentage remains visible in exam history.

## KS

Learning effects are committed before KIWI recomputes the post-exam Knowledge Score. Clean recovery cannot inflate KS because it makes no positive card-state mutation. Remediated/unresolved effects are reflected naturally by the existing state-derived KS engine.

Adaptive exam questions are not allowed to create VERIFIED state as a side effect of ordinary exam-history recomputation.

## Crash and retry safety

Finalization has two durable stages:

1. transactionally apply terminal card effects, mark each evidence effect applied, close the adaptive exam, and persist FINALIZING;
2. run existing idempotent Reckoning/Pressure/KS completion, then transition the engine to COMPLETE.

If the process dies between stages, a retry sees the persisted `learning_effect_applied_at` timestamps and cannot demote or reschedule a card twice.

Failed adaptive attempts retain the completed exam ID in `last_failure_exam_id` so the same finalization can be recovered after the surrounding Reckoning row clears `exam_session_id` for retry.

## Reconciliation

Crash recovery for an explicit V2 PILOT/LIVE session in FINALIZING re-enters adaptive finalization. It never reconstructs V2 survival from `score_pct >= 70`.

Legacy reconciliation retains its previous raw-score behavior.

## API

Delivery D adds:

`POST /api/exams/:id/reckoning/finalize`

This endpoint is protected by the same V2 Pilot/Live engine guard as Delivery C. Existing legacy/shadow sessions cannot use it.

## Not included in Delivery D

Delivery D does not:

- activate V2 for current learners;
- implement V2 prepare/start/generation authority;
- change deferral or Buffer semantics;
- redesign the frontend;
- render checkpoint teaching UI;
- render the final adaptive diagnostic report.

Those remain outside this delivery.
