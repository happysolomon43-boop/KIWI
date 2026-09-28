# Teaching D08 migration recovery

D08 persistence is additive and history-preserving. The D08 migration extends the D04 kernel instead of replacing Course Plan, Learning Unit, Coverage, VPK, or academic-audit ownership.

## Forward-first rule

If no D08 Course Plan, Coverage Audit, scope-change, source-version, mapping, exclusion, prerequisite, or scope-application row has ever been accepted, a non-production environment may remove the D08 additions in reverse dependency order for a clean reset.

Once D08 state exists, recovery is **forward-only**. Ship a corrective migration that preserves Course Plan versions, source versions, Learning Unit lineage, Coverage Audit snapshots, VPK supersession history, and academic audit records. Do not destructively roll back accepted academic history.

## Safe pre-data rollback order

Before any D08 data exists, a disposable non-production environment may:

1. drop teaching_course_scope_change_applications;
2. drop teaching_course_plan_source_mappings, teaching_course_plan_exclusions, teaching_course_plan_prerequisites, and teaching_coverage_audits;
3. remove the teaching_source_content_scope_change_fk and drop teaching_course_scope_changes;
4. remove D08 source-version columns/indexes from teaching_source_content_items;
5. remove the D08 Course Plan update guard, D08 indexes, constraints, and D08-added Course Plan columns.

Do not use this rollback sequence after D08 academic state exists.

## Scope-change recovery states

OPEN means a detected authoritative Subject delta is awaiting validated impact analysis. It has not changed the Course source baseline.

PENDING_PLAN_UPDATE means impact analysis determined a material version consequence. The current Course source baseline is still unchanged until explicit adoption.

ADOPTED_PENDING_AUDIT means the authoritative Subject snapshot has been adopted into a new source-inventory version and the previous Course Plan is deliberately REVIEW_REQUIRED. Recovery must not reactivate the previous plan, resurrect superseded primary source rows, or delete the change.

APPLIED means a successor Course Plan version has consumed the adopted scope version through an immutable application row. Recovery must preserve both predecessor and successor history.

MINOR_SUPPLEMENT and NO_CHANGE do not authorize rewriting historical Course Plan or Coverage rows.

## Security recovery

Never recover by granting authenticated browser roles INSERT, UPDATE, DELETE, or TRUNCATE on D08 academic-truth tables. Authenticated access remains owner-scoped read-only. Mutations stay behind service_role / teaching_domain_service and validated server commands.

Never disable the Course Plan immutable-field guard merely to make an update succeed. If a plan needs academic changes, create a new version and preserve lineage.

Never rewrite an immutable Coverage Audit, mapping, exclusion, prerequisite snapshot, scope-application row, historical Learning Unit, or VPK decision.

## Operational recovery

If D08 schema readiness fails after deployment, Stage 2 remains fail-closed. D07 Course Intake and previously accepted D02–D07 behavior remain available subject to their own readiness. Fix schema drift with a forward migration, rerun D01–D08 verifiers, rerun Teaching unit/integration tests, and only then restore D08 readiness.
