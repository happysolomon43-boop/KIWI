'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

function fail(message) { console.error('[D04] FAIL:', message); process.exitCode = 1; }
function check(condition, message) { if (!condition) fail(message); }

const migrationPath = path.join(root, 'migrations', '20260925_teaching_d04_kernel_persistence.sql');
const serviceRoleMigrationPath = path.join(root, 'migrations', '20260925_teaching_d04_service_role_rls_hardening.sql');
const required = [
  'migrations/20260925_teaching_d04_kernel_persistence.sql',
  'migrations/20260925_teaching_d04_service_role_rls_hardening.sql',
  'teaching/security/d04-persistence-contract.js',
  'teaching/repositories/kernel-persistence.js',
  'tests/teaching/unit/d04-persistence-contract.test.js',
  'tests/teaching/integration/d04-kernel-schema.test.js',
  'docs/teaching/d04-kernel-persistence.md',
  'docs/teaching/migrations/d04-recovery.md',
  '.github/workflows/teaching-d04-persistence.yml',
];
for (const file of required) check(fs.existsSync(path.join(root, file)), `missing D04 artifact: ${file}`);

const sql = fs.readFileSync(migrationPath, 'utf8');
const serviceRoleSql = fs.readFileSync(serviceRoleMigrationPath, 'utf8');
const tightSql = sql.replace(/\s+/g, '');
const expectedPublicTables = [
  'teaching_semesters','teaching_courses','teaching_course_plans','teaching_topics',
  'teaching_subtopics','teaching_learning_units','teaching_learning_unit_dependencies',
  'teaching_learning_unit_lineage','teaching_classes','teaching_lesson_blueprints',
  'teaching_class_sessions','teaching_board_scenes','teaching_board_items',
  'teaching_student_responses','teaching_evidence_events','teaching_evidence_event_learning_units',
  'teaching_teacher_identities','teaching_interaction_preferences','teaching_student_course_intakes',
  'teaching_student_course_intake_extractions','teaching_source_content_items',
  'teaching_course_coverage','teaching_assessment_eligibility','teaching_academic_audit_log',
];
for (const table of expectedPublicTables) {
  check(sql.includes(`CREATE TABLE public.${table} (`), `missing public D04 table: ${table}`);
}
for (const table of [
  'workspaces','authoritative_input_bundles','input_bundle_dependencies','artifact_versions',
  'artifact_components','component_dependencies','artifact_lineage','workspace_candidates',
  'review_findings','finding_component_refs','finding_evidence_rule_refs',
]) {
  check(sql.includes(`CREATE TABLE teaching_preparation.${table} (`),
    `missing PPL D04 table: teaching_preparation.${table}`);
}
check(/CREATE TABLE teaching_protected\.prepared_artifact_payloads\b/i.test(sql), 'missing protected prepared-artifact payload store');
check(/lifecycle_state[\s\S]*FINALIZATION_DUE[\s\S]*maturity_stage[\s\S]*PRE_LOCK_READY/i.test(sql), 'PPL lifecycle and maturity must be separate fields');
check(/current_authoritative_input_bundle_ref/i.test(sql), 'PPL workspace must bind current authoritative input bundle');
check(/component_dependencies/i.test(sql), 'PPL must support component-level dependency invalidation');
check(/review_findings/i.test(sql) && /recurrence_guard_key/i.test(sql), 'PPL must persist structured review findings');
check(/protected_content_class/i.test(sql), 'PPL storage must carry explicit protection classification');
check(/FOREIGN KEY\(artifact_version_id,student_id,protected_content_class\)[\s\S]*REFERENCES teaching_preparation\.artifact_versions\(artifact_version_id,student_id,protected_content_class\)/i.test(sql), 'protected payload ownership/protection class must be bound to artifact metadata');
check(!/(chain[_ -]?of[_ -]?thought|reasoning_trace|hidden_reasoning)/i.test(sql), 'D04 persistence must not store hidden chain-of-thought');

