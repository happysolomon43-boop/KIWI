'use strict';

const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

const required=[
  'teaching/d11/contracts.js','teaching/d11/intelligence.js','teaching/d11/service.js','teaching/d11/runtime.js','teaching/d11/index.js',
  'teaching/repositories/d11-lesson-controller.js','migrations/20260929_teaching_d11_lesson_controller.sql',
  'docs/teaching/d11-source-resolution.md','docs/teaching/d11-lesson-controller.md','docs/teaching/migrations/d11-recovery.md',
  'tests/teaching/unit/d11-lesson-controller.test.js','tests/teaching/integration/d11-lesson-controller-schema.test.js',
];
for(const file of required) if(!fs.existsSync(path.join(root,file))) throw new Error('D11 missing '+file);

const tasks=[
  'TCH-0170','TCH-0171','TCH-0172','TCH-0173','TCH-0174','TCH-0175','TCH-0176','TCH-0177','TCH-0178','TCH-0179',
  'TCH-0180','TCH-0181','TCH-0182','TCH-0183','TCH-0184','TCH-0185','TCH-0186','TCH-0187','TCH-0188','TCH-0189',
  'TCH-0190','TCH-0191','TCH-0888','TCH-0905',
];
if(tasks.length!==24||new Set(tasks).size!==24) throw new Error('D11 canonical task set drifted.');
const accounting=read('docs/teaching/d11-lesson-controller.md');
for(const id of tasks) if(!accounting.includes(id)) throw new Error('D11 task not accounted for: '+id);

const sourceResolution=read('docs/teaching/d11-source-resolution.md');
for(const token of [
  '4e6ce342fec0a6b5d4ad55daf098b85ae116052a','TPF-05','TPF-19','TPF-09','D30','D31',
  'D13 SKM','D16 Work','teaching.request.applied',
]) if(!sourceResolution.includes(token)) throw new Error('D11 source-resolution record missing '+token);

const contracts=read('teaching/d11/contracts.js');
for(const token of [
  'CONCEPTUAL_CORRECTNESS','BLOCKING_PREREQUISITES','CORE_OBJECTIVES','INDEPENDENT_EVIDENCE','ENRICHMENT',
  'OPENING','DIAGNOSTIC','INSTRUCTION','GUIDED_PRACTICE','INDEPENDENT_PRACTICE','CLASSWORK','REMEDIATION',
  'BREAK','ASSESSMENT','CLOSURE','INTERRUPTED','DEMONSTRATION','INDEPENDENT_FAMILIAR','METHOD_SELECTION',
  'INTEGRATION_TRANSFER','TEACH','ELICIT_CHECK','DIAGNOSE','RESPOND','VERIFY','15 * 60_000',
  'student_translation_fact_pack','official_marks_included: false','mastery_claim_included: false',
]) if(!contracts.includes(token)) throw new Error('D11 contract invariant missing '+token);

const intelligence=read('teaching/d11/intelligence.js');
for(const token of [
  "teaching.lesson.pre_class_lesson_planning","teaching.lesson.live_lesson_replanning",
  "teaching.lesson.lesson_closure_analysis","teaching.lesson.student_facing_class_summary_generation",
  "teaching.lesson.internal_post_class_teacher_note_generation","commit: false",
  "active_assessment_answers_included: false","idempotencyKey",
]) if(!intelligence.includes(token)) throw new Error('D11 intelligence contract missing '+token);

const service=read('teaching/d11/service.js');
for(const token of [
  'ensurePreparationWorkspace','evaluateFinalizationReadiness','validateLiveReplanProposal','earlyClosureReadiness',
  'BREAK_END_DUE','OVERTIME_CEILING','MODEL_ROUTE_UNQUALIFIED','refreshCoursePreparation',
  'ROUTE_HELD','PRIVATE_NOTE','assertLiveContextCurrent',
]) if(!service.includes(token)) throw new Error('D11 service invariant missing '+token);

