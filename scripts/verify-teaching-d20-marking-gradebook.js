'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {assertD20TaskAccounting,D20_TASK_IDS}=require('../teaching/d20/task-accounting');
const {TPF15,TPF16,DEFAULT_CATEGORY_WEIGHTS}=require('../teaching/d20/contracts');

const ROOT=path.resolve(__dirname,'..');
const read=(relative)=>fs.readFileSync(path.join(ROOT,relative),'utf8');
const exists=(relative)=>fs.existsSync(path.join(ROOT,relative));
function assert(condition,message){if(!condition)throw new Error(`[D20 verify] ${message}`);}
function range(prefix,start,end){const out=[];for(let n=start;n<=end;n++)out.push(`${prefix}${String(n).padStart(4,'0')}`);return out;}

const expectedTasks=Object.freeze([
  'TCH-0057','TCH-0058',
  ...range('TCH-',395,426),
  ...range('TCH-',760,763),
]);
const accounting=assertD20TaskAccounting();
assert(accounting.taskCount===38,'canonical delivery must account for exactly 38 tasks');
assert(JSON.stringify([...D20_TASK_IDS])===JSON.stringify(expectedTasks),'task accounting must exactly match the frozen D20 assignment');

const migrations=[
  'migrations/20261002_teaching_d20_marking_gradebook.sql',
  'migrations/20261002_teaching_d20_gradebook_lineage_hardening.sql',
  'migrations/20261002_teaching_d20_policy_guards.sql',
  'migrations/20261002_teaching_d20_service_role_grant_hardening.sql',
  'migrations/20261003_teaching_d20_corrective_academic_guards.sql',
];
for(const migration of migrations)assert(exists(migration),`missing migration ${migration}`);
const setup=read('scripts/setup-teaching-integration-db.js');
for(const migration of migrations)assert(setup.includes(migration),`isolated reconstruction omits ${migration}`);
const grantHardening=read('migrations/20261002_teaching_d20_service_role_grant_hardening.sql');
assert(grantHardening.includes('REVOKE UPDATE, DELETE, TRUNCATE ON'),'production default service-role mutation grants must be explicitly revoked');
assert(grantHardening.includes('GRANT UPDATE ON public.teaching_assessment_results, public.teaching_grade_appeals TO service_role'),'only D20 result and appeal state carriers may retain service-role UPDATE');
const academicGuards=read('migrations/20261003_teaching_d20_corrective_academic_guards.sql');
assert(academicGuards.includes('teaching_d20_result_snapshot_integrity_guard'),'TCH-0396 final-response snapshot integrity database guard missing');
assert(academicGuards.includes('teaching_d20_follow_through_authorization_guard'),'TCH-0397/TCH-0399 follow-through database guard missing');
assert(academicGuards.includes('proposed_credit <= criterion_max_marks'),'criterion upper-bound database constraint missing');

const contracts=read('teaching/d20/contracts.js');
const intelligence=read('teaching/d20/intelligence.js');
const authority=read('teaching/d20/authority-service.js');
const corrected=read('teaching/d20/corrected-authority-service.js');
const assessmentBoundary=read('teaching/d20/assessment-boundary-service.js');
const routes=read('teaching/d20/routes.js');
const index=read('teaching/d20/index.js');
const repository=read('teaching/repositories/d20-gradebook.js');
const unit=read('tests/teaching/unit/d20-marking-gradebook.test.js');
const correctiveTests=read('tests/teaching/unit/d20-corrective-hardening.test.js');
const boundaryTests=read('tests/teaching/unit/d20-assessment-boundary.test.js');
const authorityTests=read('tests/teaching/unit/d20-authority-reflow.test.js');
const schemaTests=read('tests/teaching/integration/d20-marking-gradebook-schema.test.js');
const correctiveSchemaTests=read('tests/teaching/integration/d20-corrective-academic-guards-schema.test.js');

