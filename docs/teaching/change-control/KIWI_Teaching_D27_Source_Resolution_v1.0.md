# KIWI Teaching D27 Source Resolution v1.0

## Delivery
D27 — KIWI Integration Boundaries.

## Canonical scope
Exactly 17 tasks: TCH-0563 through TCH-0577, plus TCH-0914 and TCH-0915. No D28+ scope is authorized here.

## Starting repository state
The accepted D26 `main` starting SHA inspected for D27 was `118ac2dbc23a285c0d0c2c2cf89e957afaac7f30`.
No pushed D27 branch or commit existed when the interrupted Work session was recovered. The durable partial state was in the integration Supabase migration ledger.

## Interrupted-work recovery evidence
The KIWI Teaching Integration project already contained:
- `20261004043617 teaching_d27_integration_boundaries`
- `20261004043656 teaching_d27_fk_index_hardening`

The production Kiwi project did not contain either D27 migration at D27 recovery start; its Teaching head remained:
- `20261004040623 teaching_d26_coordination_notifications_recovery`
- `20261004040625 teaching_d26_fk_index_hardening`

The recovered integration schema was treated as completed D27 work and reconstructed into repository migrations rather than reapplied or redesigned.

## Deployment topology
Render workspace `My Workspace` contains service `KIWI` (`srv-d7p3k9gsfn5c73bh7rv0`), branch `main`, auto-deploy on commit, Node runtime. At D27 recovery start the Render service was still the accepted D26 deployment.

A fresh D27 inspection corrected an inherited D26-era assumption about Vercel. The Pro team `happysolomon43` (`team_6nfJK85Fs7QMFyOq0MYnPI47`) now has Vercel project `kiwi` (`prj_GKmy5gQjXx7uhEuVdhjCtqwSkN7I`) linked to `happysolomon43-boop/KIWI`. D27 recovery-branch commits receive Vercel preview deployments; the D27 verification head `287e474c4c51f627cf399d60619072997426f5d5` built successfully as READY deployment `dpl_7YDgjyvz5ZVL84uTv4dEbjWtpVsD`. Vercel preview deployment is therefore part of D27 verification, while Render remains the current backend production service.

## Database advisor verification
After the recovered D27 integration migration and its FK hardening migration, Supabase Integration security advisor reported only the established service-only `RLS Enabled No Policy` informational pattern for the new D27 tables. Browser roles are explicitly revoked and `service_role` retains server-side DML.

The performance advisor no longer reports any D27-specific unindexed foreign key on `teaching_study_card_references` or `teaching_study_card_candidates`; the four interrupted-work findings for Class and Learning Unit foreign keys are covered by `teaching_d27_fk_index_hardening`. Other informational unindexed-FK and unused-index findings belong to pre-existing schemas and are not silently expanded into D27/D28 scope.

## Existing KIWI owner inspection
D27 preserves these existing owners:
- KIWI Subject rows/decks/cards remain owned by the existing Subject/Study data model.
- D07 Course creation already references an existing Subject and persists an explicit immutable Course snapshot/source digest rather than a second Subject record.
- D18/shared Assessment Shell is the renderer/transport boundary; Teaching Assessment remains owner of package, attempt, mark and release truth.
- D26 already sends through `createKiwiNotificationInterface`; D27 does not create a second notification inbox or delivery implementation.
- KIWI Knowledge Score, Mastery Bubbles and Study/FSRS remain their own target owners.
- Brain and Biome have no sufficiently settled write contract and remain off.
- Achievement writes remain off for the first D27 release to avoid gamifying failure/remediation/recovery states.

## D27 gate decisions
- Subject: approved read/reference integration; no Subject write from Teaching; changed/deleted Subject never silently rebinds an active Course snapshot.
- Exam: approved shared-renderer handoff; no duplicate global Exam truth record in first release.
- Notifications: approved existing shared KIWI notification interface; notification delivery/read state is never academic evidence.
- KS: contract approved, but consequential write path is feature-flagged and must call a target-owner adapter after source-version revalidation. Teaching defines no numeric KS formula.
- Mastery: contract approved, feature-flagged, event/data adapter only. Teaching Scheduler remains Course-timetable authority; Mastery remains exam-goal trajectory authority.
- Study/FSRS: approved references plus validated unpromoted candidates. Card identity/deck/review interval/history/deletion stay with Study/FSRS. Promotion is explicit, feature-flagged and target-owner validated.
- Brain: explicitly deferred/off.
- Biome: explicitly deferred/off.
- Achievements: no first-release write triggers.

## Frozen prompt and AI routing
D27 changes no frozen prompt bytes, no PPL qualification, and no provider/model routing. TPF-20 remains frozen and runtime-unqualified until D30. The central KIWI AI Orchestrator remains the only model/provider execution boundary.

## Change-control result
No frozen-design contradiction was found. No architecture exception or prompt change-control amendment was required for the implemented D27 scope.
