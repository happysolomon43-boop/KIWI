# KIWI Teaching — Delivery Handoff

**Delivery:** D04 — Kernel Persistence, Security & Auditability  
**State:** HANDOFF_READY  
**Date:** 2026-09-25  
**Canonical roadmap version:** Phase 19 Delivery Roadmap Overlay v1.4 FINAL  
**Start commit:** `d198962191c20e083ea2ebb87562b7021400baf8`  
**End commit:** `9cf48d2177d7660a001d00252d2ba52ebb973436`

## 1. Scope

**Planned TCH IDs:** TCH-0035, TCH-0036, TCH-0038–TCH-0047, TCH-0061–TCH-0062, TCH-0064–TCH-0068, TCH-0070, TCH-0684–TCH-0690, TCH-0875–TCH-0878.  
**Completed TCH IDs:** TCH-0035, TCH-0036, TCH-0038–TCH-0047, TCH-0061–TCH-0062, TCH-0064–TCH-0068, TCH-0070, TCH-0684–TCH-0690, TCH-0875–TCH-0878.  
**Deferred/not completed:** NONE within D04 scope.

D04 remained persistence/security-only. It did not implement D05 orchestration behavior, D06 academic policy decisions, later assessment/Gradebook/Attendance/Request/Progression behavior, or future-delivery state machines.

The D04 roadmap acceptance gate is satisfied: the kernel migrations apply transactionally, browser-side authoritative mutation is blocked, privileged service-role boundaries are usable under RLS, and audit/coverage/eligibility/intake/PPL lineage is durable and reconstructable.

## 2. Canonical sources actually used

The implementation was routed and checked against the current frozen baseline, including:

- `KIWI_Teaching_Implementation_Context_Pack_v1.7.md`.
- `KIWI_Teaching_Phase22_Final_Implementation_Freeze_v1.3.md` and `KIWI_Teaching_Phase22_Manifest_v1.3.json`.
- `KIWI_Teaching_Phase19_Delivery_Roadmap_Overlay_v1.4_FINAL.md`.
- `KIWI_Teaching_Delivery_Task_Map_v1.5.json`.
- `KIWI_Teaching_Master_Implementation_Backlog-9.5.md`.
- `KIWI_Teaching_System_Blueprint-11.5.md`.
- `KIWI_Teaching_Capability_Registry_v1.1.md`.
- `KIWI_Teaching_Capability_Traceability_Matrix_v1.1.json`.
- `KIWI_Teaching_Orchestrator_Event_Runtime_Spec_Phases_7-8_v1.1.md`.
- `KIWI_Teaching_Progressive_Preparation_Lifecycle_Standard_v1.0.md`.
- `KIWI_Teaching_Critical_Invariant_Trace_Map_v1.1.md`.
- `KIWI_Teaching_Implementation_Change_Control_Protocol_v1.0.md`.
- `KIWI_Teaching_Implementation_Delivery_Handoff_Template_v1.0.md`.
- The frozen D03 prompt/capability/runtime control plane and repository governance records were checked as predecessor constraints; D04 changed no frozen prompt text or model route qualification.

Source-integrity note carried from the frozen baseline: the canonical Authority Spec is `KIWI_Teaching_Intelligence_Inventory_Authority_Spec_Phases_4-6_v1.1.md`, SHA-256 `32ed4f149edc9531e6d5a3e0c81478f7025c9c16b32857b87707f4e609c40b87`. The retained local `v1.2_PPL` copy was not treated as a substitute for that pinned canonical source. D04 authority decisions were therefore grounded in the hash-pinned freeze/governance record plus the Blueprint, Capability Registry, Orchestrator Runtime Spec, PPL Standard and Critical Invariant map. This is a source-resolution carry-forward item for D05, not an architectural deviation introduced by D04.

## 3. Implementation changes

D04 added the kernel academic persistence layer and its server-only mutation seam.

