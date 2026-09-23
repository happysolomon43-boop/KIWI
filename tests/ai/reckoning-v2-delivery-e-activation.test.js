'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const backend = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'migrations', '20260923_reckoning_v2_delivery_e_activation.sql'),
  'utf8'
);

function frontendFunction(name, nextName) {
  const asyncMarker = `      async function ${name}`;
  const syncMarker = `      function ${name}`;
  const asyncIndex = frontend.indexOf(asyncMarker);
  const syncIndex = frontend.indexOf(syncMarker);
  const start = Math.max(asyncIndex, syncIndex);
  assert.ok(start >= 0, `missing frontend function ${name}`);
  const end = frontend.indexOf(nextName, start + 20);
  assert.ok(end > start, `missing frontend boundary after ${name}`);
  return frontend.slice(start, end);
}

test('Delivery E migration is additive and persists checkpoint/final-report state', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS checkpoint_pending boolean NOT NULL DEFAULT false/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS checkpoint_next_question_id text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS final_report jsonb/);
  assert.match(migration, /reckoning_sessions_checkpoint_consistency_ck/);
  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
  assert.doesNotMatch(migration, /DROP\s+COLUMN/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
});

test('V2 has a dedicated start job while the legacy generator explicitly rejects V2 sessions', () => {
  assert.match(backend, /brainRouter\.post\('\/reckoning\/start'/);
  assert.match(backend, /RECKONING_LEGACY_RESUME/);
  assert.match(backend, /RECKONING_V2_USE_START/);
  assert.match(backend, /type:\s*'reckoning_v2_start'/);

  const routeStart = backend.indexOf("brainRouter.post('/reckoning/start'");
  const routeEnd = backend.indexOf('async function submitReckoningHandler', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = backend.slice(routeStart, routeEnd);

  assert.match(route, /adaptiveReckoningEngine\.start/);
  assert.match(route, /active\.generation_status === 'pending'/);
  assert.match(route, /DELIVERY_E_RECKONING_CONFIG\.preparation\.claimStaleMinutes/);
  assert.match(route, /Reclaiming stale Reckoning V2 preparation/);
});

test('preparation attempts heartbeat and reset per-attempt state before rebuilding evidence', () => {
  const store = fs.readFileSync(
    path.join(root, 'services', 'reckoning', 'store.js'),
    'utf8'
  );
  const engine = fs.readFileSync(
    path.join(root, 'services', 'reckoning', 'engine.js'),
    'utf8'
  );
  const config = fs.readFileSync(
    path.join(root, 'services', 'reckoning', 'config.js'),
    'utf8'
  );

  assert.match(config, /heartbeatSeconds:\s*45/);
  assert.match(store, /async function touchPreparation/);
  assert.match(store, /questions_used = 0/);
  assert.match(store, /current_block = 0/);
  assert.match(store, /checkpoint_pending = false/);
  assert.match(store, /final_report = NULL/);
  assert.match(engine, /store\.touchPreparation/);
  assert.match(engine, /clearIntervalImpl\(preparationHeartbeat\)/);
});

test('frontend Begin branches into V2 before the untouched legacy generator', () => {
  const handlerStart = frontend.indexOf(
    'document.getElementById("startReckoningBtn").addEventListener'
  );
  const handlerEnd = frontend.indexOf(
    'const deferBtn = document.getElementById("deferReckoningBtn")',
    handlerStart
  );
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handler = frontend.slice(handlerStart, handlerEnd);

  const adaptive = handler.indexOf('if (isAdaptiveV2)');
  const adaptiveStart = handler.indexOf('api.startAdaptiveReckoning()');
  const legacyGenerate = handler.indexOf('api.generateExam(');
  assert.ok(adaptive >= 0);
  assert.ok(adaptiveStart > adaptive);
  assert.ok(legacyGenerate > adaptiveStart);

  assert.match(frontend, /api\.getAdaptiveReckoningState/);
  assert.match(frontend, /api\.answerAdaptiveReckoning/);
  assert.match(frontend, /api\.continueAdaptiveReckoning/);
  assert.match(frontend, /api\.finalizeAdaptiveReckoning/);
  assert.match(frontend, /reckoning_v2_start/);
});

test('adaptive question UX is one-way, elapsed-time based, auditable and preserves Brain/Settings access', () => {
  const question = frontendFunction(
    '_renderAdaptiveReckoningQuestion',
    '      function _renderAdaptiveReckoningCheckpoint'
  );

  assert.match(question, /Elapsed review/);
  assert.match(question, /Submit answer/);
  assert.match(question, /Flag for AI review/);
  assert.match(question, /api\.answerAdaptiveReckoning/);
  assert.match(question, /api\.flagExamQuestion/);
  assert.match(question, /_adaptiveUtilityButtonsHtml/);
  assert.doesNotMatch(question, />Previous</i);
  assert.doesNotMatch(question, /Submit Exam/i);
  assert.doesNotMatch(question, /countdown|timeLimit/i);
});

test('checkpoint UX is persisted, corrective and cannot bypass the server continue endpoint', () => {
  const checkpoint = frontendFunction(
    '_renderAdaptiveReckoningCheckpoint',
    '      function _renderAdaptiveReckoningFinal'
  );

  assert.match(checkpoint, /What KIWI sees so far/);
  assert.match(checkpoint, /Corrective review/);
  assert.match(checkpoint, /api\.continueAdaptiveReckoning/);
  assert.match(checkpoint, /_adaptiveUtilityButtonsHtml/);
  assert.match(checkpoint, /The checkpoint does not unlock KIWI/);
});

test('refresh reconstructs adaptive state from the backend rather than legacy tempExam state', () => {
  const restore = frontendFunction(
    '_restoreActiveReckoningExam',
    '      function computeLiveSessionQuality'
  );
  assert.match(restore, /apiRequest\("\/brain\/reckoning\/active"\)/);
  assert.match(restore, /active\.generation_status === "pending"/);
  assert.match(restore, /_pollAdaptiveReckoningReadiness/);
  assert.match(restore, /api\.getAdaptiveReckoningState/);
  assert.match(restore, /_openAdaptiveReckoningState/);

  const open = frontendFunction(
    '_openAdaptiveReckoningState',
    '      function _renderAdaptiveReckoningQuestion'
  );
  assert.match(open, /AppState\.reckoning = \{/);
  assert.match(open, /exam_session_id:\s*state\.examSessionId/);
  assert.match(open, /engine_version:\s*2/);
});

test('final report distinguishes normal failure from sixth-failure failsafe release', () => {
  const final = frontendFunction(
    '_renderAdaptiveReckoningFinal',
    '      function showReckoningOverlay'
  );

  assert.match(final, /failsafeReleased/);
  assert.match(final, /failsafe_released/);
  assert.match(final, /lockReleased/);
  assert.match(final, /Failsafe release applied/);
  assert.match(final, /Retry The Reckoning/);
  assert.match(final, /Recovered concepts/);
  assert.match(final, /Still unresolved/);
  assert.match(final, /Weaknesses discovered by control questions/);
  assert.match(final, /What KIWI changed next/);
  assert.match(final, /_setReckoningLockdownUi\(!lockReleased\)/);
});

test('preparation, active question and checkpoint surfaces retain Brain/Settings escape controls', () => {
  const preparing = frontendFunction(
    '_renderAdaptivePreparing',
    '      async function _pollAdaptiveReckoningReadiness'
  );
  const question = frontendFunction(
    '_renderAdaptiveReckoningQuestion',
    '      function _renderAdaptiveReckoningCheckpoint'
  );
  const checkpoint = frontendFunction(
    '_renderAdaptiveReckoningCheckpoint',
    '      function _renderAdaptiveReckoningFinal'
  );

  for (const block of [preparing, question, checkpoint]) {
    assert.match(block, /_adaptiveUtilityButtonsHtml/);
  }
  assert.match(frontend, /id="adaptiveOpenBrainBtn"/);
  assert.match(frontend, /id="adaptiveOpenSettingsBtn"/);
});

test('adaptive flagged-question audit invokes evidence repair for a confirmed defective item', () => {
  assert.match(backend, /const adaptiveQuestion = isAdaptiveReckoningQuestion\(question\)/);
  assert.match(backend, /auditResult\?\.bonus_awarded === true/);
  assert.match(backend, /adaptiveReckoningEngine\.adjudicateDefectiveQuestion/);
  assert.match(backend, /adaptive_state:\s*adaptiveState/);
  assert.match(frontend, /confirmed a flawed question/i);
  assert.match(frontend, /will not count against your recovery/i);
});

test('normal adaptive endpoints cannot leak into normal CBT fetch/submit/pre-mark paths', () => {
  assert.match(backend, /RECKONING_V2_USE_STATE/);
  assert.match(backend, /RECKONING_V2_USE_ADAPTIVE_ENDPOINT/);
  assert.match(backend, /Adaptive Reckoning cannot be submitted through the normal CBT endpoint/);
  assert.match(backend, /Adaptive Reckoning answers must use the dedicated V2 answer endpoint/);
});

test('the main inline frontend script parses after Delivery E wiring', () => {
  const inlineScripts = [
    ...frontend.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
  ].map((match) => match[1]);

  const mainScript = inlineScripts.find(
    (script) =>
      script.includes('api.startAdaptiveReckoning') &&
      script.includes('_renderAdaptiveReckoningQuestion')
  );
  assert.ok(mainScript, 'could not locate KIWI main inline script');
  assert.doesNotThrow(() =>
    new vm.Script(mainScript, { filename: 'index.html:inline-main.js' })
  );
});