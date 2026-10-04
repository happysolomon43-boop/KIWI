# KIWI Teaching D28 Runbooks, Rollback, Cost and Retention v1.0

## AI-provider outage
Keep deterministic T0/state transitions running. Do not bypass the central KIWI AI Orchestrator. T1 may use its existing safe fallback; invalid/unavailable T2 cannot mutate evidence; T3 stays draft/pending; T4 stays unfinalized. Required unqualified/unavailable PPL routes fail safe.

## Supabase outage
Stop academic writes that cannot be durably committed. Never fake autosave/submission/attendance/marks/Requests/progression in browser state. Reconcile against authoritative server version/time after recovery and use D25 fairness for KIWI-caused delay.

## Notification outage
Notification delivery is not academic truth. Retain durable due events and source facts; retry idempotently through the shared notification boundary. Notification failure cannot become lateness, absence or missed-work evidence.

## Corrupted assessment package
Quarantine it, preserve immutable package/item/version lineage and submitted evidence, raise an operational alert, and route material post-exposure defects through TPF-14 plus Assessment/Gradebook fairness owners. D28 never rewrites marks.

## Rollout/rollback
Prompt/model/policy changes are staged as version pointers with scope, authorization and reason. Prompt-family bytes stay frozen unless Change Control authorizes a new version. Provider/model choice remains central. Rollback changes allowed future version pointers; historical academic facts retain policy-at-event/version lineage.

## PPL compute
Budgets bound scheduled reviews, candidates, concurrency, model calls, tokens and cost. No material authoritative delta is a no-op. Escalation is defect-driven. A cheap route cannot cross a stronger maturity/finalization gate. Qualification failure never lowers readiness requirements.

## Retention and privacy
Operational events and reference-only quality samples are short-lived; item analytics and rollout history stay versioned for audit. Academic audit, Gradebook and evidence lineage are preserved under their owner policies. Board/transcript-like instructional content and assessment drafts follow configured purpose-based retention. Protected assessment content remains server-only.

Study Pack/note/annotation/card-facing artifacts are student-scoped. Dismissal or Subject/Course deletion suppresses unavailable student-facing artifacts while preserving necessary historical evidence, Gradebook and audit lineage. Deleted/unavailable card-owner truth is not recreated by Teaching.

## Quality and cost
Quality samples store references and validation state, never raw student responses. Token/retry/fallback/latency metrics record central execution facts. If trustworthy cost is unavailable, record `COST_RATE_UNAVAILABLE` instead of inventing a currency amount. Cost controls can defer optional/background work but cannot lower academic standards.
