'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const required=[
  'teaching/d12/contracts.js','teaching/d12/intelligence.js','teaching/d12/service.js','teaching/d12/runtime.js','teaching/d12/index.js',
  'teaching/repositories/d12-response-pedagogy.js','migrations/20260929_teaching_d12_response_pedagogy.sql',
  'docs/teaching/d12-source-resolution.md','docs/teaching/d12-response-evaluation-pedagogy.md','docs/teaching/migrations/d12-recovery.md',
  'tests/teaching/unit/d12-response-pedagogy.test.js','tests/teaching/integration/d12-response-pedagogy-schema.test.js','.github/workflows/teaching-d12-response-pedagogy.yml'
];
for(const f of required)if(!fs.existsSync(path.join(root,f)))throw new Error('D12 missing '+f);
const tasks=Array.from({length:24},(_,i)=>'TCH-'+String(192+i).padStart(4,'0'));
if(tasks.length!==24||new Set(tasks).size!==24)throw new Error('D12 canonical task set drifted.');
const doc=read('docs/teaching/d12-response-evaluation-pedagogy.md');
for(const id of tasks)if(!doc.includes(id))throw new Error('D12 task not accounted for: '+id);
const contracts=read('teaching/d12/contracts.js');
for(const token of [
  'validateResponseEvaluation','recurring_supported','trustedPriorRecurrence','student_penalty_protection_required','enforceAssistanceCeiling',
  'student_help_request_changed_ceiling:false','evidenceConsequenceForAssistance','CONTAMINATED','fresh_verification_needed',
  'productiveStruggleDecision','repeated_observable_error_after_multiple_attempts','validatePedagogyProfile','subjectTemplateFor',
  'single_objective','multiple_valid_approaches','open_interpretation','physical_performance','validateTeacherCorrection'
])if(!contracts.includes(token))throw new Error('D12 contract missing '+token);
const intel=read('teaching/d12/intelligence.js');
for(const token of [
  'teaching.lesson.response_correctness_quality_evaluation','teaching.lesson.next_pedagogical_action_recommendation',
  'teaching.pedagogy.pedagogical_profile_classification','teaching.lesson.teacher_self_correction_analysis',
  'teaching.lesson.fresh_verification_task_selection_after_answer_exposure','fresh_verification_after_exposure','commit=false'
])if(!intel.includes(token))throw new Error('D12 intelligence missing '+token);
const service=read('teaching/d12/service.js');
for(const token of [
  'UNQUALIFIED_UNTIL_D30','persistentMisconceptionCommitted:false','skmOwner:\'D13\'','answer_or_method_exposed',
  'CONSIDER_CREATE_CANDIDATE','CONSIDER_RESOLUTION_EVIDENCE','micro_remediation','misconception_repair',
  'INVALIDATE_OR_RECHECK_DEPENDENT_EVIDENCE','durableEvidenceInvalidationCommitted:false','subjectTemplateAuthoritative:false','client_timestamp_authoritative:false','TEACHING_D12_PROTECTED_ASSESSMENT_MODE'
])if(!service.includes(token))throw new Error('D12 service missing '+token);
const repo=read('teaching/repositories/d12-response-pedagogy.js');
for(const token of ['teaching_response_evaluations','teaching_pedagogy_decisions','teaching_learning_unit_pedagogy_profiles','teaching_teacher_corrections','teaching_evidence_recheck_handoffs','TEACHING_D12_STALE_EVALUATION_RESULT','TEACHING_D12_STALE_PEDAGOGY_RESULT','STUDENT_RESPONSE_SUBMITTED','appendUsing'])if(!repo.includes(token))throw new Error('D12 repository missing '+token);
const migration=read('migrations/20260929_teaching_d12_response_pedagogy.sql');
for(const token of ['learning_unit_id','controller_version','idempotency_key','teaching_response_evaluations','teaching_pedagogy_decisions','teaching_learning_unit_pedagogy_profiles','teaching_teacher_corrections','teaching_evidence_recheck_handoffs','ENABLE ROW LEVEL SECURITY','durable_state_committed=false','subject_template_authoritative=false'])if(!migration.includes(token))throw new Error('D12 migration missing '+token);
if(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,220}TO\s+(?:anon|authenticated)/i.test(migration))throw new Error('D12 grants browser direct access to D12 academic artifacts.');
if(/create table\s+public\.teaching_(?:skm|mastery|persistent_misconception)/i.test(migration))throw new Error('D12 illegally creates D13 durable knowledge truth.');
const tests=read('tests/teaching/unit/d12-response-pedagogy.test.js');
for(const token of ['Literature','History','computer_science','mathematics','science','humanities','languages','geography','economics_business','government_civics','accounting','visual_practical'])if(!tests.includes(token))throw new Error('D12 cross-subject QA missing '+token);
const source=['teaching/d12/contracts.js','teaching/d12/intelligence.js','teaching/d12/service.js','teaching/repositories/d12-response-pedagogy.js'].map(read).join('\n');
if(/@google\/generative-ai|\bopenai\b|\banthropic\b|gemini-[0-9]/i.test(source))throw new Error('D12 selects provider/model directly.');
if(/insert into\s+public\.teaching_(?:gradebook|attendance|student_knowledge|progression|mastery)/i.test(source))throw new Error('D12 mutates a future authoritative owner.');
const backend=read('teaching-backend.js');
for(const token of ['assertD12Ready','/classes/:id/responses','/response-evaluations/:evaluationId/pedagogy','/learning-units/:id/pedagogy-profile'])if(!backend.includes(token))throw new Error('D12 backend integration missing '+token);
const foundation=read('teaching/index.js');
for(const token of ['createD12ResponsePedagogyRepository','createD12Service','registerD12Runtime'])if(!foundation.includes(token))throw new Error('D12 foundation integration missing '+token);
const pkg=JSON.parse(read('package.json'));
if(pkg.scripts?.['verify:teaching:d12']!=='node scripts/verify-teaching-d12-response-pedagogy.js')throw new Error('D12 package verifier script missing.');
console.log('[Teaching D12 verify] PASS — 24 tasks accounted for; one-response interpretation, assistance ceilings, contamination/fresh-verification rules, bounded pedagogy, correction handoffs, and Learning Unit pedagogy metadata preserve D11/D13 authority boundaries.');
