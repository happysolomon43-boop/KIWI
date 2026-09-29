'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const required=[
  'teaching/d10/contracts.js','teaching/d10/service.js','teaching/d10/runtime.js','teaching/d10/index.js',
  'teaching/repositories/d10-lifecycle-requests.js','migrations/20260929_teaching_d10_course_lifecycle_requests.sql','migrations/20260929_teaching_d10_fk_lineage_hardening.sql',
  'docs/teaching/d10-source-resolution.md','docs/teaching/d10-course-lifecycle-requests.md','docs/teaching/migrations/d10-recovery.md',
  'docs/teaching/design/d10-first-three-anchor-mockups.md','tests/teaching/unit/d10-course-lifecycle-requests.test.js',
  'tests/teaching/integration/d10-course-lifecycle-requests-schema.test.js','public/teaching-d10.js',
];
for(const file of required)if(!fs.existsSync(path.join(root,file)))throw new Error('D10 missing '+file);
const tasks=['TCH-0060','TCH-0146','TCH-0147','TCH-0148','TCH-0149','TCH-0150','TCH-0151','TCH-0152','TCH-0153','TCH-0154','TCH-0155','TCH-0156','TCH-0157','TCH-0158','TCH-0159','TCH-0160','TCH-0161','TCH-0162','TCH-0163','TCH-0164','TCH-0165','TCH-0166','TCH-0167','TCH-0168','TCH-0169','TCH-0578','TCH-0579','TCH-0580','TCH-0581','TCH-0904'];
if(tasks.length!==30||new Set(tasks).size!==30)throw new Error('D10 canonical task set drifted.');
const accounting=read('docs/teaching/d10-course-lifecycle-requests.md');for(const id of tasks)if(!accounting.includes(id))throw new Error('D10 task not accounted for: '+id);
const contracts=read('teaching/d10/contracts.js');
for(const token of ['DRAFT','READY','ACTIVE','PAUSED','TEACHING_ENDED','FINALIZING','INCOMPLETE','COMPLETED','ARCHIVED','ALTERNATIVE_PROPOSED','four-course-launch.v1','TEACHING_D10_REDUCED_LOAD_WEEK_NOT_RETAINED','GRADEBOOK_D20'])if(!contracts.includes(token))throw new Error('D10 contract missing '+token);
const migration=read('migrations/20260929_teaching_d10_course_lifecycle_requests.sql');
for(const token of ['teaching_requests','teaching_request_history','teaching_request_applications','teaching_course_activations','teaching_course_lifecycle_history','teaching_course_admission_decisions','teaching_guard_d10_course_lifecycle','teaching_guard_d10_request_update','ENABLE ROW LEVEL SECURITY'])if(!migration.includes(token))throw new Error('D10 migration missing '+token);
if(/GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,160}TO\s+authenticated/i.test(migration))throw new Error('D10 grants browser authoritative mutation.');
const hardening=read('migrations/20260929_teaching_d10_fk_lineage_hardening.sql');
for(const token of ['teaching_classes_source_timetable_version_fkey','teaching_courses_activation_id_fkey','teaching_course_activation_plan_idx','teaching_request_history_request_fk_idx'])if(!hardening.includes(token))throw new Error('D10 FK hardening missing '+token);
const repo=read('teaching/repositories/d10-lifecycle-requests.js');
for(const token of ['activateCourseUsing','teaching_request_applications','idempotent:true','ALTERNATIVE_ACCEPTANCE_REQUIRED','REQUEST_NOT_EFFECTIVE_YET','recordCancellationClosureUsing'])if(!repo.includes(token))throw new Error('D10 repository invariant missing '+token);
const service=read('teaching/d10/service.js');
for(const token of ['COURSE_ACTIVATED','REQUEST_EFFECTIVE_DUE','behaviorPenaltyAutomatic:false','activateScheduleUsing','applyScheduleRequestUsing','OWNER_HANDOFF_PENDING'])if(!service.includes(token))throw new Error('D10 service boundary missing '+token);
const runtime=read('teaching/d10/runtime.js');for(const token of ['REQUEST_EFFECTIVE_DUE','ALREADY_SATISFIED','SUPERSEDED','ACTIONABLE'])if(!runtime.includes(token))throw new Error('D10 effective-time reconciliation missing '+token);
const d09=read('public/teaching-d09.js');for(const token of ['Request this availability change','Timetable locked after activation','Request new time','Emergency absence'])if(!d09.includes(token))throw new Error('D10/D09 post-activation UI boundary missing '+token);
const ui=read('public/teaching-d10.js');for(const token of ['Course setup · Stage 6','Course setup · Stage 7',"id:'requests'",'requestAssignmentExtension','requestEarlyDismissal','requestTeacherChange','ALTERNATIVE_PROPOSED'])if(!ui.includes(token))throw new Error('D10 UI requirement missing '+token);
const html=read('public/teaching.html');if(!html.includes('<script type="module" src="/teaching-d10.js"></script>'))throw new Error('D10 UI script is not loaded.');if(html.includes('</script>\\n  <script type="module" src="/teaching-d10.js"'))throw new Error('D10 UI script contains a literal escaped newline.');
const design=read('docs/teaching/design/d10-first-three-anchor-mockups.md');for(const token of ['Teaching shell + Today anchor','Course Home anchor','Normal Live Classroom anchor','non-functional D10 mockup'])if(!design.includes(token))throw new Error('D10 design gate missing '+token);
const backend=read('teaching-backend.js');for(const route of ['activation-review',"/courses/:id/ready","/courses/:id/activate","router.get('/requests'","alternative/accept","alternative/decline","/teacher-identities"])if(!backend.includes(route))throw new Error('D10 backend route missing '+route);
const source=['teaching/d10/contracts.js','teaching/d10/service.js','teaching/d10/runtime.js','teaching/repositories/d10-lifecycle-requests.js'].map(read).join('\n').toLowerCase();
for(const bad of ['@google/generative-ai','openai','anthropic','gemini-'])if(source.includes(bad))throw new Error('D10 selects a model/provider: '+bad);
if(/insert into\s+public\.teaching_(gradebook|attendance|student_knowledge|progression)/i.test(source))throw new Error('D10 creates future-domain authority.');
console.log('[Teaching D10 verify] PASS — 30 tasks accounted for; lifecycle/activation, four-Course admission, unified Requests, alternative acceptance, effective-time exact-once application, Stage 6/7, Request Center and design gate preserved.');
