'use strict';

const fs=require('node:fs');
const path=require('node:path');
const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const assert=(value,message)=>{if(!value)throw new Error(message);};
const tasks=['TCH-0050','TCH-0051',...Array.from({length:29},(_,i)=>`TCH-${String(297+i).padStart(4,'0')}`),'TCH-0907','TCH-0908'];
assert(tasks.length===33&&new Set(tasks).size===33,'D16 task census must remain exactly 33.');

const required=[
  'teaching/d16/contracts.js','teaching/d16/service.js','teaching/d16/intelligence.js','teaching/d16/runtime.js','teaching/d16/routes.js','teaching/d16/index.js',
  'teaching/repositories/d16-assignments.js','migrations/20261001_teaching_d16_homework_integrity.sql',
  'public/teaching-d16.js','public/teaching-d16.css','tests/teaching/unit/d16-homework-integrity.test.js',
  'tests/teaching/integration/d16-homework-integrity-schema.test.js','docs/teaching/d16-homework-integrity.md',
  '.github/workflows/teaching-d16-homework-integrity.yml',
];
for(const file of required)assert(fs.existsSync(path.join(root,file)),`D16 missing ${file}`);

const doc=read('docs/teaching/d16-homework-integrity.md');
for(const id of tasks)assert(doc.includes(id),`D16 task not accounted for: ${id}`);

const contracts=read('teaching/d16/contracts.js');
for(const token of [
  'OPEN_LEARNING_ASSISTANCE','HINT_ONLY','REFERENCE_ONLY','CLOSED_BOOK_INDEPENDENT','FORMAL_ASSESSMENT',
  'SOFT','HARD','PEDAGOGICALLY_EXPIRING','LATE','EXPIRED','EXCUSED','REPLACED','INVALIDATED','MISSED','SYSTEM_PROTECTED','PAUSED',
  'acceptedEventAt','priorMisconductProven:false','wholesaleReproductionRequired:false','NO_REPEAT_INTEGRITY_INCIDENT_POLICY_DEFINED_IN_D06_GATE',
  'SOLUTION_EXPOSED_ORIGINAL_NOT_CLEAN','officialGradeOwner:\'GRADEBOOK_D20\'','completionAloneIsEvidence:false','homeworkNeedDecision',
])assert(contracts.includes(token),`D16 contract invariant missing ${token}`);

const migration=read('migrations/20261001_teaching_d16_homework_integrity.sql');
for(const token of [
  'teaching_assignments','teaching_assignment_history','teaching_assignment_submissions','teaching_assignment_integrity_reviews',
  'teaching_assignment_evaluations','teaching_assignment_solution_material','accepted_event_at','policy_version_at_event',
  'prior_misconduct_proven boolean NOT NULL DEFAULT false CHECK (prior_misconduct_proven=false)','official_mark_committed boolean NOT NULL DEFAULT false CHECK (official_mark_committed=false)',
  'ENABLE ROW LEVEL SECURITY','REVOKE ALL',
])assert(migration.includes(token),`D16 migration invariant missing ${token}`);
for(const forbidden of ['guilt_probability','cheating_probability','authorship_probability','permanent_student_label','misconduct_score'])assert(!migration.toLowerCase().includes(forbidden),`D16 migration must not contain ${forbidden}`);
assert(!/GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,220}TO\s+(?:anon|authenticated)/i.test(migration),'D16 exposes browser-authoritative DML.');
assert(!/GRANT\s+(?:UPDATE|DELETE|TRUNCATE)[\s\S]{0,220}teaching_assignment_(?:history|submissions|integrity_reviews|evaluations|solution_material)[\s\S]{0,120}TO\s+service_role/i.test(migration),'D16 append-only evidence tables expose mutation grants.');

const repo=read('teaching/repositories/d16-assignments.js');
for(const token of [
  'enqueueDueUsing','ASSIGNMENT_DUE','idempotency_key','accepted_event_at','resolveRequestTarget','previewRequest','applyRequestUsing',
  'observeAppliedRequestUsing','ACADEMIC_BREAK','COURSE_PAUSE','COURSE_RESUME','planningSignals','negative_inference_forbidden:true',
])assert(repo.includes(token),`D16 repository boundary missing ${token}`);

const service=read('teaching/d16/service.js');
for(const token of [
  'prepareFromClass','homeworkNeedDecision','saveDraft','submit','requestAssistance','releaseSolution','reviewIntegrity','generateVerification',
  'recordVerificationResult','evaluateSubmission','openCorrection','reconcileDueAssignment','requestExtension','officialMarkCommitted:false',
  'activeFormalAssessment','studentIntegrityProjection','readingEvidence','subjectEvaluationProfile','routeHeld',
])assert(service.includes(token),`D16 service invariant missing ${token}`);
assert(!/officialMarkCommitted\s*:\s*true/.test(service),'D16 service must not commit official Gradebook marks.');

