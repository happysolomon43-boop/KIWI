# D11 route-held live PPL recovery — audit follow-up

The D11 clock-owner intentionally inserts an `INTERRUPTED` Class session at the scheduled start if there is no validated Blueprint and the model route is held. It does **not** represent completed teaching: its `lesson_blueprint_id` is null and progress arrays are empty.

Previously, late-start PPL recovery rejected **all** non-null sessions, including these route-held sessions. This left a contradiction: KIWI kept a Class window open for safe recovery but refused to finish the three-stage validated preparation after the start event.

## Corrected authority gate

`lateStartRecoveryEligibility` may authorize an existing Controller only when **all** are true:
- the session lifecycle and instructional substate are both `INTERRUPTED`;
- its Blueprint is still unbound, with no resume target and no completed segments, objectives, or evidence;
- session snapshot Course state, Class schedule and approved timetable versions match the live Class;
- the same Class is SCHEDULED on an ACTIVE Course and APPROVED timetable;
- server clock remains within 45 minutes of Class start, before its end, and at least 20 minutes of Class time remain.

PPL artifact capture rechecks the *same* conditions in the locked D11 repository transaction. An active/closed/ordinarily interrupted Controller or a Controller with academic progress cannot use this path.

The AI executes the normal D31/D05/D28 PPL route; TPF-05 output is validated against remaining live time. PPL must complete its normal maturity/finalization/handoff gates. D11 then binds the new Blueprint to the held session without inventing historic outcomes. The existing D11 resume command transitions from `INTERRUPTED` to `OPENING` only after the new Blueprint and expected Controller version are verified. The genuine D14 Class JOIN comes after the resume.

This path does not bypass the existing time window, model budget, Blueprint validation, attendance authority, or academic evidence rules. It makes the already-deployed route-held reliability behavior internally consistent. An expired Class is not restarted retroactively, and a student may elect not to resume.
