# D14 Classroom: resilient entry, mobile Board reading and accessible help

## Root cause and impact

A Classroom GET or JOIN could exceed the shared client 30-second timeout during live teaching. Previously D14's `open()` wrapped the initial snapshot, idempotent JOIN, and subsequent refresh in one catch block that replaced the **entire Classroom** with a fatal "Classroom unavailable" screen. A network timeout cannot establish that D11 has interrupted, closed or cancelled a Class. It must not destroy an already-loaded Board or prevent reading.

In parallel, every ordinary snapshot refresh rebuilt the Classroom DOM without restoring the primary overlay scroll position, so mobile learners could lose where they were reading. The floating 37%-height "Need Help?" button covered a significant part of the Board. Fixed 16px Board type offered no decrease control, and Board scene history required paging across scenes instead of vertical reading on phones.

## Implemented behavior

- A single in-flight GET is shared across the 12-second refresh loop. An initial timeout leaves a reconnecting Classroom with **Try again** and **Return to Course**, plus ongoing bounded polling. Successful reconnect uses the same authorized Class ID. After a snapshot has loaded, later GET timeouts keep that snapshot visible and show a small status only.
- Session-scoped `AbortController` cancels GET/JOIN transport when the Classroom closes, and Class/host identity checks reject late responses from prior Classroom instances. This is transport recovery, not D11 lifecycle recovery; no timetable, class authority or Controller events are fabricated.
- JOIN attempts only when the current D11 Controller is ACTIVE, never in read-only review. The read-only D14 `hasEntered` field comes solely from persisted existing JOIN interactions and avoids repeated POSTs on return. JOIN retains D14's existing idempotency key and D15 attendance authority. A transient JOIN error keeps teaching available and provides an explicit **Check / Retry Join**; a denied 4xx authority response is not retried blindly.
- Whole-Class vertical overlay scroll positions survive re-renders. On screens up to 699px, all permitted Board scenes are displayed **in chronological vertical order** in one continuous page; protected mode still forbids Board history and desktop scene navigation stays unchanged. The separate expanded Board retains its native vertical scrolling.
- Board toolbar offers A− and A+ sizes with 0.82, 0.9, 1 and 1.12 multipliers. This preference is only a local client reading setting; text inputs remain at browser-safe sizes, and it never changes academic content.
- The raised-hand affordance is a narrow right-edge touch target at rest, with label revealed on pointer hover or keyboard focus on larger screens. Touch users tap directly to raise their hand. It remains only in instructional modes authorized by D14. Reduced-motion and forced-color modes retain usability.

## Non-negotiable invariants

Never record attendance on snapshot GET or read-only preview; don't pretend a successful JOIN if POST timed out. Never let a transport failure end or interrupt a D11 Class. Never bypass D14 protected-mode authorization, D11 Blueprint validation, D12 teaching progression or D15 attendance. Preserve Notebook drafts during ordinary non-authority-changing refreshes and retain the existing canonical CLASS ID.

## Verification

Run the new D14 mobile recovery regression with the full D14/D11/D12/D15/D05/D28 and web-build gates. Inspect production after rollout separately to confirm real response latency and browser behavior under mobile 4G; unit/CI success alone cannot establish carrier-network performance.
