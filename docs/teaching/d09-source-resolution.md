# D09 Canonical Source Resolution Record

Resolved before D09 code modification under the accepted D08 → D09 handoff.

Precedence/routing used: Implementation Context Pack v1.9; Phase22 Final Implementation Freeze v1.5 and manifest; Phase19 Delivery Roadmap v1.6 REVISED; Delivery Task Map v1.7; Master Implementation Backlog 9.7; then more-specific domain/runtime/authority contracts and the accepted D08 → D09 handoff reconciled with live repository state.

Material governing sources read:
- System Blueprint 11.7: Semester calendar layers; hard/soft constraints; stable timetable; recovery headroom; instructional-load pacing; progress-truth separation; schedule debt; rolling horizon; ahead/behind; safe load; revision/assessment capacity; global Scheduler; impossible states; recovery/protected periods; Stage 4/5 UI; timezone/travel; PPL horizon reuse.
- Capability Registry 1.3 and Capability Traceability Matrix 1.3: deterministic schedule feasibility/impossible-state capabilities; TPF-10/TPF-05 advisory bindings; Scheduler and Global Scheduler ownership.
- Intelligence Inventory/Authority Spec Phases 4–6 v1.4 PPL: Scheduler authority and non-authoritative model output.
- Orchestrator/Event Runtime Spec Phases 7–8 v1.3: server-time authority, stale-state revalidation, durable/idempotent events, no transaction across model work.
- Progressive Preparation Lifecycle Standard v1.2: scheduling reuses the existing rolling horizon; PPL is coordination only.
- Critical Invariant Trace Map v1.3: INV-AUTH-01, INV-EVENT-01, INV-AI-STATE-01, INV-FAIL-01, INV-COVERAGE-01, INV-CAP-01, INV-EVAL-01 and PPL stale/deadline/authority invariants.
- D06 decision registry: TCH-0075 recovery-headroom.v1 and TCH-0076 server-clock boundary.
- Frozen TPF-10 Scheduling & Workload Planning v1.1 and TPF-05 Lesson Planning & Replanning v1.3 contracts; bodies unchanged.
- Implementation Change Control Protocol v1.0; no authority-changing contradiction was found.

Live-state reconciliation:
- D09 started from main c78ac0a27933744b9a8a8a47576c63715eeb04de, preserving 28 post-D08 commits.
- Production Supabase migration head was the D08 post-migration hardening migration.
- Existing D04 Semester/Class persistence, D05 durable outbox/event runtime, D08 Course Plan/Coverage and D06 policy are extended rather than duplicated.
- Vercel and Render production were live on c78ac0a at D09 start.
- Teaching model-backed routes remain UNQUALIFIED until D30; D09 core does not depend on them.

No frozen-design contradiction requiring change control was identified.
