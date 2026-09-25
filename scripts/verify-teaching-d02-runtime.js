'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function fail(message) {
  console.error('[D02] FAIL:', message);
  process.exitCode = 1;
}

function check(condition, message) {
  if (!condition) fail(message);
}

const required = [
  'teaching/runtime/constants.js',
  'teaching/runtime/time-projection.js',
  'teaching/runtime/reconciliation.js',
  'teaching/runtime/postgres-event-store.js',
  'teaching/runtime/durable-event-runtime.js',
  'teaching/runtime/index.js',
  'teaching/ai/contracts.js',
  'teaching/ai/failure-policy.js',
  'teaching/ai/output-validation.js',
  'teaching/ai/central-orchestrator-boundary.js',
  'teaching/authority/owners.js',
  'teaching/authority/deterministic-precedence.js',
  'teaching/authority/commit-gateway.js',
  'teaching/security/context-lanes.js',
  'teaching/observability/postgres-execution-telemetry.js',
  'teaching/accessibility/baseline.js',
  'migrations/20260925_teaching_d02_runtime_primitives.sql',
  'tests/teaching/unit/d02-runtime.test.js',
  'tests/teaching/integration/d02-runtime-schema.test.js',
  'docs/teaching/d02-runtime-primitives.md',
  'docs/teaching/security/d02-threat-model.md',
  'docs/teaching/accessibility/d02-baseline.md',
];

for (const file of required) {
  check(fs.existsSync(path.join(root, file)), `missing D02 artifact: ${file}`);
}

const migration = fs.readFileSync(
  path.join(root, 'migrations', '20260925_teaching_d02_runtime_primitives.sql'),
  'utf8'
);
check(/CREATE SCHEMA IF NOT EXISTS teaching_runtime/i.test(migration), 'D02 migration must use a private Teaching runtime schema');
check(/ALTER TABLE teaching_runtime\.due_events ENABLE ROW LEVEL SECURITY/i.test(migration), 'D02 due_events must enable RLS');
check(/REVOKE ALL ON ALL TABLES IN SCHEMA teaching_runtime FROM PUBLIC, anon, authenticated/i.test(migration), 'D02 migration must revoke browser-role table access');
check(!/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?background_jobs/i.test(migration), 'D02 must not repurpose public.background_jobs');
check(!/(chain[_ -]?of[_ -]?thought|reasoning_text|prompt_body|student_response)/i.test(migration), 'D02 operational telemetry must not persist hidden reasoning/prompt/student-response bodies');

const eventStore = fs.readFileSync(
  path.join(root, 'teaching', 'runtime', 'postgres-event-store.js'),
  'utf8'
);
check(!/background_jobs/i.test(eventStore), 'D02 authoritative due events must not depend on public.background_jobs');
check(/FOR UPDATE SKIP LOCKED/i.test(eventStore), 'D02 event claims must be concurrency-safe');
check(/idempotency_key/i.test(eventStore), 'D02 event persistence must enforce idempotency');

const runtime = fs.readFileSync(
  path.join(root, 'teaching', 'runtime', 'durable-event-runtime.js'),
  'utf8'
);
check(/requireReconciler/.test(runtime), 'D02 academic handlers must reconcile authoritative state before execution');
check(/FAIRNESS_RECOVERY_REQUIRED/.test(runtime), 'D02 runtime must preserve KIWI-failure fairness');
check(!/window\.|document\./.test(runtime), 'D02 durable runtime must be server-side and browser-independent');

const aiBoundary = fs.readFileSync(
  path.join(root, 'teaching', 'ai', 'central-orchestrator-boundary.js'),
  'utf8'
);
check(/aiRun/.test(aiBoundary), 'D02 Teaching AI boundary must use injected central aiRun');
check(/T0 Teaching responsibility is deterministic/.test(aiBoundary), 'D02 must prohibit T0 model execution');
check(
  !/(gemini|generative-ai|genai|openai|anthropic|vertex|bedrock)/i.test(aiBoundary),
  'D02 Teaching AI boundary must not contain provider-specific routing'
);

const validator = fs.readFileSync(
  path.join(root, 'teaching', 'ai', 'output-validation.js'),
  'utf8'
);
check(/SCHEMA_VALIDATOR_REQUIRED_FOR_T2_TO_T4/.test(validator), 'D02 must require schema validation for T2-T4');
check(/DOMAIN_VALIDATOR_REQUIRED_FOR_T2_TO_T4/.test(validator), 'D02 must require domain validation for T2-T4');
check(/deterministicChecks/.test(validator), 'D02 must apply deterministic-authority checks');

const commitGateway = fs.readFileSync(
  path.join(root, 'teaching', 'authority', 'commit-gateway.js'),
  'utf8'
);
check(/isValidatedModelResult/.test(commitGateway), 'D02 commit gateway must require trusted validated results');
check(/commitValidatedModelResult/.test(commitGateway), 'D02 commit gateway must route through authoritative owner service');

const contextLanes = fs.readFileSync(
  path.join(root, 'teaching', 'security', 'context-lanes.js'),
  'utf8'
);
check(/untrusted_data/.test(contextLanes), 'D02 must structurally mark untrusted content as data');
for (const field of ['attendance','teacherPersonality','previousGpa','behavioralHistory']) {
  check(contextLanes.includes(field), `D02 formal-marking minimization must cover ${field}`);
}

const indexJs = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
check(indexJs.includes("require('./teaching/runtime')"), 'KIWI backend must compose the D02 Teaching runtime');
check(indexJs.includes('teachingRuntimePlatform.initialize()'), 'KIWI backend must verify D02 runtime schema readiness');
check(indexJs.includes('teachingRuntimePlatform.start()'), 'KIWI backend must start the D02 due-event worker server-side');

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check(Boolean(packageJson.scripts?.['verify:teaching:d02']), 'package.json missing verify:teaching:d02');
check(Boolean(packageJson.scripts?.['test:teaching']), 'package.json missing Teaching unit tests');
check(Boolean(packageJson.scripts?.['test:teaching:integration']), 'package.json missing Teaching integration tests');

check(
  !fs.existsSync(path.join(root, 'teaching', 'capability-registry')),
  'D02 must not pull D03 Capability Registry runtime forward'
);
check(
  !fs.existsSync(path.join(root, 'teaching', 'prompt-runtime')),
  'D02 must not pull D03 prompt runtime forward'
);

if (!process.exitCode) {
  console.log('[D02] PASS: authoritative runtime/event/validation primitives are structurally complete.');
}
