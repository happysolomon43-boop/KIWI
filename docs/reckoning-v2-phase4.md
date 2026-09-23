# Reckoning V2 — Phase 4 Lockout and Access Safety

Phase 4 protects the existing Reckoning entry/recovery path before any adaptive engine is allowed to influence behavior.

No new access path is introduced.

## Existing production behavior retained

The current `reckoningLockout` middleware already implements the intended safety model:

- Brain is exempted before any Reckoning database lookup.
- Exact Settings backing endpoints are exempted before any Reckoning database lookup.
- A live server-side deferral temporarily permits normal KIWI use.
- Once the deferral deadline expires, global lockout resumes automatically.
- Mandatory Reckoning generation is allowed only when the request is explicitly marked as Reckoning generation.
- Once an exam exists, only the exact `active.exam_session_id` is exempted.
- Past and ordinary CBT exams fall through to the global 423 response.
- A lock-state verification error returns 503 rather than silently calling `next()`.
- The locked response tells the client that Brain and Settings remain available.

Phase 4 deliberately does not refactor this critical middleware. The safest change before Delivery B is stronger regression coverage around the behavior that already works.

## Why this matters

Reckoning V2 will eventually add more internal assessment states. None of those states may accidentally alter the surrounding safety rule:

> KIWI may lock ordinary features, but it may not lock the learner away from the exact remedy required to resolve the lockout.

## Delivery A boundary

Phase 4 does not:

- activate the V2 engine;
- change Brain UI;
- change Deferral or Buffer;
- change pass/fail;
- change Pressure or KS;
- change question generation;
- change exam navigation.

It only freezes and tests the access/lockout contract that later phases must respect.
