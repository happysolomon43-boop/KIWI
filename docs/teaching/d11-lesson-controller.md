# KIWI Teaching D11 — Lesson Blueprint & Teaching Controller

This document accounts for all 24 D11 tasks and the implemented owner boundaries.

- TCH-0170 — provenance-preserving Lesson Planner input assembly from current Course Plan/Learning Units/prerequisites, D09 timing/pacing, D10 Course/Class state, D07 diagnostic/VPK signals, prior Class closure facts, private Teacher Notes and governed Request signals; D13/D16 lanes remain owner-pending.
- TCH-0171 — structured TPF-05 Lesson Blueprint request/validation contract for objectives, prerequisites, representations, misconception hypotheses, examples, guided work, independent evidence opportunities, remediation branches, homework candidates, durations and stopping rules.
- TCH-0172 — deterministic scheduled-duration and minimum-safe-load validation using server-authoritative timestamps.
- TCH-0173 — explicit CORE/SECONDARY/ENRICHMENT objective and segment criticality with Course Plan Learning Unit provenance.
- TCH-0174 — deterministic configurable adaptive-reserve policy; valid Blueprints cannot allocate 100% of the Class block.
- TCH-0175 — versioned server-authoritative Teaching Controller aggregate linked to `teaching_classes`.
- TCH-0176 — explicit legal/forbidden instructional transitions with optimistic concurrency and immutable history.
- TCH-0177 — frozen Controller priority order is deterministic policy, never model prose.
- TCH-0178 — Teach → Elicit/Check → Diagnose → Respond → Verify is a typed Controller cycle.
- TCH-0179 — canonical learning/evidence descriptors are implemented separately from assistance.
- TCH-0180 — descriptors may be skipped/revisited/omitted and are not a mandatory ladder or SKM state.
- TCH-0181 — live TPF-05 replanning uses authoritative remaining time/current progress/current Controller version, then deterministic revalidation and owner commit.
- TCH-0182 — unfinished CORE objectives cannot be silently dropped; enrichment/secondary may be sacrificed first.
- TCH-0183 — early Closure requires completed CORE objectives and required independent evidence; no busywork is introduced.
- TCH-0184 — durable scheduled-end handling plus explicit overtime with immutable 15-minute maximum ceiling.
- TCH-0185 — Break is a server-timed Controller state wholly inside the scheduled Class block.
- TCH-0186 — Break expiry is replay-safe T0 automatic resume without student input.
- TCH-0187 — Closure derives an immutable actual-Class fact pack from Controller progress/evidence/history and writes no marks/mastery/Attendance result.
- TCH-0188 — Class Summary is a student-visible translation over bounded authoritative facts; TPF-19 stays route-held until D30.
- TCH-0189 — post-Class Teacher Note is a separate private artifact, not Gradebook/SKM/behavior truth.
- TCH-0190 — deterministic transition/stale-version/replay/time/interruption/terminal-closure QA.
- TCH-0191 — scenario QA covers normal flow, early finish, running late, remediation, Break auto-resume, interruption/recovery, scheduled end, overtime ceiling, upstream Request/schedule changes and model-route outage.
- TCH-0888 — accepted PPL next-Class workspaces/input bundles/artifacts/components/materiality/finalization are reused; no second PPL or Scheduler.
- TCH-0905 — prior-Class/Work/uncertainty/correction lanes are provenance-bounded; Work/SKM remain owner-pending and active-assessment answers are excluded.

## Durable interfaces and ownership

The D11 migration extends the D04 Lesson Blueprint and Class Session kernel and adds immutable Controller history, Class closure facts, student Class Summary versions and private Teacher Note versions. Browser roles cannot mutate authoritative D11 records. Class Summary has student read visibility; Teacher Note does not.

D11 uses the existing durable event runtime for `teaching.class.start_due`, `teaching.break.end_due` and `teaching.class.end_due`. Course activation seeds next-Class preparation and Class start/end due events. D10 Request decisions become planning signals; committed `teaching.request.applied` triggers materiality reconciliation only after the owning change has actually committed.

If Lesson Planner intelligence is unavailable at scheduled Class start, the T0 Class-time fact is preserved by a route-held Interrupted Controller state. D11 never fabricates a Lesson Blueprint and never creates an academic penalty from provider/model unavailability.

## Model boundary

D11 contains no provider SDK or model selection. Model-capable work enters through Teaching Orchestrator requests with capability, authority ceiling, prompt family, provenance, idempotency and validation contracts. Every model result remains provisional; only D11 owner code commits a validated/current Blueprint or live Controller mutation.

Production keeps D11 intelligence unbound while D30 remains unresolved. Deterministic Class-time/Controller state remains server-authoritative.

## Forward boundary

D11 does not implement D12 response evaluation/hinting/pedagogy, D13 durable SKM inference, D14 broad Classroom UI, D15 Attendance, D16 Work, D20 Gradebook, D21 Progression, D22 full Teacher Identity, D26 Recovery, D27 cards/FSRS, D30 route qualification or D31 release.
