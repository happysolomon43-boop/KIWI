# KIWI D14 — Raise Hand and AI Teacher response lifecycle

This extension addresses Issue #303. It replaces passive classroom messaging with the **✋ NEED HELP?** control at the right edge of the active Classroom, around 37% of the viewport height. The button opens a focused, keyboard-accessible question sheet; it never creates an automatic running chat or interrupts the Board.

## Authority and data

The student submits an authenticated `NEED_HELP` interaction with a bounded question (up to 2,000 characters) and an idempotency key. In a single PostgreSQL transaction, D14 creates the interaction, its `teaching_classroom_help_requests` record and a committed-domain outbox event (`teaching.class.help_requested`). Service-role-only permissions and RLS protect the new table; student responses never acquire academic authority. The Controller's locked row serializes concurrent submissions. Only one question can be outstanding per student/Class, with a 12-second cooldown after previous requests.

D14's published-event handler claims the request atomically. The helper's states are `RAISED`, `PROCESSING`, `DEFERRED`, `ANSWERED`, `DECLINED`, `CANCELLED`, and `UNAVAILABLE`. These states are queryable through the student's Classroom snapshot, not model-generated chat history.

The registered capability is **`teaching.pedagogy.natural_teacher_explanation_generation`**, a T1, frozen TPF-08 instruction capability. It executes via the authorized D31 Teaching release, D05 Teaching Orchestrator, D03 prompt control, and central KIWI AI routing. The student's question is supplied in a D03-wrapped **untrusted** context lane. The trusted lane binds the current Class, validated Lesson Blueprint and Course Plan. A model may propose only `ANSWER_NOW`, `DEFER`, or `DECLINE`, with bounded Teacher wording, delay and explanation. A malformed or uncertain output is not published.

## Timing and protected work

`ANSWER_NOW` is suitable for short, relevant conceptual explanations or permitted hints. An answer is not allowed to change Class Controller state, attendance, grades, mastery, assessment rules or schedule. `DEFER` schedules an actual D02 durable review event for 1–3 minutes later. Recovery is bounded to three attempts, never an infinite retry. `DECLINE` explains the boundary and redirects appropriately. When AI is unavailable or a response fails validation, the student sees a truthful `DEFERRED` or `UNAVAILABLE` state; KIWI never fabricates a successful Teacher answer.

Submission is rejected during assessments, graded classwork, Break, interruption and obsolete/closed Class states. An already raised question is retired rather than answered if its Class changes into a protected or superseded state. Class closure retires pending requests while preserving historical answered Teacher communications.

## Publication and cancellation

The AI result is advisory until D14's **single-transaction Teacher publication** accepts it. The publication rechecks the current Course state/version, Class schedule and approved timetable, current Course Plan version, latest Lesson Blueprint version, Class Controller/session version and outstanding request status. A stale model answer cannot create a student-visible Teacher communication. The successful `ANSWERED` status and Teacher communication ID commit together, with one idempotency key per help request.

D05's revocable-parent AbortSignal path (Issue #305/PR #306) can interrupt stale model calls where the provider supports it; D14's final SQL authority fence remains essential even when provider-side cancellation races or fails.

## Deployment and verification

Apply `migrations/20261008_teaching_d14_raised_hand_help_requests.sql` **before** running the new Classroom backend. D14 startup readiness checks require the table, so deploying code without the schema intentionally fails closed. Never expose service-role grants to `anon` or `authenticated` clients.

Coverage includes `tests/teaching/unit/d14-raised-hand.test.js`, `tests/ai/teaching-d31-classroom-help.test.js`, `tests/teaching/unit/d14-cancellation-authority.test.js` and D14 isolated integration-database checks. Automated tests validate boundaries with controlled AI outputs; they do not by themselves prove production provider inference, routing qualification, or end-user rendering. Those require separately verified authenticated live-Class execution.
