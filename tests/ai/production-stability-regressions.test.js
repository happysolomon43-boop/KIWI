'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('inline production cache adapter persists ritual feature fields inside JSONB data', () => {
  const start = source.indexOf('dailyRitualCache: {');
  const end = source.indexOf('// ── seedling_transactions', start);
  const block = source.slice(start, end);
  assert.match(block, /INSERT INTO daily_ritual_cache[\s\S]*\bdata\b/i);
  assert.match(block, /\$5::jsonb/);
  assert.match(block, /JSON\.stringify\(data === undefined \? null : data\)/);
  assert.doesNotMatch(block, /\.\.\.data/);
});

test('refresh tokens are unique per issuance and duplicate storage is idempotent', () => {
  const start = source.indexOf('function generateRefreshToken');
  const end = source.indexOf('// Perf-1 FIX', start);
  assert.match(source.slice(start, end), /jwtid:\s*randomUUID\(\)/);
  assert.match(source, /ON CONFLICT \(token_hash\) DO UPDATE SET/);
});

test('new Reckonings start durable preparation automatically and return valid counts', () => {
  const start = source.indexOf('async function triggerReckoning');
  const end = source.indexOf('async function deferReckoning', start);
  const block = source.slice(start, end);
  assert.match(block, /_scheduleReckoningPreparation\(reckoning\.id, userId\)/);
  assert.match(block, /question_count:\s*questionCount/);
  assert.doesNotMatch(block, /\nquestion_count,\n/);
});

test('existing V2 Reckonings resume background preparation after deferral expiry or reload', () => {
  const start = source.indexOf('async function reconcileActiveReckoning');
  const end = source.indexOf('async function generateReckoningDebrief', start);
  const block = source.slice(start, end);
  assert.match(block, /active\.status === 'deferred'[\s\S]*?_scheduleReckoningPreparation\(active\.id, userId\)/);
  assert.match(block, /active\.status === 'triggered'[\s\S]*?_scheduleReckoningPreparation\(active\.id, userId\)/);
});

test('preparing Reckoning cannot be started twice and its overlay does not blink', () => {
  assert.match(frontend, /const isPreparing = isAdaptiveV2/);
  assert.match(frontend, /if \(isPreparing\) return;/);
  assert.match(frontend, /reckoning\.generation_status = "pending";[\s\S]*?_renderAdaptivePreparing\(reckoning\);[\s\S]*?api\.startAdaptiveReckoning\(\)/);
  assert.doesNotMatch(frontend, /animation:\s*fadeIn 0\.5s ease/);
  assert.doesNotMatch(frontend, /animation:\s*scaleIn 0\.5s var\(--ease-spring\)/);
});