assert(TPF15.family==='TPF-15'&&TPF15.sha256==='a088a74f044082abb126952939bc3fe627b273b1cfea166833fae87afbc8dcdb','TPF-15 frozen binding drifted');
assert(TPF16.family==='TPF-16'&&TPF16.sha256==='278c45b97de8ceff9e6307543bea1072d51d244ccf21b7b16ca8a98d3c5daeda','TPF-16 frozen binding drifted');
assert(Math.abs(Object.values(DEFAULT_CATEGORY_WEIGHTS).reduce((a,b)=>a+b,0)-1)<1e-12,'default category budgets must sum to 100%');

for(const forbidden of ['attendance','teacher_personality','previous_gpa','peer_performance','current_course_total','grade_boundary_position','student_reputation'])assert(contracts.includes(`'${forbidden}'`),`T4 context firewall is missing ${forbidden}`);
assert(intelligence.includes('commit:false'),'AI orchestration must remain non-committing');
assert(intelligence.includes('gradebook_commit_external'),'AI result contracts must keep Gradebook commit external');
assert(intelligence.includes('original_credit_seen')&&intelligence.includes('freeze_before_comparison_required'),'TPF-16 blind Pass A controls are missing');

assert(authority.includes('TEACHING_D20_APPEAL_DIRECTION_REQUEST_FORBIDDEN'),'appeal request cannot own review direction');
assert(authority.includes('TEACHING_D20_APPEAL_DIRECTION_AUTHORITY_REQUIRED'),'configured appeal direction must cite authority');
assert(authority.includes("item.item_state)==='INVALIDATED'"),'TCH-0425 reflow must bind to D17 INVALIDATED item state');
assert(authority.includes('ITEM_INVALIDATION_RECALCULATION'),'invalidation reflow must emit an explicit correction reason');
assert(authority.includes("owner:'D21'")&&authority.includes('gpaMutationByD20:false'),'D20 must hand corrected truth downstream without taking D21 GPA authority');

assert(corrected.includes('TEACHING_D20_RESPONSE_CAPTURE_INTEGRITY_VIOLATION'),'TCH-0396 response-capture integrity fail-closed guard missing');
assert(corrected.includes('TEACHING_D20_FOLLOW_THROUGH_NOT_AUTHORIZED'),'TCH-0397/TCH-0399 locked-rubric follow-through guard missing');
assert(corrected.includes('TEACHING_D20_TPF15_CRITERION_COVERAGE_INVALID'),'TCH-0760 criterion coverage gate missing');
assert(corrected.includes('TEACHING_D20_DEDUCTION_RESOLUTION_REQUIRED'),'TCH-0396 unresolved deduction fail-closed gate missing');
assert(corrected.includes("run_kind==='AUTHORIZED_CORRECTION'")&&corrected.includes('sort(newestFirst)'),'repeat-appeal corrections must select the newest authorized correction');
assert(assessmentBoundary.includes('selected_option_ids')&&assessmentBoundary.includes('provisional_answer_key'),'TCH-0395 D17/D18 objective response compatibility boundary missing');
assert(assessmentBoundary.includes("canonicalFamily='CONSTRUCTED'")&&assessmentBoundary.includes('unitRequired'),'unsafe unit-bearing/structured renderer semantics must not bypass rubric marking');
assert(routes.includes("require('./assessment-boundary-service')"),'runtime routes must use the D17/D18-to-D20 Assessment boundary');
assert(index.includes("require('./assessment-boundary-service')"),'D20 public module must export the Assessment-boundary authority service');
assert(routes.includes('/results/:resultId/recalculate-invalidation'),'runtime must expose the authoritative invalidation recalculation trigger');
assert(!routes.includes('reviewDirectionPolicy:direction'),'routes must not inject request-owned appeal direction');

