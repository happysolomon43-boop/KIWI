# D17 Assessment Schema Convergence Evidence

This note records the D17 pre-merge schema-convergence evidence discovered while reconciling the frozen Assessment-domain implementation against the KIWI Teaching Integration database.

## Reconciled prototype drift

The abandoned pre-freeze Integration prototype contained D17-shaped tables whose existing constraints, triggers, functions, foreign keys, and indexes were not fully converged by `CREATE TABLE IF NOT EXISTS`.

The canonical D17 migration now explicitly converges that state instead of relying on table creation side effects. It:

- replaces obsolete state-vocabulary checks with the D17 runtime contract;
- removes obsolete package mutation triggers/functions;
- preserves package assembly as `ASSEMBLING -> immutable item snapshot -> atomic LOCKED`;
- enforces locked package item membership/content immutability;
- fixes trigger-function `search_path` posture;
- replaces all D17-owned foreign keys with the canonical 48-FK set and canonical delete semantics;
- removes redundant or non-canonical prototype uniqueness artifacts;
- removes exact duplicate prototype indexes; and
- supplies leading indexes for every canonical D17 foreign key.

## Validation evidence

Temporary convergence run `36995942587` validated the source patch on PostgreSQL 16. Its clean canonical reconstruction passed the D17 verifier and all D17 schema/security tests. The same run deliberately reintroduced representative prototype drift, reapplied the canonical migration, and verified that the drift was removed while canonical FK semantics and index coverage were restored.

The source produced by that validated convergence run is commit `4512cb07dcb6e778bf3f626b5fc255ebf9078610` on `teaching/d17-assessment-domain`.

This evidence note does not declare D17 accepted or merged. The permanent `Teaching D17 Assessment Domain` workflow, live Teaching Integration verification, merge acceptance, Production migration, deployment provenance, and D17-to-D18 handoff remain separate required closure evidence.
