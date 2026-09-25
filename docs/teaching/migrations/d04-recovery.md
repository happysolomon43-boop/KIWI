# D04 migration recovery and rollback

Migration: `20260925_teaching_d04_kernel_persistence.sql`

## Before apply

1. Confirm the live migration head is D02 (`teaching_d02_runtime_primitives`) and no competing Teaching schema migration has been applied.
2. Confirm D03 is the accepted predecessor and the repository commit being migrated contains the D04 migration/verifier.
3. Snapshot the current schema/migration list and security-advisor results.
4. Because D04 is additive and the D04 tables are new, no production row backfill is required at first apply.

## Apply failure

The migration is transactional. If any statement fails before `COMMIT`, PostgreSQL rolls the D04 changes back. Do not manually continue from the failed statement. Correct the migration, rerun its structural tests, and apply the corrected migration as one unit.

## Immediate rollback before D04 data exists

Stop any writer using D04 first. Then, in a deliberate recovery migration, remove dependent objects in this order:

1. `teaching_protected.prepared_artifact_payloads`, then schema `teaching_protected`.
2. `teaching_preparation` child tables, workspace tables, then schema `teaching_preparation`.
3. Public Teaching child/history tables, then parent Course/Semester tables.
4. D04-only helper triggers/functions after all dependent tables are gone.
5. `teaching_protected_service` and `teaching_domain_service` only if no later migration/object uses those roles.

Do not drop the D02 `teaching_runtime` schema; it is a predecessor and not owned by D04.

## Recovery after academic data exists

Do not destructively roll back as the default. D04 contains academic lineage and immutable audit/evidence/intake records. Preserve/export them and use a forward repair migration. Any deletion/retention action must obey the later canonical retention/deletion policy once D06 resolves it; D04 does not invent that policy.

If a schema defect threatens correctness, stop affected Teaching writes, keep reads/audit evidence available where safe, create an architecture exception if the fix changes a frozen contract, and ship a forward migration preserving identifiers/version lineage.

## Security rollback warning

Do not “recover” by granting browser write access or by moving protected PPL payloads into public tables. If service-role access is misconfigured, repair the privileged role/grant path while preserving RLS and protected-schema isolation.
