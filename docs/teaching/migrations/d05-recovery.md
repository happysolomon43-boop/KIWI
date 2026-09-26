# Teaching D05 migration recovery

D05 adds only operational orchestration/audit and transactional publication state in `teaching_runtime`. It does not move Course, Scheduler, Assessment, Gradebook, SKM, Attendance, Request, Progression, Teacher Identity, or Preparation artifact truth out of their existing owners.

Before recovery, stop D05 orchestration and event-outbox workers. Do not drop D02 `due_events`, `event_attempts`, or `ai_execution_audit`, and do not alter D04 public/preparation/protected academic state.

A controlled rollback may drop `teaching_runtime.orchestration_executions` and `teaching_runtime.event_outbox` after queued publication records have either been safely published or deliberately exported for recovery. Revoke the D05 `teaching_domain_service` SELECT/INSERT grants and policies on `event_outbox` and `due_events` if the D05 runtime is fully removed.

Never recover by exposing `teaching_runtime`, `teaching_preparation`, or `teaching_protected` to browser roles; never grant browser authoritative mutation; and never discard an outbox event whose corresponding authoritative mutation already committed without first reconstructing/re-publishing that event through the recovery path.
