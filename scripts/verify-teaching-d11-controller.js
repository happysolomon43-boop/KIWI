'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const required=[
  'teaching/d11/contracts.js','teaching/d11/intelligence.js','teaching/d11/service.js','teaching/d11/runtime.js','teaching/d11/index.js',
  'teaching/repositories/d11-lesson-controller.js','migrations/20260929_teaching_d11_lesson_controller.sql',
  'migrations/20260929_teaching_d11_fk_lineage_hardening.sql','docs/teaching/d11-source-resolution.md',
  'docs/teaching/d11-lesson-blueprint-controller.md','docs/teaching/migrations/d11-recovery.md',
  'tests/teaching/unit/d11-lesson-controller.test.js','tests/teaching/integration/d11-lesson-controller-schema.test.js'
];
for(const f of required)if(!fs.existsSync(path.join(root,f)))throw new Error('D11 missing '+f);
const tasks=[...Array.from({length:22},(_,i)=>'TCH-'+String(170+i).padStart(4,'0')),'TCH-0888','TCH-0905'];
if(tasks.length!==24||new Set(tasks).size!==24)throw new Error('D11 canonical task set drifted.');
const doc=read('docs/teaching/d11-lesson-blueprint-controller.md');
for(const id of tasks)if(!doc.includes(id))throw new Error('D11 task not accounted for: '+id);
const contracts=read('teaching/d11/contracts.js');
for(const token of [
  'DEFAULT_ADAPTIVE_RESERVE_POLICY','minimum_ratio: 0.10','maximum_ratio: 0.15','OPENING','DIAGNOSTIC','INSTRUCTION',
  'GUIDED_PRACTICE','INDEPENDENT_PRACTICE','CLASSWORK','REMEDIATION','BREAK','ASSESSMENT','CLOSURE','INTERRUPTED',
  'CONCEPTUAL_CORRECTNESS','BLOCKING_PREREQUISITES','CORE_OBJECTIVES','INDEPENDENT_EVIDENCE','ELICIT_CHECK','DIAGNOSE','RESPOND','VERIFY',
  'DEMONSTRATION','GUIDED','INDEPENDENT_FAMILIAR','INDEPENDENT_VARIED','METHOD_SELECTION','DELAYED_RETRIEVAL','INTEGRATION_TRANSFER',
  'TEACHING_D11_REPLAN_CORE_DROPPED','TEACHING_D11_OVERTIME_CEILING_EXCEEDED','student_translation_fact_pack',
  'official_marks_included: false','mastery_claim_included: false','attendance_outcome_included: false'
])if(!contracts.includes(token))throw new Error('D11 contract missing '+token);
const intel=read('teaching/d11/intelligence.js');
for(const token of ['teaching.lesson.pre_class_lesson_planning','teaching.lesson.live_lesson_replanning','teaching.lesson.lesson_closure_analysis',
  'teaching.lesson.student_facing_class_summary_generation','teaching.lesson.internal_post_class_teacher_note_generation',
  'active_assessment_answers_included: false','student_translation_fact_pack','commit: false'])if(!intel.includes(token))throw new Error('D11 intelligence missing '+token);
const repo=read('teaching/repositories/d11-lesson-controller.js');
for(const token of ['ensurePreparationWorkspaceUsing','recordPreparationArtifact','currentDependencyVersion','CONTROLLER_STARTED_ROUTE_HELD',
  'academic_penalty_created:false','independent_performance=true','commitClosureUsing','teaching_class_closure_facts','idempotency_key'])
  if(!repo.includes(token))throw new Error('D11 repository missing '+token);
const service=read('teaching/d11/service.js');
for(const token of ['progressive_next_class_preparation','PRE_LOCK_READY','final_reconciliation','TEACHING_D11_CLIENT_FORCE_FORBIDDEN',
  'BREAK_END_DUE','CLASS_ENDED','processClassClosureArtifacts','analyzeClosure','UNQUALIFIED_UNTIL_D30'])
  if(!service.includes(token))throw new Error('D11 service missing '+token);
const runtime=read('teaching/d11/runtime.js');
for(const token of ['COURSE_ACTIVATED','REQUEST_APPLIED','CLASS_START_DUE','BREAK_END_DUE','CLASS_END_DUE','CLASS_ENDED',
  'PREPARATION_WORKSPACE_SEEDED','PREPARATION_INPUT_CHANGED','d11-request-applied-materiality','model_route_required_for_t0_start:false'])
  if(!runtime.includes(token))throw new Error('D11 runtime missing '+token);
const migration=read('migrations/20260929_teaching_d11_lesson_controller.sql');
for(const token of ['teaching_class_controller_history','teaching_class_closure_facts','teaching_class_summaries','teaching_post_class_teacher_notes',
  'ENABLE ROW LEVEL SECURITY','teaching_class_summaries_student_select',"interval '15 minutes'",'teaching_preparation_d11_next_class_workspace_uidx',
  'teaching_class_summaries_idempotency_uidx','teaching_post_class_teacher_notes_idempotency_uidx'])
  if(!migration.includes(token))throw new Error('D11 migration missing '+token);
if(/GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,220}TO\s+authenticated/i.test(migration))throw new Error('D11 grants browser authoritative mutation.');
const hardening=read('migrations/20260929_teaching_d11_fk_lineage_hardening.sql');
for(const token of ['teaching_class_sessions_course_fk_idx','teaching_class_sessions_plan_fk_idx','teaching_class_sessions_timetable_fk_idx',
  'teaching_lesson_blueprints_plan_fk_idx','teaching_class_closure_facts_course_fk_idx','teaching_post_class_teacher_notes_course_fk_idx'])
  if(!hardening.includes(token))throw new Error('D11 FK hardening missing '+token);
const d10=read('teaching/d10/service.js');
if(!d10.includes('eventType:TEACHING_EVENTS.REQUEST_APPLIED')||!d10.includes('outboxStore.appendUsing'))throw new Error('D11 needs committed D10 request application fact.');
const source=['teaching/d11/contracts.js','teaching/d11/intelligence.js','teaching/d11/service.js','teaching/d11/runtime.js','teaching/repositories/d11-lesson-controller.js'].map(read).join('\n');
if(/@google\/generative-ai|\bopenai\b|\banthropic\b|gemini-[0-9]/i.test(source))throw new Error('D11 selects provider/model directly.');
if(/insert into\s+public\.teaching_(gradebook|attendance|student_knowledge|progression)/i.test(source))throw new Error('D11 mutates a future owner.');
console.log('[Teaching D11 verify] PASS — 24 tasks accounted for; PPL preparation, validated Blueprint lineage, deterministic Controller, server-time break/overtime/closure, bounded summary translation, private Teacher Note and model-outage T0 preservation are present.');