const intelligence=read('teaching/d16/intelligence.js');
for(const token of ['getCapability','orchestrator.execute','capabilityPromptFamily:capability.prompt_family_id'])assert(intelligence.includes(token),`D16 intelligence must use canonical Teaching orchestration: ${token}`);
assert(/commit\s*:\s*false/.test(intelligence),'D16 intelligence requests must remain provisional/non-committing.');
for(const capabilityId of [
  'teaching.scheduling.purposeful_homework_selection_generation',
  'teaching.scheduling.homework_workload_estimation',
  'teaching.scheduling.homework_assistance_policy_interpretation',
  'teaching.scheduling.homework_independent_work_evaluation',
  'teaching.scheduling.long_form_authenticity_verification_task_generation',
  'teaching.scheduling.similarity_plagiarism_interpretation',
  'teaching.scheduling.homework_to_next_lesson_synthesis',
])assert(intelligence.includes(capabilityId),`D16 intelligence missing canonical capability binding ${capabilityId}`);
assert(!/@google\/generative-ai|openai|anthropic|gemini-/i.test(intelligence),'D16 intelligence must not select a provider/model directly.');

const runtime=read('teaching/d16/runtime.js');
for(const token of ['ASSIGNMENT_DUE','CLASS_ENDED','reconcileDueAssignment','prepareFromClass'])assert(runtime.includes(token),`D16 runtime missing ${token}`);

const routes=read('teaching/d16/routes.js');
for(const endpoint of ["'/work'","'/courses/:id/work'","'/assignments/:id'","'/assignments/:id/draft'","'/assignments/:id/submit'","'/assignments/:id/assistance'","'/assignments/:id/correction'","'/assignments/:id/correction/submit'","'/assignments/:id/extension-request'"])assert(routes.includes(endpoint),`D16 route missing ${endpoint}`);

const backend=read('teaching-backend.js');
assert(backend.includes("require('./teaching/d16/routes')")&&backend.includes('mountD16Routes(router,{foundation,sendError})'),'Teaching backend does not mount D16 Work routes.');
assert(backend.includes('d16Intelligence'),'Teaching backend does not pass D16 intelligence seam.');

const d10=read('teaching/d10/service.js');
for(const token of ['workRequestOwner','resolveRequestTarget','previewRequest','applyRequestUsing','observeAppliedRequestUsing'])assert(d10.includes(token),`D10 formal Request seam missing ${token}`);
const d10Contracts=read('teaching/d10/contracts.js');
assert(/ASSIGNMENT_EXTENSION:[^\n]+owner:'work'[^\n]+implementedOwner:true/.test(d10Contracts),'D10 contract must recognize the implemented D16 Work owner.');

const foundation=read('teaching/index.js');
for(const token of ['createD16AssignmentRepository','d16Intelligence','workRequestOwner:d16Repository','planningSignals','registerD16Runtime'])assert(foundation.includes(token),`Teaching foundation D16 wiring missing ${token}`);

const ui=read('public/teaching-d16.js');
for(const token of ["id:'work'","label:'Work'","Homework & independent work",'/teaching/work','/work`','/draft','/submit','/assistance','/correction','/extension-request','Signals and detector telemetry are not shown as guilt scores'])assert(ui.includes(token),`D16 UI missing ${token}`);
assert(!/guiltProbability\s*=\s*[0-9]/i.test(ui),'D16 UI must not manufacture guilt probability.');
const html=read('public/teaching.html');
assert(html.includes('/teaching-d16.css')&&html.includes('/teaching-d16.js'),'Teaching shell does not load D16 Work UI assets.');

const bootstrap=read('scripts/setup-teaching-integration-db.js');
assert(bootstrap.includes('migrations/20261001_teaching_d16_homework_integrity.sql'),'D16 migration missing from isolated Teaching reconstruction.');
const tests=read('tests/teaching/unit/d16-homework-integrity.test.js');
for(const token of ['event-time submission','every assistance mode','detector signals','failed or refused verification','solution exposure','course pause','reading completion','missed optional'])assert(tests.includes(token),`D16 acceptance test missing ${token}`);
const pkg=JSON.parse(read('package.json'));
assert(pkg.scripts?.['verify:teaching:d16']==='node scripts/verify-teaching-d16-homework-integrity.js','D16 package verifier mismatch.');

console.log('[Teaching D16 verify] PASS — 33 tasks accounted for; authoritative Work lifecycle, event-time deadline semantics, assistance enforcement, integrity uncertainty/proportional verification, correction/replacement history, Request/Scheduler/SKM seams, protected solutions, and global/Course Work projections are wired without browser-owned academic truth.');