for(const table of ['teaching_grading_policies','teaching_assessment_results','teaching_marking_runs','teaching_marking_criterion_judgments','teaching_grade_appeals','teaching_gradebook_entries','teaching_topic_score_snapshots','teaching_course_result_snapshots','teaching_grade_change_audit'])assert(repository.includes(table),`authoritative repository missing ${table}`);

assert(unit.includes('assessment frequency cannot inflate a fixed category budget'),'TCH-0424 fixed-weight regression test missing');
assert(correctiveTests.includes('lost/corrupted evidence'),'TCH-0396 corrupted-response regression test missing');
assert(correctiveTests.includes('follow-through credit is accepted only'),'TCH-0397/TCH-0399 follow-through authorization regression test missing');
assert(correctiveTests.includes('complete authorized locked-rubric scope'),'TCH-0760 exact criterion-coverage regression test missing');
assert(correctiveTests.includes('negative-marking triggers fail closed'),'unresolved deterministic deduction regression test missing');
assert(correctiveTests.includes('newest authorized correction first'),'repeat-appeal latest-correction regression test missing');
assert(boundaryTests.includes('real D18 selected_option_ids'),'TCH-0395 real Assessment Shell selected-response regression test missing');
assert(boundaryTests.includes('unit-bearing numeric response does not bypass'),'TCH-0395 unit-bearing numeric safety regression test missing');
assert(boundaryTests.includes('multipart STRUCTURED'),'D18 multipart response classification regression test missing');
assert(authorityTests.includes('TCH-0425 invalidated question recalculates'),'TCH-0425 invalidation recalculation regression test missing');
const appealTests=read('tests/teaching/unit/d20-appeal-recalculation.test.js');
const moderationTests=read('tests/teaching/unit/d20-moderation-escalation.test.js');
assert(appealTests.includes('TCH-0425 successful appeal deterministically recalculates'),'TCH-0425 successful-appeal recalculation regression test missing');
assert(moderationTests.includes('TCH-0763 material high-stakes moderation disagreement'),'TCH-0763 service-level moderation escalation regression test missing');
assert(unit.includes('T4 marking context excludes attendance personality GPA'),'TCH-0426 T4 context firewall regression test missing');
assert(unit.includes('TPF-16 Pass A must be genuinely blind'),'TCH-0763 blind-first regression test missing');
assert(unit.includes('material marker disagreement escalates and is never averaged'),'TCH-0763 disagreement escalation regression test missing');
assert(schemaTests.includes('teaching_gradebook_entries'),'D20 schema reconstruction test missing Gradebook coverage');
assert(schemaTests.includes("grantee in ('anon','authenticated')"),'D20 schema/security test must exercise browser/authenticated authority boundaries');
assert(schemaTests.includes("grantee='service_role'")&&schemaTests.includes("privilege_type in ('UPDATE','DELETE','TRUNCATE')"),'D20 schema/security test must enforce narrow service-role mutation grants');
assert(correctiveSchemaTests.includes('teaching_d20_result_snapshot_integrity_guard'),'corrective final-snapshot database guard integration test missing');
assert(correctiveSchemaTests.includes('teaching_d20_follow_through_authorization_guard'),'corrective follow-through database guard integration test missing');

const workflow='.github/workflows/teaching-d20-marking-gradebook.yml';
assert(exists(workflow),'D20 same-head CI workflow is missing');
const ci=read(workflow);
for(const required of ['verify:teaching:d20','d20-marking-gradebook.test.js','d20-corrective-hardening.test.js','d20-assessment-boundary.test.js','d20-authority-reflow.test.js','d20-appeal-recalculation.test.js','d20-moderation-escalation.test.js','d20-corrective-academic-guards-schema.test.js','test:teaching:integration','build:web'])assert(ci.includes(required),`D20 CI is missing ${required}`);

console.log(`[D20 verify] PASS — ${accounting.taskCount} frozen tasks, 5 migrations, TPF-15/16 authority boundaries, D17/D18 Assessment response reconciliation, corrective academic guards, QA invariants, production grant hardening and same-head CI are registered.`);
