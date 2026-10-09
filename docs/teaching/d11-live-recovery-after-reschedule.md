# D11 live-start recovery after approved timetable rescheduling

## Production incident: PHY101 2026-10-09

A formal schedule adjustment created timetable version 27 and a new approved, active PHY101 Class scheduled from 00:44 to 02:00 (Africa/Lagos). The old Class and its validated Blueprint were attached to the former timetable and could not be used for the new Class. The new Class had no validated Blueprint, and its preparation workspace remained an unpopulated SKELETON when its start time arrived.

The Classroom showed **Start pending**, and D11 start correctly rejected the unprepared controller (`TEACHING_D11_BLUEPRINT_REQUIRED`). D14's eager JOIN could additionally return `TEACHING_D14_CLASS_NOT_STARTED` before the Classroom could display its recovery controls.

## Recovery

- Show the real D14 Classroom snapshot **before** trying to JOIN; only POST JOIN after a real Controller exists or after successful Start. A review-only Classroom never JOINs.
- The **Prepare & Start Class** button checks the server-owned D11 current Blueprint and completed preparation handoff.
- If there is no ready validated Blueprint, the browser requests up to three steps through the **existing** `POST /classes/:id/lesson-blueprint/prepare` route with `maxSteps:1` and `allowLateStartRecovery:true`. Each executes KIWI's regular AI orchestrator, D11 schema/domain validator, PPL artifact/reconciliation gates, and owner authority commit.
- Recovery is authorized only for an ACTIVE Course, SCHEDULED Class, APPROVED timetable, no existing Controller, no more than 45 minutes after scheduled start, and at least 20 minutes remaining. The server owns all clocks. No recovery after a Class window expires.
- For permitted late recovery, the AI planning request and validator see the remaining teaching time. The persisted Class schedule and authority lineage are unchanged.
- The artifact transaction rechecks authoritative Course/Class/Timetable/Plan versions, effective live window, absence of Controller, and explicit late-recovery authorization before capturing the candidate. Rejected work leaves the Class unstarted and permits a safe user retry.
- A completed HANDED_OFF PPL workspace is absent from the active D11 context by design. Startup must **not reseed** a new SKELETON merely because the validated Blueprint's handed-off workspace is absent.
- After validation, the unchanged `startController` method performs its start-time/blueprint/authority checks and creates the real D11 session. The browser then performs the genuine D14 JOIN, which may record actual attendance; the normal Teacher instruction queue remains authoritative.

No class, attendance or timetable is changed by the repair's code itself. A participating student initiating a real Class and JOIN through the repaired UI still creates the normal academic records.

## Limitations

If the D31 model route is unavailable or PPL deterministic validation fails, KIWI must explain the failure; it must not synthesize a teaching session or invent a Blueprint. A late recovery for a very short or nearly elapsed Class is intentionally blocked. Once started, normal D11 instructional state and D14 Teacher publication rules apply.
