'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

function fail(message) { console.error('[D04] FAIL:', message); process.exitCode = 1; }
function check(condition, message) { if (!condition) fail(message); }

const migrationPath = path.join(root, 'migrations', '20260925_teaching_d04_kernel_persistence.sql');
const required = [
  'migrations/20260925_teaching_d04_kernel_persistence.sql',
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
check(/REVOKE ALL ON SCHEMA teaching_protected FROM PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated/i.test(sql), 'protected schema must be hidden from browser roles');
check(/REVOKE ALL ON TABLE teaching_protected\\.prepared_artifact_payloads FROM PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*teaching_domain_service/i.test(sql), 'ordinary Teaching domain role must not read protected payloads');
check(!/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,120}\sTO\s+(?:anon|authenticated)/i.test(sql), 'D04 must not grant browser DML on Teaching persistence');
check(!/GRANT\s+DELETE[\s\S]{0,140}\sTO\s+(?:service_role|teaching_domain_service)/i.test(sql), 'D04 least-privilege service roles must not receive academic DELETE');
check(/REVOKE ALL ON TABLE public\.%I FROM PUBLIC,anon,authenticated,service_role,teaching_domain_service/.test(sql), 'D04 must clear inherited/default public-table privileges before selective grants');

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

const migrationFiles = fs.readdirSync(path.join(root, 'migrations')).filter((name) => /teaching_d0[5-9]|teaching_d1\d|teaching_d2\d|teaching_d3\d/i.test(name));
check(migrationFiles.length === 0, `D04 must not pull future Teaching migrations forward: ${migrationFiles.join(', ')}`);

if (!process.exitCode) console.log('[D04] PASS: kernel persistence, RLS, audit, coverage/eligibility and PPL storage contracts are structurally complete.');