The primary migration creates distinct durable entities for Semester, Course, versioned Course Plan, Topic, Subtopic, Learning Unit, Learning Unit dependencies and split/merge lineage, Class, Lesson Blueprint, Class Session, Board Scene/Item, Student Response, Evidence Event, Teacher Identity, Interaction Preference, Student Course Intake plus extraction lineage, source-content inventory, Course Coverage, Assessment Eligibility and an append-only academic audit log.

Coverage is represented as reconstructable facts rather than one lossy status: Found, Mapped, Planned, Taught, Validated Prior Knowledge, Instructionally Complete, Assessed and Excluded are independently durable, with explicit instructional-completion basis and exclusion reason.

Assessment Eligibility is a separate effective-time ledger. D04 stores eligibility facts and rule/version/evidence references but does not invent the D06 policy that decides them.

Student Course Intake preserves the original free-form input independently of later structured extraction. Intake self-report is not converted into knowledge evidence by D04.

PPL persistence was added in the private `teaching_preparation` schema for workspaces, authoritative input bundles, input dependencies, artifact versions, artifact components, component dependencies, artifact lineage, workspace candidates, review findings, finding-component references and finding evidence/rule references.

Prepared artifact payload bodies are isolated in `teaching_protected.prepared_artifact_payloads`, with ownership/protection-class binding back to the artifact metadata.

The server-side code boundary adds `createTeachingKernelPersistence({ query, withTransaction })` plus the D04 persistence security contract. The contract reserves authoritative academic mutations to the server trust boundary and separately requires explicit authorization for protected preparation content.

A D04-specific CI workflow and verifier were added. The verifier also prevents future Teaching migrations from being silently pulled into D04.

A post-apply D04 corrective hardening was completed for TCH-0067/TCH-0068: the named `teaching_domain_service` and `teaching_protected_service` NOLOGIN roles originally had table grants but no matching RLS policies. The hardening migration keeps both roles NOLOGIN/NOBYPASSRLS, prevents browser inheritance, gives `service_role` membership so it can deliberately assume the narrower roles, creates grant-matched RLS policies, preserves zero academic DELETE/TRUNCATE authority and keeps ordinary domain service excluded from protected payload bodies.

## 4. Persistence and migrations

Apply order:

1. Repository file: `migrations/20260925_teaching_d04_kernel_persistence.sql`.  
   Production migration ledger: `20260925185026_teaching_d04_kernel_persistence_security_auditability`.

2. Repository file: `migrations/20260925_teaching_d04_service_role_rls_hardening.sql`.  
   Production migration ledger: `20260925190420_teaching_d04_service_role_rls_hardening`.

The first migration creates 24 public Teaching kernel tables, 11 `teaching_preparation` metadata tables and one `teaching_protected` payload table. All D04 tables have RLS enabled. Browser roles receive no D04 INSERT/UPDATE/DELETE/TRUNCATE privilege.

The second migration makes the named privileged service roles independently usable under RLS without granting `BYPASSRLS`. It creates policy coverage matching existing SELECT/INSERT/UPDATE privileges and grants only the role memberships required for the existing Supabase `service_role` to deliberately assume those narrower boundaries.

No production row backfill was required. The D04 tables were empty at first apply and the migrations were additive.

Recovery/rollback is documented in `docs/teaching/migrations/d04-recovery.md`. After academic data exists, destructive rollback is not the default; preserve lineage and use forward repair. The D02 `teaching_runtime` schema is not owned by D04 and must not be dropped during D04 recovery.

## 5. Interfaces and invariants

New/changed interfaces:

- `teaching/repositories/kernel-persistence.js` exports `createTeachingKernelPersistence`.
- `assertReady()` fails closed unless the essential D04 public, preparation and protected storage surfaces exist.
- `mutate(operation, fn)` requires a registered server-authoritative Teaching mutation and executes it through the supplied transaction boundary.
- `protectedRead(context, fn)` requires explicit server-side protected-preparation authorization.
- `teaching/security/d04-persistence-contract.js` defines browser read-only tables, current server-authoritative mutation names, reserved future privileged academic operations and protected-preparation access checks.
- `teaching_domain_service` is the narrower ordinary Teaching persistence boundary.
- `teaching_protected_service` is the narrower protected PPL-content persistence boundary.
- Existing Supabase `service_role` may assume those roles deliberately; neither role can login or bypass RLS.

