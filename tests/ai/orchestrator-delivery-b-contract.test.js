'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

test('Delivery B migration persists provider health and admission metadata behind RLS', () => {
  const source = fs.readFileSync(
    path.join(root, 'migrations', '20260923_ai_orchestrator_resilience_delivery_b.sql'),
    'utf8'
  );

  assert.match(source, /CREATE TABLE IF NOT EXISTS ai_provider_model_health/i);
  assert.match(source, /state IN \('CLOSED','OPEN','HALF_OPEN'\)/i);
  assert.match(source, /ADD COLUMN IF NOT EXISTS queue_wait_ms/i);
  assert.match(source, /ADD COLUMN IF NOT EXISTS admission_limit/i);
  assert.match(source, /ADD COLUMN IF NOT EXISTS congestion_level/i);
  assert.match(source, /ai_provider_model_health ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /REVOKE ALL ON TABLE ai_provider_model_health FROM anon, authenticated/i);

  // Comments may explicitly document that sensitive payloads are excluded.
  // Inspect executable SQL only so the contract verifies columns/schema rather
  // than accidentally failing on that explanatory text.
  const executableSql = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(executableSql, /\b(prompt|response_text|api_key)\b/i);
});

test('Delivery B runtime exposes traffic, provider health, sync and durable operations status', () => {
  const runtime = fs.readFileSync(
    path.join(root, 'services', 'ai', 'runtime.js'),
    'utf8'
  );
  const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

  assert.match(runtime, /createAITrafficController/);
  assert.match(runtime, /runHealthSyncCycle/);
  assert.match(runtime, /operationalReport/);
  assert.match(runtime, /recentOperationalSummary/);
  assert.match(index, /adminRouter\.get\('\/ai\/status'/);
  assert.match(index, /ai_traffic_control/);
  assert.match(index, /ai_provider_health/);
  assert.match(index, /ai_health_sync/);
});

test('Delivery B keeps model discovery and qualification behind IP traffic admission', () => {
  const qualifier = fs.readFileSync(
    path.join(root, 'services', 'ai', 'model-qualifier.js'),
    'utf8'
  );
  const discovery = fs.readFileSync(
    path.join(root, 'services', 'ai', 'model-discovery.js'),
    'utf8'
  );

  assert.match(qualifier, /taskId: 'MODEL_QUALIFICATION'/);
  assert.match(qualifier, /taskClass: AI_CLASSES\.IP/);
  assert.match(discovery, /taskId: 'MODEL_DISCOVERY'/);
  assert.match(discovery, /taskClass: AI_CLASSES\.IP/);
});
