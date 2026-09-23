# Reckoning V2 — Delivery E: Activation and Adaptive Review

Delivery E closes the Reckoning V2 lifecycle and is the final delivery.

## Activation rule

Only newly triggered Reckonings are created as:

- `engine_version = 2`
- `engine_mode = LIVE`
- `engine_phase = PREPARING`
- `status = triggered`

Existing `engine_version = 1` rows remain legacy and retain their historical CBT resume path.

Creating a V2 row does not immediately create an exam and does not mark the Reckoning `in_progress`.

## Transactional preparation

The existing Begin button calls `POST /api/brain/reckoning/start`.

Preparation runs as a durable background job:

1. claim the triggered Reckoning for preparation;
2. load its real cards, states, Bubble membership and historical evidence;
3. build the deterministic evidence plan;
4. generate the bounded hidden question families through the centralized AI orchestrator;
5. structurally and semantically validate every generated item;
6. in one database transaction, persist the complete evidence profile and validated bank;
7. create the linked adaptive exam;
8. unlock exactly one initial question;
9. only then set the Reckoning `in_progress` and begin the server safety window.

If preparation fails before activation, the row remains triggered and retryable. KIWI never creates a mandatory lock whose remedy failed to initialize.

## Dedicated adaptive review surface

V2 does not use the normal CBT page.

The browser renders one persisted current question with:

- `Reckoning · Diagnostic / Control / Challenge / Confirmation`;
- a dynamic question ordinal rather than a fake fixed total;
- recovered, unresolved and recovery-evidence counters;
- elapsed review time;
- four options and one irreversible Submit answer action.

There are no numbered question dots, Previous button, normal CBT Submit Exam button or competitive countdown.

Normal CBT keeps its existing UI unchanged.

## Server-owned sequencing

The client submits only:

- current question ID;
- selected option;
- response time.

The backend verifies the persisted unlocked question, scores it, updates evidence and chooses the next action.

Future hidden questions and answer keys never enter browser state.

## Checkpoints

Every configured block boundary pauses on a persisted checkpoint.

The checkpoint shows:

- concepts recovered;
- unresolved concepts;
- concepts needing more proof;
- concise explanations from missed questions.

Continuing calls the dedicated server endpoint. The checkpoint cannot dismiss or unlock the Reckoning.

## Refresh and restart

The browser reconstructs the review from:

`GET /api/exams/:id/reckoning/state`

It does not rebuild the adaptive engine from `sessionStorage`, `tempExam` or a client-side question array.

If preparation is still running during a refresh, the browser polls the durable active-Reckoning record until an exam is linked or a persisted generation error appears.

## Safety expiry

The frontend displays elapsed review time only.

The backend retains its safety expiry. Expiry is handled server-side and can finalize an abandoned review. Slow answers are never converted into incorrect answers by time alone.

## Final diagnostic report

The final report is persisted in `reckoning_sessions.final_report` and includes:

- survival/recovery result;
- recovery score;
- raw accuracy;
- Critical unresolved count;
- recovered concepts;
- unresolved concepts;
- weaknesses discovered by Control questions;
- learning/SRS effects;
- next-review timestamps;
- verification changes;
- Knowledge Score outcome.

Passing Reckoning is not presented as mastery or automatic verification.

## Production compatibility

- Legacy Reckonings remain resumable through their existing fixed-CBT route.
- Normal CBT generation, submission and navigation remain unchanged.
- Brain and Settings remain the approved lockout recovery surfaces.
- The six-failure failsafe remains unchanged.
- Delivery D exactly-once learning, Pressure and KS finalization remains the consequence layer.

## Deployment rule

After Delivery E is merged, KIWI is deployed as one final combined A–E `main` revision.

Render receives the final backend revision.

Vercel receives a fresh production deployment of that same combined `main`; earlier partial preview deployments are not treated as the authoritative release.
