'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const d28 = require('../teaching/d28');

assert.equal(d28.D28_TASK_IDS.length, 39);
assert.equal(new Set(d28.D28_TASK_IDS).size, 39);
for (const id of ['TCH-0599','TCH-0628','TCH-0678','TCH-0777','TCH-0867','TCH-0870','TCH-0899','TCH-0900','TCH-0916']) {
  assert(d28.D28_TASK_IDS.includes(id), `Missing ${id}`);
}

const migration = read('migrations/20261004_teaching_d28_operational_hardening.sql');
for (const token of [
  'd28_operational_events',
  'd28_operational_alerts',
  'd28_item_analytics_runs',
  'd28_item_analytics_items',
  'd28_item_analytics_review_flags',
  'd28_ppl_budget_usage',
  'd28_artifact_visibility_controls',
  'd28_retention_actions',
  'd28_ai_response_cache',
  'REVOKE ALL ON ALL TABLES IN SCHEMA teaching_runtime FROM PUBLIC,anon,authenticated',
  'academic_action_taken boolean NOT NULL DEFAULT false CHECK(academic_action_taken=false)',
  'preserved_academic_lineage boolean NOT NULL DEFAULT true CHECK(preserved_academic_lineage=true)',
]) assert(migration.includes(token), `Migration missing ${token}`);

const boundary = read('teaching/ai/central-orchestrator-boundary.js');
assert(boundary.includes("require('../d28/ai-controls')"));
const runtime = read('teaching/runtime/index.js');
assert(runtime.includes("require('../d28/ai-controls')"));
assert(runtime.includes('executionControls: aiExecutionControls'));
const telemetry = read('teaching/observability/postgres-execution-telemetry.js');
for (const token of ['provider_identifier','fallback_depth','validation_retry_count','cache_status','redactOperationalMetadata']) {
  assert(telemetry.includes(token));
}
const service = read('teaching/d28/service.js');
for (const token of ['reportAssessmentValidationFailure','reportMarkingDisagreement','recordQualitySample']) {
  assert(service.includes(token));
}
for (const file of fs.readdirSync(path.join(root, 'teaching/d28')).filter((file) => file.endsWith('.js'))) {
  assert(!/require\(['\"](?:openai|@google|groq|anthropic)/.test(read(`teaching/d28/${file}`)), `${file} imports provider SDK`);
}
console.log('D28 verification passed: 39/39 tasks structurally accounted; runtime controls wired; owner boundaries intact.');