Invariants D05 must preserve:

- The browser is not an authoritative Teaching writer.
- PPL workspace/artifact/finding state is coordination/preparation state, not academic truth.
- Protected preparation payloads remain physically and permission-wise isolated.
- No hidden chain-of-thought/reasoning trace is persisted.
- Evidence Events are evidence facts, not SKM truth, marks or progression state.
- Assessment Eligibility remains a separate authoritative ledger and cannot be inferred from raw Subject scope or forecast planning.
- Coverage lineage must remain reconstructable across Learning Unit changes and Course Plan versions.
- Immutable history is corrected by new versions/events, not destructive rewrite.
- The Teaching Orchestrator in D05 may coordinate work but may not become Course, Scheduler, Gradebook, SKM, Assessment, Attendance, Request, Progression or live-Class authority.
- D02 durable-event and D03 Capability/Prompt/Route-Control ownership boundaries remain intact.

## 6. Tests actually executed

The final D04 hardening PR head `d71e5b7499feee0e1d3f6b06a0628a71fb8ad24e` passed the complete `Teaching D04 Kernel Persistence` workflow.

Executed CI steps and evidence:

- `npm run verify:teaching:d01` — PASS.
- `npm run verify:teaching:d02` — PASS.
- `npm run verify:teaching:d03` — PASS.
- `npm run verify:teaching:d04` — PASS.
- `node --check index.js` — PASS.
- Teaching server-module syntax check — PASS.
- `npm run test:teaching` — 46 tests, 46 passed, 0 failed, 0 skipped.
- `npm test` — 408 tests, 408 passed, 0 failed, 0 skipped.
- `npm run build:web` — PASS.
- `npm run test:teaching:integration` — 6 tests discovered; 3 guard tests passed, 3 environment-dependent DB tests skipped because no non-production Supabase test database/project is configured in CI; 0 failed.

Database verification performed in addition to CI:

- The complete initial D04 migration was run transactionally against the live PostgreSQL 17 schema and rolled back successfully before production apply.
- Exact in-transaction assertions verified 24 public D04 tables, 11 preparation tables, one protected table, RLS on every D04 table, zero browser DML, zero service-role academic DELETE/TRUNCATE, 24 student SELECT policies and the required immutable audit trigger.
- The hardening migration was also run transactionally and rolled back before apply, with exact role-membership and service-policy-count assertions.
- The NOLOGIN roles were actually assumed with `SET LOCAL ROLE` during a rolled-back probe and could read their permitted public/preparation/protected surfaces without relying on `BYPASSRLS`.
- Post-apply production verification confirmed both roles remain NOLOGIN/NOBYPASSRLS, `service_role` has both narrow role memberships, browser DML remains zero, service DELETE/TRUNCATE remains zero, and `teaching_domain_service` has zero protected-payload privilege.
- Post-hardening policy counts are: public Teaching — 24 SELECT, 24 INSERT, 17 UPDATE policies for `teaching_domain_service`; preparation — 22 SELECT, 22 INSERT, 10 UPDATE policies across the two narrow roles; protected — one SELECT and one INSERT policy for `teaching_protected_service`.
- Supabase security advisor currently reports no D04-specific findings.

## 7. Security / privacy / academic-authority review

All D04 public Teaching tables use RLS. Authenticated users may only read their own rows through student-scoped SELECT policies and receive no authoritative write privileges.

The private preparation and protected schemas are not exposed to browser roles. Protected payload bodies are inaccessible to `teaching_domain_service`.

The narrow D04 service roles are NOLOGIN/NOBYPASSRLS and have no academic DELETE/TRUNCATE authority. Their RLS policies now match only their explicit grants. Browser roles cannot inherit them.

Historical Student Responses, Evidence Events, Intake originals/extractions, Learning Unit lineage, PPL authoritative-input/dependency/lineage references and protected payload versions are immutable through D04 triggers/privilege design. Academic audit is append-only.

