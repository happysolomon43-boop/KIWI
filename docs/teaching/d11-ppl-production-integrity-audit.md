# PPL production audit: inheritance cancellation and transaction integrity

## Confirmed production incident (2026-10-09)

After PR #324, an approved rescheduled Class had an original validated, same-duration Blueprint, but its specific `teaching.class.preparation_reconcile` event repeatedly returned PostgreSQL `23502`, while an independent Class-runtime sweep seeded a fresh PPL workspace. The Class could therefore appear to be preparing but did not inherit its already-validated lesson.

Production Postgres error logs identified the **exact** constraint: `null value in column "next_attempt_at" of relation "event_outbox" violates not-null constraint`. The D11 inheritance cleanup had written `next_attempt_at=null` while cancelling obsolete `teaching.preparation.%` events. `teaching_runtime.event_outbox.next_attempt_at` is NOT NULL in both active KIWI databases. The attempted update aborted the **entire D11 inheritance transaction**, so the replacement Blueprint could not commit.

### Corrected behavior

- The D11 inheritance cleanup sets obsolete PPL outbox events to `CANCELLED` without clearing their required `next_attempt_at` timestamp. Workers only claim `PENDING` and eligible `RETRY_WAIT` jobs, not `CANCELLED` jobs. Other fields (including `last_error_code` and existing scheduled time) remain auditable.
- It transitions PPL review due events to `SUPERSEDED`, with a valid `SUPERSEDED` resolution and cleared claim fields. It **does not** clear their required retry timestamp.
- D11 reads associated Course Plan, units, workspace, session, and Blueprint serially when using one explicit Postgres transaction client. Independent pool reads remain parallel. Reschedule predecessor/successor timetable slots are also read serially under the same transaction. This eliminates concurrent `client.query()` calls that PostgreSQL's Node driver has deprecated and that may break in pg@9.
- Inherited provisional maturity moves stay non-final and must pass the same deterministic `evaluateWorkspaceTransition` gates. Every update now checks its expected `state_version` and active lifecycle and requires a returned row. Any race fails closed with `TEACHING_D11_PPL_INHERITANCE_VERSION_CONFLICT`, rolling back all partial work.
- The existing D11 authority fences, original Class/attendance immutability, per-workspace AI budgets, no-stale-output rules, model qualification, live start time, and D28 audit remain intact. No academic write or timetable reschedule is performed to repair this bug.

### Verification

The D11 unit tests assert safe cancellation and serial single-client SQL reads. The new integration test uses a nonproduction database only, inserts synthetic outbox/due-event rows within a transaction, executes the corrected terminal-status updates, verifies timestamps remain non-null, and **ROLLBACKs** test records. This is important because ordinary mocked SQL tests cannot discover actual Postgres NOT NULL violations.

The skipped or failed original historical Class is never marked taught by this repair. For the next Class, validate that the D10→D11 inherited Blueprint commits under the replacement Class's correct authoritative timetable and that the ordinary PPL/Controller transition completes.
