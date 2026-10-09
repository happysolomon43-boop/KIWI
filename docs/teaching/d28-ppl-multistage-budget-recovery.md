# D28 lesson preparation budgets: genuine multi-stage AI teaching

## Incident, 9 October 2026

A live rescheduled PHY101 Class remained in an approved timetable window but required its genuine D11 PPL preparation to run after its original preparation was invalidated. The D28 operational budget held the Candidate stage with `TEACHING_D28_PPL_BUDGET_EXHAUSTED`. The Class workspace had accumulated **84,905 recorded tokens**, while the D28 **80,000-token default per workspace** was calibrated too low for an entire three-stage lesson planning flow (Skeleton, Candidate, Pre-Lock Ready). Real approved D31 calls for the Skeleton step alone recorded 27,844, 27,353 and 29,708 tokens across attempts. No Class session was fabricated or started by this repair.

## Operational correction

The default **per-workspace** safety ceiling is now 240,000 model tokens, 12 model-call units, and six scheduled review admissions. Defaults were reviewed against the production usage of `~30,000` tokens per validated AI planning call, three required stages and a bounded repair allowance. The preexisting cost, concurrency and candidate limits remain unchanged. All five upper bounds remain finite and environment-configurable using the existing `TEACHING_D28_PPL_*` keys. A stricter deployment override remains authoritative. This is an increased, audited *budget*, **not bypassed enforcement**.

When the D28 runtime admits a model call, it still writes its usage claim and completion record with the actual recorded model tokens and immutable provenance. **Only accepted admissions** now count toward `scheduled_reviews` and `candidates`. Before this correction a `FAIL_SAFE_BUDGET_EXHAUSTED` audit row could count as another review and Candidate, causing repeated error screens to consume remaining quotas despite **zero model calls**. Denied events are still retained in the audit table but never spend those admission counters.

The safe exception now includes its denied reason (e.g. `BUDGET_EXCEEDED:totalTokens`) and explains that no model call ran. The system still fails closed when a real per-workspace cap is reached, and does not reclassify invalid lesson output as verified or reset academic state, class times or audit usage.

## Verification

Run `node --test tests/teaching/unit/d28-ppl-budget-recovery.test.js tests/teaching/unit/d28-ppl-ai-controls.test.js` plus the full D05/D11/D14/D28 and integration workflows. The new tests replay the actual stored consumption, verify that subsequent bounded Candidate/final stages can be authorized, demonstrate continued rejection after real exhaustion, and confirm that multiple rejected admissions do not consume future work quotas.

Live Class recovery is still subject to the existing D11 approved-Course/Timetable/Plan/Blueprint authority, real AI validation, live time window and the PPL D28 admission guards. A new Class that has already expired may not be retroactively taught.
