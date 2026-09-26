'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(`[Teaching D05 verify] FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}
function assert(condition, message) { if (!condition) fail(message); }
function read(rel) { return fs.readFileSync(path.join(process.cwd(), rel), 'utf8'); }

const expectedTasks = [
  'TCH-0759',
  ...Array.from({ length: 10 }, (_, i) => `TCH-${String(767 + i).padStart(4, '0')}`),
  ...Array.from({ length: 9 }, (_, i) => `TCH-${String(778 + i).padStart(4, '0')}`),
  'TCH-0791','TCH-0798','TCH-0817',
  ...Array.from({ length: 7 }, (_, i) => `TCH-${String(879 + i).padStart(4, '0')}`),
];
assert(expectedTasks.length === 30, 'D05 task census must be exactly 30.');

const doc = read('docs/teaching/d05-orchestrator-runtime.md');
for (const id of ['TCH-0759','TCH-0767','TCH-0776','TCH-0778','TCH-0786','TCH-0791','TCH-0798','TCH-0817','TCH-0879','TCH-0885']) {
  assert(doc.includes(id), `D05 architecture doc must account for ${id}.`);
}

const sourceResolution = read('docs/teaching/change-control/KIWI_Teaching_D05_Authority_Source_Resolution_v1.0.md');
assert(sourceResolution.includes('v1.2_PPL'), 'D05 must record the user-authorized v1.2_PPL authority source.');
assert(sourceResolution.includes('3d0bf8503df58c2126692119353d5c6eb29d157b8891de18ffaade1dd1f3e0ec'), 'D05 authority source hash must be pinned.');

const registry = require('../teaching/capability-registry');
const promptControl = require('../teaching/prompt-runtime').createTeachingPromptControlPlane();
const { TEACHING_EVENTS } = require('../teaching/events/names');
const preparation = require('../teaching/preparation/t0-handlers');
const runtime = require('../teaching/runtime');
const orchestrator = require('../teaching/orchestrator');

const census = registry.assertRegistryIntegrity();
assert(census.total === 169 && census.modelEligible === 147 && census.t0Promptless === 22 && census.promptFamilies === 19, 'Registry census drifted from 169/147/22/19.');
for (const id of Object.values(preparation.PPL_T0_CAPABILITIES)) {
  const capability = registry.getCapability(id);
  assert(capability.authority_ceiling === 'T0', `${id} must remain T0.`);
  assert(capability.prompt_family_id == null, `${id} must remain promptless.`);
}
const status = promptControl.status();
assert(status.routeQualification === 'UNQUALIFIED', 'D05 must not qualify Teaching routes.');
assert(status.productionModelExecutionAuthorized === false, 'D05 must not authorize production Teaching model execution.');

for (const key of [
  'PREPARATION_WORKSPACE_SEEDED','PREPARATION_INPUT_CHANGED','PREPARATION_REVIEW_DUE',
  'PREPARATION_FINALIZATION_DUE','PREPARATION_FINDING_RESOLVED','PROTECTED_CANDIDATE_CONTAMINATED',
  'PREPARATION_WORKSPACE_SUPERSEDED','PREPARATION_WORKSPACE_CANCELLED','PREPARATION_HANDOFF_READY',
]) assert(Boolean(TEACHING_EVENTS[key]), `Missing D05 PPL event: ${key}`);

for (const fn of [
  orchestrator.createTeachingOrchestrator,
  orchestrator.createTeachingAIAdapter,
  orchestrator.createCapabilityContextAssembler,
  orchestrator.createOrchestratorPreflight,
  orchestrator.createAuthoritativeOwnerRouter,
  runtime.createTeachingD05RuntimePlatform,
  runtime.createTransactionalTeachingMutation,
]) assert(typeof fn === 'function', 'D05 runtime/orchestrator export is missing.');

const migration = read('migrations/20260926_teaching_d05_orchestrator_runtime.sql');
const servicePolicyMigration = read('migrations/20260926_teaching_d05_orchestration_service_rls.sql');
for (const fragment of [
  'teaching_runtime.orchestration_executions',
  'teaching_runtime.event_outbox',
  'ENABLE ROW LEVEL SECURITY',
  'REVOKE DELETE,TRUNCATE',
  'teaching_domain_service',
]) assert(migration.includes(fragment), `D05 migration missing: ${fragment}`);
for (const fragment of [
  'teaching_orchestration_service_select',
  'teaching_orchestration_service_insert',
  'teaching_orchestration_service_update',
  'REVOKE DELETE, TRUNCATE',
]) assert(servicePolicyMigration.includes(fragment), `D05 service-role RLS hardening missing: ${fragment}`);

const d05JsFiles = [
  'teaching/orchestrator/ai-adapter.js','teaching/orchestrator/teaching-orchestrator.js',
  'teaching/preparation/t0-handlers.js','teaching/preparation/workflow.js',
];
for (const file of d05JsFiles) {
  const content = read(file);
  assert(!/(google-generativeai|@google\/generative-ai|openai|anthropic|gemini)/i.test(content), `${file} must not call/import a provider directly.`);
}

const combined = [
  read('teaching/orchestrator/contracts.js'),
  read('teaching/runtime/postgres-orchestration-store.js'),
].join('\n');
assert(!/chain_of_thought\s*[:=]/i.test(combined), 'D05 must not persist hidden chain-of-thought.');
assert(combined.includes('hidden_reasoning'), 'D05 safe-audit contract must explicitly prohibit hidden reasoning fields.');

console.log('[Teaching D05 verify] PASS — 30-task D05 orchestration/runtime/PPL control foundation is structurally present and route qualification remains held.');
