'use strict';

const fs=require('node:fs');
const path=require('node:path');
const root=process.cwd();
function read(rel){return fs.readFileSync(path.join(root,rel),'utf8');}
function assert(ok,msg){if(!ok)throw new Error(msg);}

const tasks=['TCH-0048','TCH-0049',...Array.from({length:22},(_,i)=>'TCH-'+String(216+i).padStart(4,'0')),'TCH-0764'];
assert(tasks.length===25&&new Set(tasks).size===25,'D13 task census must remain exactly 25.');

const required=[
  'teaching/d13/contracts.js','teaching/d13/state-engine.js','teaching/d13/intelligence.js','teaching/d13/service.js','teaching/d13/runtime.js','teaching/d13/index.js',
  'teaching/repositories/d13-student-knowledge.js','migrations/20260929_teaching_d13_student_knowledge_model.sql',
  'tests/teaching/unit/d13-skm.test.js','tests/teaching/integration/d13-skm-schema.test.js',
  'docs/teaching/d13-source-resolution.md','docs/teaching/d13-student-knowledge-model.md','docs/teaching/migrations/d13-recovery.md',
  '.github/workflows/teaching-d13-skm.yml',
];
for(const f of required)assert(fs.existsSync(path.join(root,f)),'D13 missing '+f);

const doc=read('docs/teaching/d13-student-knowledge-model.md');
for(const id of tasks)assert(doc.includes(id),'D13 task not accounted for: '+id);

const state=read('teaching/d13/state-engine.js');
for(const token of [
  'EVIDENCE_QUALITY_STATE_MACHINE_V1','skm-evidence-state-machine.v1','unresolvedMaterialContradiction',
  "'UNSEEN'","'INTRODUCED'","'ASSISTED'","'EMERGING'","'INDEPENDENT'","'SECURE'","'TRANSFERABLE'",
  "'FRAGILE'","'BLOCKED'","'REGRESSED'",
  'projectEffectiveCertainty','learningAnalysisProjection','synthesizeMisconceptions','pathToSuccess',
])assert(state.includes(token),'D13 state engine missing '+token);
assert(!/mastery_probability|mastery_percentage|Math\.exp\(|bayes/i.test(state),'D13 state engine must not invent probabilistic mastery arithmetic.');

const contracts=read('teaching/d13/contracts.js');
for(const token of ['validateNormalizedEvidence','normalizeD12EvaluationBundle','validateTPF09Output','official_mark','progression_outcome','mastery_probability','mastery_state','knowledge_state','gradebook_percentage','known_system_or_network_interruption','TEACHING_D13_BLOCK_OWNER_INVALID'])
  assert(contracts.includes(token),'D13 authority/evidence contract missing '+token);

const intelligence=read('teaching/d13/intelligence.js');
for(const token of [
  'teaching.evidence.evidence_event_interpretation','teaching.evidence.evidence_quality_weighting_proposal',
  'teaching.evidence.misconception_record_synthesis','teaching.evidence.confidence_calibration_interpretation',
  'teaching.evidence.path_to_success_memory_extraction','teaching.evidence.retention_check_scheduling_recommendation',
  'teaching.evidence.transfer_evidence_interpretation','teaching.evidence.pre_class_skm_synthesis_for_planning',
  'teaching.evidence.learning_evidence_contradiction_detection','commit:false',
])assert(intelligence.includes(token),'D13 TPF-09 wiring missing '+token);
assert(!/@google\/generative-ai|\bopenai\b|\banthropic\b|gemini-[0-9]/i.test(intelligence),'D13 may not select a provider/model directly.');

const service=read('teaching/d13/service.js');
for(const token of [
  'handleResponseSubmittedEvent','ingestOwnerValidatedEvidence','recomputeAndCommit',
  'TEACHING_D13_GRADEBOOK_DIRECT_STATE_FORBIDDEN','TEACHING_D13_PROGRESSION_DIRECT_STATE_FORBIDDEN',
  'UNQUALIFIED_UNTIL_D30','TEACHING_D13_STALE_TPF09_RESULT','rawModelProbabilitiesIncluded:false','rawEvidenceWeightsIncluded:false',
])assert(service.includes(token),'D13 service missing '+token);

const repoSource=read('teaching/repositories/d13-student-knowledge.js');
for(const token of [
  'teaching_evidence_events','teaching_student_knowledge_state_versions','teaching_skm_evidence_applications',
  'teaching_persistent_misconception_versions','source_evidence_digest','for update','TEACHING_D13_STALE_KNOWLEDGE_SNAPSHOT',
])assert(repoSource.includes(token),'D13 repository missing '+token);
assert(!/insert into\s+public\.teaching_(?:gradebook|progression)|update\s+public\.teaching_(?:gradebook|progression)/i.test(repoSource),'D13 repository must not mutate Gradebook or Progression.');

const migration=read('migrations/20260929_teaching_d13_student_knowledge_model.sql');
for(const token of [
  'source_interpretation_ref','demand_vector','answer_or_method_exposed','evidential_strength','information_gain','redundancy',
  'teaching_student_knowledge_state_versions','teaching_skm_evidence_applications','teaching_persistent_misconception_versions',
  'ENABLE ROW LEVEL SECURITY','teaching_reject_immutable_row_mutation','EVIDENCE_QUALITY_STATE_MACHINE_V1',
])assert(migration.includes(token),'D13 migration missing '+token);
assert(!/GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,160}TO\s+(?:anon|authenticated)/i.test(migration),'D13 migration exposes browser-authoritative DML.');

const d11=read('teaching/repositories/d11-lesson-controller.js');
for(const token of ['AUTHORITATIVE_D13','SKM_STATE','Student Knowledge Model','raw_weights_included: false'])
  assert(d11.includes(token),'D11 planner D13 seam missing '+token);

const backend=read('teaching-backend.js');
for(const token of ['assertD13Ready','/learning-analysis','/learning-units/:id/learning-analysis'])
  assert(backend.includes(token),'D13 read-only backend surface missing '+token);
for(const method of ['post','put','patch','delete']) {
  assert(!backend.includes("router."+method+"('/learning-analysis"),'D13 must not expose browser Learning Analysis mutation endpoints.');
  assert(!backend.includes("router."+method+"('/learning-units/:id/learning-analysis"),'D13 must not expose browser Learning Unit knowledge mutation endpoints.');
}

const production=read('index.js');
assert(production.includes('d13Intelligence: null'),'Production must preserve D30 hold for D13 model routes.');
assert(production.includes('d13PublishedEventRegistry: teachingPublishedEvents'),'D13 durable subscriber must be registered.');

const unit=read('tests/teaching/unit/d13-skm.test.js');
for(const phrase of ['many weak repetitive successes','failed delayed retrieval','out-of-order evidence replay','high-confidence wrong','low-confidence correct','TPF-09 T2 output','D12 BLOCKED proposal','known KIWI/network interruption'])
  assert(unit.includes(phrase),'D13 longitudinal/authority test coverage missing '+phrase);

const pkg=JSON.parse(read('package.json'));
assert(pkg.scripts?.['verify:teaching:d13']==='node scripts/verify-teaching-d13-skm.js','D13 package verifier script mismatch.');

console.log('[Teaching D13 verify] PASS — 25 tasks accounted for; append-only SKM/misconception history, normalized Evidence Events, deterministic EVIDENCE_QUALITY_STATE_MACHINE_V1, D11 bounded read integration, and T2/Gradebook/Progression authority guards are present.');
