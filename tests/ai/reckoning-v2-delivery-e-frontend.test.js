'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'index.html'),
  'utf8'
);

function functionSlice(name, nextName) {
  const start = html.indexOf('function ' + name);
  assert.ok(start >= 0, 'missing frontend function ' + name);
  const end = nextName ? html.indexOf('function ' + nextName, start + 1) : -1;
  return html.slice(start, end > start ? end : start + 40000);
}

test('every executable inline index.html script parses as JavaScript', () => {
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  let compiled = 0;

  scripts.forEach((match, index) => {
    const attrs = match[1] || '';
    const body = match[2] || '';
    if (/\bsrc\s*=/i.test(attrs)) return;

    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
    const type = typeMatch ? typeMatch[1].toLowerCase() : 'text/javascript';
    if (!['text/javascript', 'application/javascript'].includes(type)) return;
    if (!body.trim()) return;

    assert.doesNotThrow(
      () => new vm.Script(body, { filename: 'index.html:inline-script-' + (index + 1) + '.js' })
    );
    compiled += 1;
  });

  assert.ok(compiled >= 1, 'expected at least one executable inline script');
});

test('Delivery E frontend uses the dedicated adaptive lifecycle endpoints', () => {
  assert.match(html, /\/brain\/reckoning\/start/);
  assert.match(html, /\/reckoning\/state/);
  assert.match(html, /\/reckoning\/answer/);
  assert.match(html, /\/reckoning\/continue/);
  assert.match(html, /\/reckoning\/finalize/);
  assert.match(html, /api\.startAdaptiveReckoning/);
  assert.match(html, /api\.getAdaptiveReckoningState/);
  assert.match(html, /api\.answerAdaptiveReckoning/);
  assert.match(html, /api\.continueAdaptiveReckoning/);
  assert.match(html, /api\.finalizeAdaptiveReckoning/);
  assert.match(html, /reckoning_v2_start/);
});