D04 stores safe provenance/version/reference metadata and not hidden reasoning. The existing D02 prompt/data-lane separation and formal-marking context-minimization protections remain unchanged.

No prompt was modified, no AI provider was called directly from Teaching, no model output was given direct academic mutation authority, and no future Gradebook/Attendance/Assessment/Request/Progression source of truth was introduced.

## 8. Known defects and debt

No known D04-attributable P0 or P1 defect remains open.

Operational test-environment debt: the repository CI does not currently have a non-production Supabase branch/project configured, so the three live-schema integration bodies are skipped. The production database was not used as a destructive test target; instead, migrations were transactionally dry-run with rollback and then independently verified after apply. This does not block D05 but a non-production Supabase integration environment remains desirable.

Pre-existing Supabase security debt outside D04 remains on five legacy public tables with RLS disabled: `background_jobs`, `biome_zones`, `biome_zone_descriptions`, `onboarding_state`, and `notifications`. D04 did not alter them because their correct policies belong to their owning subsystems and an uninformed RLS toggle could break existing KIWI behavior. They are not D04 acceptance failures.

Canonical-source integrity carry-forward: the freeze pins Authority Spec v1.1 SHA `32ed4f149edc9531e6d5a3e0c81478f7025c9c16b32857b87707f4e609c40b87`, while the retained local copy observed during D04 resolution was a differently named `v1.2_PPL` file. The mismatched copy was not used as authority. D05 must resolve/read the exact canonical v1.1 source (or the formally accepted restored copy with that hash) before authority-dependent code modification.

## 9. Architecture exceptions

NONE.

The service-role RLS issue discovered after the first D04 apply was an implementation defect against the intended D04 least-privilege boundary, not a frozen-design contradiction. It was corrected within D04 through a forward migration, regression checks and production verification.

## 10. Deployment/runtime impact

Supabase production now contains both D04 migrations listed above.

Vercel production is READY on D04 end commit `9cf48d2177d7660a001d00252d2ba52ebb973436`.

No D04 environment variable was added or changed. No runtime feature flag was introduced. No generic Teaching availability toggle was added.

No Render service/configuration change was required for D04.

Rollback trigger: any evidence of browser authoritative writes, protected-content leakage, service-role DELETE/TRUNCATE capability, broken immutable lineage, or migration/state mismatch requires stopping affected Teaching writes and using the documented D04 recovery/forward-repair path. Do not weaken RLS as a recovery shortcut.

## 11. Next-delivery readiness

**Next delivery:** D05 — Teaching Orchestrator & Durable Event Runtime Integration.

**Prerequisites satisfied:** YES for D04 implementation dependencies. Durable kernel state, PPL workspace/artifact/finding/dependency persistence, protected-content storage, auditability and usable narrow server-side RLS boundaries are in production and verified. D02 runtime primitives and D03 capability/prompt/route-control predecessors also remain passing.

D05 still has its mandatory source-resolution precondition: locate/read the exact canonical Authority Spec v1.1 before implementing authority-dependent orchestration work. This is a pre-existing source-integrity requirement, not missing D04 code.

**Required carry-forward context:**

- Use the existing D02 durable event runtime; do not create a parallel event system.
- Use the D03 Capability Registry and prompt runtime; do not create unregistered capabilities, rewrite frozen prompts or qualify routes early.
- D05 orchestration must use D04 persistence rather than introducing duplicate workspace/artifact/audit truth.
- Release DB transactions before model work.
- Revalidate authoritative state/version after model work and reject stale results.
- PPL triggers must remain event-driven, materiality-gated, idempotent, version-safe and fail-closed at finalization.
- Protected preparation content must enter model context only through the protected server path.
- The Teaching Orchestrator remains coordination logic and never becomes an academic owner.

**Recommended baseline commit:** `9cf48d2177d7660a001d00252d2ba52ebb973436` for the completed D04 implementation. When starting D05, branch from current `main` so this handoff document is also present; no D05 code was begun in D04.
