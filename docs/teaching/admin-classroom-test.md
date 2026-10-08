# Admin Test Classroom — direct existing KIWI Classroom

## Current admin experience

The primary Test Classroom page at `/admin-classroom-test.html` now uses **the existing authenticated KIWI D14 Classroom**, directly. It no longer invokes the old isolated-runtime gateway or requires a second Render service/database to display real Classes.

1. An admin must be signed in to the real KIWI account.
2. `GET /api/teaching/admin/classroom-test/source-course` verifies the live role from the database and that the configured Course is ACTIVE and owned by the admin. It returns safe read-only Course metadata and `execution: NORMAL_KIWI_CLASSROOM`.
3. The page uses the normal authenticated `GET /api/teaching/courses/:id/classes` to show the exact existing scheduled and historical Classes.
4. The existing `public/teaching-classroom.js` renders those Classes. No synthetic teacher messages, separate Class records or alternate controller are used.
5. **Preview · Read only** on upcoming Classes calls `GET /api/teaching/classes/:id/classroom` only; it does **not** call `POST /classroom/enter`, start the controller or record attendance. The UI enforces read-only mode throughout.
6. **Enter Classroom** becomes available only when the normal KIWI time and authority checks permit entry, and it uses the real `POST /classroom/enter` route. This is a **real** class participation event and can change actual attendance and academic records. The page warns about this distinction.
7. **Past Classes** uses normal KIWI historical read-only review.

The production Course, timetable, Course Plan, Blueprint, Board, Workspace and Note information are never copied, duplicated or rescheduled by Test Classroom.

### Activation

Production service variable `KIWI_CLASSROOM_TEST_SOURCE_COURSE_ID` selects the read-only Course reference. The configured source is PHY101 (`ef94c6bf-7fa7-4932-a2c5-0fddf757de8f`).

### Scope and limitations

This change solves the user's **unavailable Test Classroom screen** by connecting to the *already deployed and working KIWI Classroom*. It does **not** enable an interactive AI-led session ahead of the official class time: preview before the start shows the authentic pre-class state. It must never be presented as a time-travel simulation or a separate isolated sandbox.

The isolated real-engine gateway introduced in PR #316 remains as a dormant optional backend capability, gated by its separate attestation, but is **not used by this page**. If a future test environment is requested for full unattended rehearsals with no academic writes, it should use that isolation design rather than weakening production Class timing and academic authority.

### Regression checklist

- Non-admin source-course request returns 403; unsigned requests return 401.
- Configured admin can see an active Course that belongs to the account and not another user's Course.
- Direct admin page doesn't call `/admin/classroom-test/status` or sandbox proxies.
- Preview before opening is GET-only and read-only; no attendance JOIN or controller mutation.
- Real Class entry remains blocked until scheduled start and follows KIWI D11/D14.
- Standard student Classroom behavior and menu remain unchanged.