test('adaptive question UI is one-way and does not reuse normal CBT navigation or timer', () => {
  const question = functionSlice(
    '_renderAdaptiveReckoningQuestion',
    '_renderAdaptiveReckoningCheckpoint'
  );

  assert.match(question, /adaptiveElapsedTime/);
  assert.match(question, /api\.answerAdaptiveReckoning/);
  assert.match(question, /Submit answer/);
  assert.doesNotMatch(question, /prevQBtn/);
  assert.doesNotMatch(question, /nextQBtn/);
  assert.doesNotMatch(question, /q-dots/);
  assert.doesNotMatch(question, /submitExam\s*\(/);
  assert.doesNotMatch(question, /startExamTimer\s*\(/);
});

test('adaptive checkpoint pauses sequencing and continues only through the server', () => {
  const checkpoint = functionSlice(
    '_renderAdaptiveReckoningCheckpoint',
    '_renderAdaptiveReckoningFinal'
  );

  assert.match(checkpoint, /What KIWI sees so far/);
  assert.match(checkpoint, /Corrective review/);
  assert.match(checkpoint, /api\.continueAdaptiveReckoning/);
  assert.match(checkpoint, /The checkpoint does not unlock KIWI/);
});

test('final report is diagnostic rather than a raw-score-only result', () => {
  const finalReport = functionSlice(
    '_renderAdaptiveReckoningFinal',
    'showReckoningOverlay'
  );

  for (const phrase of [
    'Recovery score',
    'Raw accuracy',
    'Critical unresolved',
    'Recovered concepts',
    'Still unresolved',
    'Weaknesses discovered by control questions',
    'What KIWI changed next',
    'Knowledge Score',
  ]) {
    assert.match(finalReport, new RegExp(phrase));
  }
});

test('refresh/resume reconstructs V2 from persisted adaptive state while legacy CBT remains intact', () => {
  const restore = functionSlice(
    '_restoreActiveReckoningExam',
    'computeLiveSessionQuality'
  );
  assert.match(restore, /api\.getAdaptiveReckoningState/);
  assert.match(restore, /_openAdaptiveReckoningState/);
  assert.match(restore, /generation_status === "pending"/);
  assert.match(restore, /_activateAndOpenGeneratedExam/);

  assert.match(html, /id="prevQBtn"/);
  assert.match(html, /id="submitExamBtn"/);
  assert.match(html, /function startExamTimer\s*\(/);
});

test('V2 Begin returns through the dedicated start path before legacy CBT generation', () => {
  const overlay = functionSlice('showReckoningOverlay');
  const v2Branch = overlay.indexOf('if (isAdaptiveV2)');
  const adaptiveStart = overlay.indexOf('api.startAdaptiveReckoning', v2Branch);
  const legacyGenerate = overlay.indexOf('api.generateExam', adaptiveStart);

  assert.ok(v2Branch >= 0);
  assert.ok(adaptiveStart > v2Branch);
  assert.ok(legacyGenerate > adaptiveStart);
  assert.match(overlay.slice(adaptiveStart, legacyGenerate), /return;/);
});


test('adaptive Reckoning routes ready state onto the exam page', () => {
  const open = functionSlice('_openAdaptiveReckoningState', '_renderAdaptiveReckoningQuestion');
  assert.match(open, /AppState\.currentPage !== "exam"/);
  assert.match(open, /_origNavigateTo\("exam"\)/);

  const exam = functionSlice('renderExam', 'renderExamResults');
  assert.match(exam, /AppState\.adaptiveReckoning/);
  assert.match(exam, /_renderAdaptiveReckoningQuestion/);
  assert.match(html, /AppState\.adaptiveReckoning && AppState\.adaptiveReckoning\.examSessionId/);
});

test('Brain Reckoning action follows preparation lifecycle and exposes the 24-hour Buffer', () => {
  const brain = functionSlice('renderBrain');
  assert.match(brain, /generation_status/);
  assert.match(brain, /Preparing Reckoning/);
  assert.match(brain, /Retry Reckoning/);
  assert.match(brain, /Return to Reckoning/);
  assert.match(brain, /24h Reckoning Buffer/);
  assert.match(brain, /brainUseReckoningBufferBtn/);
  assert.match(brain, /brainBuyReckoningBufferBtn/);
  assert.match(html, /\/brain\/reckoning\/buffer\/purchase/);
});


test('durable Reckoning preparation stays attached beyond transport timeout and reconciles server state', () => {
  const poll = functionSlice(
    '_pollAdaptiveReckoningReadiness',
    '_adaptiveUtilityButtonsHtml'
  );
  assert.match(
    poll,
    /_pollAdaptiveReckoningReadiness\(reckoningId, timeoutMs = null\)/
  );
  assert.match(poll, /while \(token === _adaptivePreparationPollToken\)/);
  assert.match(poll, /elapsed < 10 \* 60 \* 1000 \? 3000 : 10000/);
  assert.match(
    poll,
    /still preparing The Reckoning in the background/
  );
  assert.doesNotMatch(
    poll,
    /Date\.now\(\) - started < timeoutMs/
  );

  const htmlBlock = html.slice(
    html.indexOf('function _pollJobFallback'),
    html.indexOf('function _stopWaitingForJob')
  );
  assert.match(
    htmlBlock,
    /type === 'reckoning_v2_start'[\s\S]*_recoverDurableReckoningUiFromServer/
  );
  assert.doesNotMatch(
    htmlBlock,
    /reckoning_v2_start:\s*'Reckoning preparation timed out[^']*press Begin to retry/
  );

  assert.match(
    html,
    /async function _recoverDurableReckoningUiFromServer/
  );
  assert.match(
    html,
    /_jf\.type === 'reckoning_v2_start'[\s\S]*_recoverDurableReckoningUiFromServer/
  );
});