const runtime=read('teaching/d11/runtime.js');
for(const token of [
  'COURSE_ACTIVATED','REQUEST_DECIDED','REQUEST_APPLIED','CLASS_START_DUE','BREAK_END_DUE','CLASS_END_DUE',
  'ACTIONABLE','ALREADY_SATISFIED','SUPERSEDED','d11-request-applied-materiality',
]) if(!runtime.includes(token)) throw new Error('D11 runtime invariant missing '+token);

const repo=read('teaching/repositories/d11-lesson-controller.js');
for(const token of [
  'teaching_preparation.workspaces','authoritative_input_bundles','artifact_versions','component_dependencies',
  'TEACHING_D11_STALE_CONTEXT','TEACHING_D11_STALE_CONTROLLER_VERSION','CONTROLLER_STARTED_ROUTE_HELD',
  'teaching_class_closure_facts','teaching_class_summaries','teaching_post_class_teacher_notes',
]) if(!repo.includes(token)) throw new Error('D11 repository invariant missing '+token);

const migration=read('migrations/20260929_teaching_d11_lesson_controller.sql');
for(const token of [
  'teaching_class_controller_history','teaching_class_closure_facts','teaching_class_summaries',
  'teaching_post_class_teacher_notes','cycle_phase','overtime_ceiling_at',"interval '15 minutes'",
  'ENABLE ROW LEVEL SECURITY','teaching_class_summaries_student_select',
  'teaching_preparation_d11_next_class_workspace_uidx',
]) if(!migration.includes(token)) throw new Error('D11 migration missing '+token);
if(/GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,220}TO\s+authenticated/i.test(migration)) {
  throw new Error('D11 grants browser authoritative mutation.');
}
if(/GRANT SELECT ON public\.teaching_post_class_teacher_notes TO authenticated/i.test(migration)) {
  throw new Error('D11 exposes private Teacher Note to authenticated browser role.');
}

const backend=read('teaching-backend.js');
for(const route of [
  '/classes/:id/controller','lesson-blueprint/prepare','controller/start','controller/transition','controller/cycle/advance',
  'controller/evidence-descriptor','controller/progress','controller/break','controller/overtime','controller/replan',
  'controller/close','/classes/:id/summary',
]) if(!backend.includes(route)) throw new Error('D11 backend route missing '+route);
if(/\/classes\/:id\/teacher-note/.test(backend)) throw new Error('D11 private Teacher Note exposed as student route.');

const d10=read('teaching/d10/service.js');
const events=read('teaching/events/names.js');
if(!events.includes("REQUEST_APPLIED: 'teaching.request.applied'")) throw new Error('D11 exact Request-application event missing.');
if(!d10.includes('eventType:TEACHING_EVENTS.REQUEST_APPLIED')||!d10.includes('outboxStore.appendUsing')) {
  throw new Error('D10 does not publish the committed Request-application fact required for D11 materiality.');
}

const source=[
  'teaching/d11/contracts.js','teaching/d11/intelligence.js','teaching/d11/service.js',
  'teaching/d11/runtime.js','teaching/repositories/d11-lesson-controller.js',
].map(read).join('\n').toLowerCase();
for(const bad of ['@google/generative-ai','gemini-1','gemini-2','gemini-3','anthropic sdk','openai sdk']) {
  if(source.includes(bad)) throw new Error('D11 selects a provider/model: '+bad);
}
if(/insert into\s+public\.teaching_(gradebook|attendance|student_knowledge|progression)/i.test(source)) {
  throw new Error('D11 creates future-domain authority.');
}
if(/active_assessment_answers_included:\s*true/i.test(source)) {
  throw new Error('D11 leaks active assessment answers into planning context.');
}

console.log('[Teaching D11 verify] PASS — all 24 tasks accounted for; Lesson Blueprint/PPL, deterministic Controller, live replan, server-time break/overtime/closure, Summary/Teacher Note and authority boundaries preserved.');
