# KIWI Teaching D27 → D28 Implementation Handoff v1.0

## 1. Delivery identity and closure status

**Completed delivery:** D27 — KIWI Integration Boundaries  
**Milestone:** Milestone F  
**Hard predecessor:** D26  
**Canonical task count:** 17  
**Exact scope:** TCH-0563 through TCH-0577, plus TCH-0914 and TCH-0915  
**D28 started:** No  
**D27 implementation status:** Complete  
**Known D27-attributable P0/P1 issues at closure:** None  
**Architecture exceptions:** None  
**Frozen prompt/change-control exceptions:** None

D27 was recovered from an interrupted Work-mode implementation rather than restarted. The recovery process first inspected repository history, the accepted D26 `main`, Supabase ledgers, deployment state, and the previous D26→D27 handoff. No pushed D27 branch or commit survived the interruption. The durable stopping point was the already-applied D27 schema in the KIWI Teaching Integration Supabase project.

## 2. Recovery provenance and exact starting point

Accepted D26 `main` at D27 recovery start:

`118ac2dbc23a285c0d0c2c2cf89e957afaac7f30`

No D27-named branch or D27 code commit existed remotely at recovery start.

The Integration Supabase project already contained the interrupted Work-mode database changes:

- `20261004043617 teaching_d27_integration_boundaries`
- `20261004043656 teaching_d27_fk_index_hardening`

The recovered schema was treated as completed D27 work and reconstructed into repository migrations. It was not redesigned or reapplied to Integration.

The D27 recovery implementation branch was:

`teaching/d27-integration-boundaries-recovery`

The final PR head before merge was:

`434877b763907b15bef6842353e849246569d1b4`

PR:

`#204 — D27: KIWI integration boundaries`

The accepted D27 implementation merge commit is:

`622c2400558cae9b37c225b2bcb6df8172e2269b`

## 3. Completed canonical TCH accounting

All 17 D27 tasks are implemented or deliberately closed according to their canonical gate semantics:

- **TCH-0563 · CORE** — Teaching Course/Subject integration uses the existing KIWI Subject identity and corpus. Teaching does not create a duplicate Subject row. Active Course snapshots remain pinned if the source Subject changes or disappears.
- **TCH-0564 · CORE** — Teaching formal assessment uses the existing shared Assessment Shell/Exam rendering boundary. Assessment package, attempt, mark, release, and Gradebook truth remain owned by Teaching Assessment/Gradebook domains. No duplicate first-release global Exam record is created.
- **TCH-0565 · CORE** — Teaching notifications continue through the existing KIWI notification interface established by D26. D27 does not create a second notification inbox or academic truth layer.
- **TCH-0566 · CORE** — Added a versioned D27 integration event/API contract with schema version, source owner/entity/version, occurrence time, correlation/causation identity, idempotency key, policy version, privacy class, and minimal payload.
- **TCH-0567 · CORE** — Added durable high-level Teaching integration events: `learning_unit_verified`, `misconception_detected`, `assessment_completed`, `course_completed`, and `remediation_required`, with replay-safe identity and consumer decoupling.
- **TCH-0568 · GATE** — Closed the Knowledge Score contract. Teaching may provide qualifying evidence context but defines no numeric KS formula and may not own KS truth.
- **TCH-0569 · CORE** — Implemented the KS boundary behind an explicit integration write gate, source-version revalidation, target-owner adapter validation, audit logging, and idempotent event identity. There is no direct D27 SQL write to `knowledge_scores`.
- **TCH-0570 · GATE** — Closed the Mastery Bubbles contract. Mastery remains exam-goal trajectory authority; Teaching/D09 remains Course timetable authority.
- **TCH-0571 · CORE** — Implemented the Mastery event/data adapter boundary behind an explicit integration write gate. D27 does not directly mutate `mastery_goals` or allow Mastery to overwrite Course schedule truth.
- **TCH-0572 · GATE** — Closed the Study/FSRS scheduling and Learning Unit suitability contract. Declarative/conceptual knowledge may use cards; procedural/analytical/interpretive/production knowledge defaults to fresh practice rather than indiscriminate card generation.
- **TCH-0573 · CORE** — Implemented the Study/FSRS boundary for references, validated candidates, explicit promotion, owner validation, replay/idempotency, and source-card version checks.
- **TCH-0574 · GATE** — Brain integration explicitly remains off because no sufficiently settled target-owner write contract exists.
- **TCH-0575 · GATE** — Biome integration explicitly remains off because no sufficiently settled target-owner write contract exists.
- **TCH-0576 · CORE** — First-release Teaching achievement/gamification writes remain off. Serious academic states, remediation, recovery, failure, resits, and protected outcomes are not gamified by D27.
- **TCH-0577 · QA** — Added explicit cross-system conflict precedence and focused tests for stale/duplicate/replay cases, Subject change/deletion, deleted card references, target-owner rejection, integration outage, weak FSRS versus strong Teaching evidence, Mastery deadline versus Teaching timetable, and late Course-completion replay.
- **TCH-0914 · GATE** — Closed Teaching↔KIWI Study/FSRS identity, source version, selection, validation, promotion, scheduling, review evidence, replay, deletion, Subject-change, and conflict contracts before any card-owner write.
- **TCH-0915 · CORE** — Implemented existing-card references and independently validated missing-card candidates with deterministic deduplication, knowledge-type sensitivity, protected Assessment exclusion, no copied source card corpus, and no automatic deck pollution.