for (const status of ['found_at','mapped_at','planned_at','taught_at','validated_prior_knowledge_at','instructionally_complete_at','assessed_at','excluded_at']) {
  check(sql.includes(status), `coverage ledger missing ${status}`);
}
check(/instructional_completion_basis/i.test(sql), 'coverage ledger must distinguish Taught from Validated Prior Knowledge');
check(/teaching_learning_unit_lineage/i.test(sql), 'Learning Unit split/merge lineage must be durable');
check(/teaching_assessment_eligibility[\s\S]*eligible boolean[\s\S]*rule_version[\s\S]*effective_from/i.test(sql), 'Assessment Eligibility ledger must be version/effective-time aware');
check(/original_free_form_text/i.test(sql) && /teaching_student_course_intake_extractions/i.test(sql), 'original Student Intake must coexist with extracted signals');
check(/teaching_academic_audit_immutable/i.test(sql), 'academic audit log must be immutable');
check(/CREATE ROLE teaching_domain_service NOLOGIN/i.test(sql), 'trusted domain service role must be explicit');
check(/CREATE ROLE teaching_protected_service NOLOGIN/i.test(sql), 'protected preparation service role must be explicit');
check(tightSql.includes('REVOKEALLONSCHEMAteaching_protectedFROMPUBLIC,anon,authenticated;'), 'protected schema must be hidden from browser roles');
check(tightSql.includes('REVOKEALLONTABLEteaching_protected.prepared_artifact_payloadsFROMPUBLIC,anon,authenticated,service_role,teaching_domain_service,teaching_protected_service;'), 'protected payload table must clear inherited/default grants before explicit grants');
check(tightSql.includes('GRANTSELECT,INSERTONTABLEteaching_protected.prepared_artifact_payloadsTOservice_role,teaching_protected_service;'), 'protected payload access must be limited to the protected service boundary');
check(!/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,120}\sTO\s+(?:anon|authenticated)/i.test(sql), 'D04 must not grant browser DML on Teaching persistence');
check(!/GRANT\s+DELETE[\s\S]{0,140}\sTO\s+(?:service_role|teaching_domain_service)/i.test(sql), 'D04 least-privilege service roles must not receive academic DELETE');
check(/REVOKE ALL ON TABLE public\.%I FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service/.test(sql), 'D04 must clear inherited/default public-table privileges before selective grants');
check(/ALTER ROLE teaching_domain_service NOLOGIN NOBYPASSRLS/i.test(serviceRoleSql), 'domain service role must remain NOLOGIN/NOBYPASSRLS');
check(/ALTER ROLE teaching_protected_service NOLOGIN NOBYPASSRLS/i.test(serviceRoleSql), 'protected service role must remain NOLOGIN/NOBYPASSRLS');
check(/REVOKE teaching_domain_service, teaching_protected_service FROM anon, authenticated/i.test(serviceRoleSql), 'browser roles must not inherit trusted Teaching service roles');
check(/GRANT teaching_domain_service, teaching_protected_service TO service_role/i.test(serviceRoleSql), 'Supabase service_role must be able to assume the narrower D04 service roles');
for (const clause of ['FOR SELECT TO teaching_domain_service', 'FOR INSERT TO teaching_domain_service', 'FOR UPDATE TO teaching_domain_service']) {
  check(serviceRoleSql.includes(clause), `D04 service-role RLS migration missing ${clause}`);
}
check(/FOR SELECT TO teaching_protected_service USING \(true\)/i.test(serviceRoleSql), 'protected service role requires explicit RLS SELECT policy');
check(/FOR INSERT TO teaching_protected_service WITH CHECK \(true\)/i.test(serviceRoleSql), 'protected service role requires explicit RLS INSERT policy');
check(!/GRANT\s+(?:DELETE|TRUNCATE)[\s\S]{0,160}\sTO\s+(?:teaching_domain_service|teaching_protected_service)/i.test(serviceRoleSql), 'D04 service-role hardening must not add DELETE/TRUNCATE grants');

const contract = fs.readFileSync(path.join(root, 'teaching/security/d04-persistence-contract.js'), 'utf8');
for (const operation of ['grading.finalize','assessment.package.lock','attendance.authoritative.record','request.formal.decide','schedule.authority.update']) {
  check(contract.includes(operation), `missing privileged boundary: ${operation}`);
}
check(/protectedPreparationAuthorized/.test(contract), 'protected payload access must require explicit authorization');

const repositoryIndex = fs.readFileSync(path.join(root, 'teaching/repositories/index.js'), 'utf8');
check(repositoryIndex.includes('createTeachingKernelPersistence'), 'D04 kernel persistence seam must be exported through Teaching repositories');

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check(Boolean(packageJson.scripts?.['verify:teaching:d04']), 'package.json missing verify:teaching:d04');
check(Boolean(packageJson.scripts?.['test:teaching']), 'Teaching unit test command must remain registered');
check(Boolean(packageJson.scripts?.['test:teaching:integration']), 'Teaching integration test command must remain registered');

// D04 owns exactly its two migration files. Later accepted deliveries are
// expected to add later Teaching migrations; their mere presence must not make
// the predecessor verifier permanently fail. Preserve the original D04 scope
// guard by checking that D05 runtime artifacts were not absorbed into D04-owned
// migrations.
const d04OwnedMigrationFiles = fs.readdirSync(path.join(root, 'migrations'))
  .filter((name) => /teaching_d04/i.test(name))
  .sort();
check(
  JSON.stringify(d04OwnedMigrationFiles) === JSON.stringify([
    '20260925_teaching_d04_kernel_persistence.sql',
    '20260925_teaching_d04_service_role_rls_hardening.sql',
  ]),
  `unexpected D04-owned migration set: ${d04OwnedMigrationFiles.join(', ')}`
);
for (const futureArtifact of [
  'teaching_runtime.orchestration_executions',
  'teaching_runtime.event_outbox',
  'teaching.preparation.workspace_state_transition',
  'teaching.preparation.materiality_staleness_reconciliation',
  'teaching.preparation.finalization_readiness_gate',
  'teaching.preparation.protected_content_isolation',
]) {
  check(
    !sql.includes(futureArtifact) && !serviceRoleSql.includes(futureArtifact),
    `D04-owned migrations must not absorb later-delivery artifact: ${futureArtifact}`
  );
}

if (!process.exitCode) console.log('[D04] PASS: kernel persistence, RLS/service-role boundaries, audit, coverage/eligibility and PPL storage contracts are structurally complete.');
