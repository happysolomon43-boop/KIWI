# Teaching D05 Recovery — Orchestrator & Durable Event Runtime

D05 adds operational coordination/audit state. D04/domain tables remain academic/PPL truth.

## Preferred recovery

Use forward repair. Do not delete or rewrite D04 academic history to recover an orchestration failure.

1. Stop the D05 orchestration and outbox workers.
2. Keep the D02 durable due-event worker stopped if a runtime contract is being repaired.
3. Preserve `teaching_runtime.orchestration_executions` and `teaching_runtime.event_outbox` until replay/forensic state is understood.
4. Repair code/schema forward.
5. Reconcile claimed/retryable rows and restart workers.
6. Revalidate authoritative state before replaying any model-backed result.

## Emergency schema rollback before D05 state matters

Only after workers are stopped and a backup/export exists:

- revoke the D05 `teaching_domain_service` policies/grants on `teaching_runtime.event_outbox` and D02 `due_events`;
- drop `teaching_runtime.event_outbox`;
- drop `teaching_runtime.orchestration_executions`.

Do not drop `teaching_runtime.due_events`, D04 kernel tables, `teaching_preparation`, or `teaching_protected` as part of D05 rollback.

Never recover by enabling browser writes, granting `BYPASSRLS`, exposing protected preparation payloads, or accepting stale AI output.
