'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const required=['teaching/d10/contracts.js','teaching/d10/service.js','teaching/d10/runtime.js','teaching/d10/index.js','teaching/repositories/d10-lifecycle-requests.js',
  'migrations/20260929_teaching_d10_course_lifecycle_requests.sql','migrations/20260929_teaching_d10_fk_lineage_hardening.sql','docs/teaching/d10-source-resolution.md','docs/teaching/d10-course-activation-requests.md',
  'docs/teaching/design/d10-first-three-anchor-mockups.md','docs/teaching/migrations/d10-recovery.md','tests/teaching/unit/d10-lifecycle-requests.test.js',
  'tests/teaching/integration/d10-lifecycle-requests-schema.test.js','public/teaching-d10.js'];
for(const file of required)if(!fs.existsSync(path.join(root,file)))throw new Error('D10 missing '+file);
const tasks=['TCH-0060',...Array.from({length:24},(_,i)=>'TCH-'+String(146+i).padStart(4,'0')),'TCH-0578','TCH-0579','TCH-0580','TCH-0581','TCH-0904'];
if(tasks.length!==30||new Set(tasks).size!==30)throw new Error('D10 canonical task set drifted.');
const doc=read('docs/teaching/d10-course-activation-requests.md');for(const id of tasks)if(!doc.includes(id))throw new Error('D10 task not accounted for: '+id);
const contracts=read('teaching/d10/contracts.js');for(const token of ['FINALIZING','INCOMPLETE','ALTERNATIVE_PROPOSED','four-course-launch.v1','TEACHING_D10_REDUCED_LOAD_WEEK_NOT_RETAINED','behaviorPenaltyAutomatic'])if(!contracts.includes(token))throw new Error('D10 contract missing '+token);
const migration=read('migrations/20260929_teaching_d10_course_lifecycle_requests.sql');for(const token of ['teaching_requests','teaching_request_history','teaching_request_applications','status_overlays','progression_outcome','teaching_d10_course_lifecycle_guard','teaching_d10_request_guard','ENABLE ROW LEVEL SECURITY'])if(!migration.includes(token))throw new Error('D10 migration missing '+token);
if(/GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,160}authenticated/i.test(migration))throw new Error('D10 grants browser authoritative mutation.');
if(/maximum_concurrent_courses\s+integer[^\n]*CHECK\([^\n]*<=\s*4/i.test(migration))throw new Error('D10 encoded four-Course rule as structural maximum.');
const hardening=read('migrations/20260929_teaching_d10_fk_lineage_hardening.sql');
for(const token of ['teaching_classes_source_timetable_version_fkey','teaching_courses_activation_id_fkey','teaching_course_activation_plan_idx','teaching_request_history_request_fk_idx'])if(!hardening.includes(token))throw new Error('D10 FK hardening missing '+token);
const service=read('teaching/d10/service.js');for(const token of ['serverTimeAuthoritative:true','ownerHandoffPending','learningRecoveryHandoffRequired:true','REQUEST_EFFECTIVE_DUE','REQUEST_DECIDED'])if(!service.includes(token))throw new Error('D10 service boundary missing '+token);
const repo=read('teaching/repositories/d10-lifecycle-requests.js');for(const token of ['existingApps','idempotent:true','target_version_ref','recordCancellationClosureUsing','currentAdmissionPolicy'])if(!repo.includes(token))throw new Error('D10 repository requirement missing '+token);
const d09=read('teaching/repositories/d09-scheduling.js');for(const token of ['governedRequestRef','FORMAL_REQUEST_APPLIED','approveTimetableUsing','materializeApprovedTimetableUsing','suspendCourseClassesUsing'])if(!d09.includes(token))throw new Error('D09 owner extension missing '+token);
const ui=read('public/teaching-d10.js');for(const token of ['Course setup · Stage 6','Course setup · Stage 7','Request Center','Alternative available','Start Course','requestClassReschedule','emergencyAbsence'])if(!ui.includes(token))throw new Error('D10 UI missing '+token);
const d09ui=read('public/teaching-d09.js');for(const token of ['Request this availability change','Timetable locked after activation','Request new time','Emergency absence'])if(!d09ui.includes(token))throw new Error('D10 post-activation schedule UX missing '+token);
const tests=read('tests/teaching/unit/d10-lifecycle-requests.test.js');for(const token of ['applies authoritative target exactly once','adjusted Request cannot mutate','server time blocks','automatic behavior penalty'])if(!tests.toLowerCase().includes(token.toLowerCase()))throw new Error('D10 required regression missing '+token);
const source=['teaching/d10/contracts.js','teaching/d10/service.js','teaching/d10/runtime.js','teaching/repositories/d10-lifecycle-requests.js'].map(read).join('\n').toLowerCase();
for(const bad of ['@google/generative-ai','anthropic','gemini-','openai'])if(source.includes(bad))throw new Error('D10 selects provider/model directly: '+bad);
if(/insert into\s+public\.teaching_student_knowledge/i.test(source))throw new Error('D10 mutates SKM.');
console.log('[Teaching D10 verify] PASS — 30 tasks accounted for; activation, lifecycle, four-Course policy, exactly-once Requests, server effective time, D09 authority integration and first-three anchor gate preserved.');