`teaching/d27/task-accounting.js` asserts the exact 17-task census.

## 4. Authority and ownership contracts preserved

D27 preserves the canonical one-owner-per-fact model.

**Subject:** Existing KIWI Subject data remains authoritative. Teaching stores Course context and the already-approved source snapshot relationship only. If the live Subject changes, D27 compares the current primary Subject inventory to the pinned primary Subject inventory. Supplemental Course materials do not cause false Subject-change detection. If a Subject is deleted, an active Course remains pinned to its approved snapshot and may not silently rebind.

**Exam/Assessment:** The existing shared Assessment Shell is a renderer/interaction boundary only. Teaching Assessment remains authoritative for packages, attempts, timing, response state, validation, invalidation, marking, results, and Gradebook consequences. D27 creates no competing global Exam truth record in the first release.

**Notifications:** The existing KIWI notification system remains the delivery owner. Notifications contain deep links/routing context only and never become academic evidence or the sole location of a Course fact.

**Knowledge Score:** KIWI KS remains the target owner. Teaching supplies only qualifying source evidence through an owner adapter after source-version revalidation. Teaching does not define or persist a duplicate KS state or hidden scoring formula.

**Mastery Bubbles:** Mastery remains the exam-goal/trajectory owner. D09 remains the owner of Course timetable and hard scheduling constraints. D27 exposes signals without allowing whichever subsystem ran last to overwrite the other domain.

**Study/FSRS:** KIWI Study/FSRS owns card identity, deck membership, review interval, review history, scheduling state, and deletion. Teaching stores references to current cards and validated unpromoted candidates only. Promotion requires an explicit target-owner adapter. Removing a Teaching review set does not delete the source card.

**Brain/Biome/Achievements:** No D27 write path is enabled.

**AI/provider boundary:** D27 adds no direct provider SDK or model routing. The central KIWI AI Orchestrator remains the sole provider/model execution boundary. No frozen prompt bytes or qualification state were changed. TPF-20 remains frozen and runtime-unqualified until D30. D31 remains the release gate.

## 5. Interfaces and contracts added or changed

D27 added the following implementation boundary modules:

- `teaching/d27/contracts.js` — versioned integration contracts and event envelope.
- `teaching/d27/conflicts.js` — explicit cross-system conflict precedence.
- `teaching/d27/study.js` — knowledge-type-sensitive reference/candidate/deduplication rules.
- `teaching/d27/service.js` — owner-preserving integration service.
- `teaching/d27/source-reader.js` — authoritative source-version revalidation for supported Teaching owners.
- `teaching/d27/routes.js` — authenticated D27 integration boundary routes.
- `teaching/d27/task-accounting.js` — exact D27 TCH census.
- `teaching/d27/index.js` — D27 module exports.
- `teaching/repositories/d27-integrations.js` — D27 server-side persistence boundary.

Existing composition was extended through:

- `teaching/index.js` — D27 repository/service composition as a first-class Teaching delivery seam.
- `teaching/repositories/index.js` — D27 repository export.
- `teaching/d17/routes.js` — D27 routes mounted through the existing authenticated Teaching routing composition rather than a parallel backend.
- `teaching/config/index.js` — explicit D27 external-owner write gates defaulting off.

The write-gate environment controls are:

- `TEACHING_D27_KS_WRITE_ENABLED`
- `TEACHING_D27_MASTERY_WRITE_ENABLED`
- `TEACHING_D27_STUDY_PROMOTION_ENABLED`

These are **integration write gates**, not Teaching feature-availability switches. The distinction matters: during validation, the initial runtime token `featureFlags` caused the D01 availability verifier to fail. D27 corrected the implementation to `writeGates`/`integrationWriteGates`, preserving the D01 rule that Teaching availability is not controlled by per-feature flags. This predecessor failure was fixed at source rather than waived.

Consequential target-owner writes also require a valid owner adapter and a current authoritative source version. A gate set to true does not bypass owner validation.

## 6. D27 persistence and migrations

Repository migrations:

- `migrations/20261004_teaching_d27_integration_boundaries.sql`
- `migrations/20261004_teaching_d27_fk_index_hardening.sql`

D27 persistence tables:

- `public.teaching_integration_events`
- `public.teaching_integration_audit`
- `public.teaching_study_card_references`
- `public.teaching_study_card_candidates`

The tables store integration identity/audit/reference/candidate state only. They do **not** duplicate Subject, Exam, KS, Mastery, FSRS, Brain, Biome, Gradebook, SKM, Attendance, or Progression truth.

Security posture verified on Integration and Production:

- RLS enabled on all four D27 tables.
- `PUBLIC`, `anon`, and `authenticated` have no DML.
- `service_role` has server-side SELECT/INSERT/UPDATE/DELETE.
- Browser roles have no D27 academic mutation path.

Index hardening added covering indexes for the non-leading Class and Learning Unit foreign keys:

- `teaching_study_card_references_class_fk_idx`
- `teaching_study_card_references_learning_unit_fk_idx`
- `teaching_study_card_candidates_class_fk_idx`
- `teaching_study_card_candidates_learning_unit_fk_idx`

The D27-specific Supabase performance-advisor FK findings are cleared.

### Integration migration ledger

The recovered Integration ledger is:

- `20261004043617 teaching_d27_integration_boundaries`
- `20261004043656 teaching_d27_fk_index_hardening`

### Production migration ledger

Production records two applications of each D27 migration name:

- `20261004064220 teaching_d27_integration_boundaries`
- `20261004064227 teaching_d27_fk_index_hardening`
- `20261004064918 teaching_d27_integration_boundaries`
- `20261004064924 teaching_d27_fk_index_hardening`

This duplicate ledger history is explicitly recorded rather than hidden. The SQL uses additive/idempotent `IF NOT EXISTS` operations, so the second application did not create duplicate tables or indexes. Post-application inspection confirmed the intended four D27 tables exist once, the expected indexes exist once, RLS/grants are correct, and schema integrity is intact.

This ledger duplication is a deployment-history note, not an academic/data-truth duplication.

## 7. Cross-system conflict policies closed by D27

D27 codifies the following precedence instead of using last-writer-wins:

- **Teaching strong evidence vs weak FSRS:** FSRS review weakness may request review but cannot automatically downgrade Teaching SKM or Gradebook truth.
- **FSRS due date vs Teaching timetable:** D09 Course time wins Course scheduling. Study may replan card review without moving a formal Class/deadline.
- **Mastery deadline vs Teaching timetable:** Mastery may surface trajectory pressure; it may not override D09 hard constraints or silently duplicate the Course schedule.
- **Out-of-order/stale event:** Re-read authoritative source version before consequential target writes. Historical replay must remain idempotent.
- **Target-owner rejection:** Audit the rejection; preserve valid source truth; never fabricate target success.
- **Integration outage:** Preserve replayable durable intent; do not corrupt Course state and do not create student penalty.
- **Deleted card reference:** Mark the reference stale/missing. Teaching does not recreate or delete the source card implicitly.
- **Late Course-completion replay:** Preserve source-version history and idempotency; do not duplicate downstream consequence.

## 8. Tests, verification, and CI results

D27 added focused tests covering:

- contract ownership/gates;
- protected Assessment content exclusion;
- knowledge-type-sensitive Study selection;
- candidate independent validation and deduplication;
- active-Course Subject deletion pinning;
- real Subject-change detection without supplement-driven false positives;
- shared Assessment Shell ownership;
- durable integration event idempotency;
- disabled KS write behavior;
- stale source rejection before target-owner mutation;
- deleted card references;
- target-owner rejection audit;
- integration outage replayability;
- late/duplicate Course completion;
- Class source-version mapping to the live `schedule_version` schema;
- D27 foundation composition and write-gate defaults.

Canonical verifier:

`npm run verify:teaching:d27`

CI workflow:

`.github/workflows/teaching-d27-integrations.yml`

Final pre-merge predecessor verification:

- D01 workflow run `37183788242` — **PASS** on exact final PR head `434877b763907b15bef6842353e849246569d1b4`.

Final pre-merge D27 verification:

- D27 workflow run `37183788291` — **PASS** on exact final PR head `434877b763907b15bef6842353e849246569d1b4`.
- D27 canonical verifier — PASS.
- Focused D25–D27 tests — PASS.
- Full Teaching unit suite — PASS.
- Full repository test suite (`npm test`) — PASS.
- Web build — PASS.

The exact branch-head verification was rerun after correcting the D01 integration-write-gate naming violation; closure does not rely on the earlier run that preceded that correction.

## 9. Supabase advisor results

Integration and Production were inspected after D27 hardening.

D27-specific result:

- no remaining unindexed D27 foreign-key finding;
- all four D27 tables have RLS enabled;
- browser DML remains revoked;
- service-role DML remains available;
- no D27 security policy regression was found.

The security adviser reports the expected informational `RLS enabled with no browser policy` pattern for the service-only D27 tables. Other global/pre-existing adviser notices remain outside D27 and were not silently pulled into D28 hardening scope.

Unused-index notices immediately after creation are expected because the new integration paths have not yet accumulated production workload; D27 did not remove protective FK/index coverage merely to suppress unused-index telemetry.

## 10. Deployment state

### Render

Production backend service:

- Workspace: `My Workspace`
- Service: `KIWI`
- Service ID: `srv-d7p3k9gsfn5c73bh7rv0`
- Branch: `main`
- Auto-deploy: enabled

After PR #204 merged, Render deployed the exact D27 implementation merge SHA:

`622c2400558cae9b37c225b2bcb6df8172e2269b`

Deployment state verified: **live**.

### Vercel

Fresh D27 inspection corrected the inherited assumption that KIWI had no Vercel surface.

- Team: `happysolomon43`
- Project: `kiwi`
- Project ID: `prj_GKmy5gQjXx7uhEuVdhjCtqwSkN7I`
- Git repository: `happysolomon43-boop/KIWI`

D27 recovery-branch previews built successfully. After PR #204 merged, the Vercel production deployment for the exact D27 implementation merge SHA `622c2400558cae9b37c225b2bcb6df8172e2269b` was verified **READY**.

Render remains the current backend production service; Vercel is also an active deployment surface and must be inspected by future deliveries when relevant.

## 11. Known limitations and deliberately deferred items

The following are intentional D27 closure conditions, not missing implementation:

- KS writes default **off**. Enabling requires the D27 write gate plus a real Knowledge Score owner adapter and passing source-version/evidence checks.
- Mastery writes default **off**. Enabling requires the D27 write gate plus a real Mastery owner adapter and owner acceptance.
- Study card promotion defaults **off**. Teaching may create references and validated unpromoted candidates; promotion requires the D27 write gate plus a real Study owner adapter and explicit target acceptance.
- Brain writes remain **off**.
- Biome writes remain **off**.
- Achievement/gamification writes remain **off** for the first D27 release.
- D27 does not qualify Teaching AI routes or change prompt bytes.
- TPF-20 remains frozen and D30-held.
- D31 release authority is unchanged.
- D28 observability/cost/security-hardening scope was not implemented early.
- D29 end-to-end verification was not implemented early.
- No release qualification or production-launch decision beyond D27’s own deployment verification was pulled forward.

## 12. Architecture exceptions and change control

**Architecture exceptions:** NONE.

No genuine contradiction in the frozen design was found that required an architecture-exception record.

No frozen prompt behavior was modified, so no prompt Change-Control Protocol amendment was required.

The D01 availability invariant violation discovered during CI was an implementation naming/composition defect, not a canonical contradiction. It was corrected before merge by replacing D27 runtime `featureFlags` semantics with explicit integration `writeGates`, after which D01 and D27 both passed on the same final PR head.

## 13. Prerequisites now satisfied for D28

D28 may begin from the following accepted D27 state:

- all 17 D27 TCH tasks accounted for;
- explicit read/write/conflict contracts for every D27 external integration;
- unsafe/deferred write paths remain off;
- no duplicate Subject/Exam/KS/Mastery/FSRS/Brain/Biome truth store exists inside Teaching;
- durable versioned integration event identity exists;
- target-owner writes require owner adapters, current source versions, and audit records;
- Subject change/deletion handling is explicit and snapshot-safe;
- shared Exam rendering is connected without duplicate Exam ownership;
- D26 shared notifications remain the sole KIWI notification boundary;
- Study/FSRS references/candidates are implemented under the approved gate;
- cross-system conflict precedence is explicit and tested;
- production schema is installed and verified;
- Integration/Production RLS, grants, and D27 FK index coverage are verified;
- D01 and D27 canonical CI gates pass on the final implementation head;
- implementation is merged to `main` through PR #204;
- Render and Vercel production surfaces are confirmed on the D27 implementation merge SHA;
- no known D27-attributable P0/P1 remains unresolved.

D28 must perform its own fresh repository, migration-ledger, advisor, deployment, and source inspection before modifying code. It must not reinterpret D27’s explicitly disabled target-owner writes as implicitly approved merely because the D27 boundary exists.

## 14. D27 closure statement

D27 is complete. The accepted implementation merge is `622c2400558cae9b37c225b2bcb6df8172e2269b`. The production schema and both active deployment surfaces were verified after merge. The production migration ledger contains a transparently documented idempotent duplicate application of the two D27 migration names, with no duplicate schema objects or known data-integrity damage.

**Do not begin D28 as part of this handoff.**
