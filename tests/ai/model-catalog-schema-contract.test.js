'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_MODEL_CATALOG } = require('../../services/ai/model-catalog');
const { AI_CAPABILITIES } = require('../../services/ai/capabilities');

const root = path.resolve(__dirname, '../..');

test('provider-neutral capability models intentionally do not require an inference family', () => {
  const capabilityOnly = DEFAULT_MODEL_CATALOG.filter((model) =>
    model.capabilities.some((capability) => [
      AI_CAPABILITIES.SPEECH_SYNTHESIS,
      AI_CAPABILITIES.IMAGE_GENERATION,
      AI_CAPABILITIES.DIAGRAM_RENDER,
    ].includes(capability))
  );
  assert.ok(capabilityOnly.length >= 3);
  for (const model of capabilityOnly) {
    assert.equal(model.family, null, `${model.routeKey} must remain family-neutral`);
    assert.equal(typeof model.provider, 'string');
    assert.equal(typeof model.routeKey, 'string');
  }
});

test('startup schema convergence makes ai_model_catalog.family nullable before AI initialization', () => {
  const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const ddl = 'ALTER TABLE IF EXISTS ai_model_catalog ALTER COLUMN family DROP NOT NULL';
  const ddlAt = source.indexOf(ddl);
  const schemaRunAt = source.indexOf('await runSchemaMigrations();');
  const aiInitAt = source.indexOf('await _aiRuntime.initialize();');
  assert.ok(ddlAt >= 0, 'startup migration must contain the catalog family convergence DDL');
  assert.ok(schemaRunAt >= 0 && aiInitAt >= 0);
  assert.ok(schemaRunAt < aiInitAt, 'schema migrations must finish before AI runtime initialization');
});

test('canonical SQL migration preserves data while relaxing only the family nullability constraint', () => {
  const sql = fs.readFileSync(
    path.join(root, 'migrations/20261001_ai_model_catalog_provider_neutral_capabilities.sql'),
    'utf8'
  );
  assert.match(sql, /ALTER TABLE IF EXISTS ai_model_catalog[\s\S]*ALTER COLUMN family DROP NOT NULL/i);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});
