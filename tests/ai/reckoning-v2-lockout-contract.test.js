'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');

function lockoutSection() {
  const start = source.indexOf('async function reckoningLockout');
  assert.notEqual(start, -1, 'missing reckoningLockout middleware');
  const marker = '// ════════════════════════════════════════════════════════════════════════════\n//  AUTH ROUTES';
  const end = source.indexOf(marker, start);
  assert.notEqual(end, -1, 'missing end of reckoningLockout middleware');
  return source.slice(start, end);
}

test('Brain and Settings recovery surfaces are exempted before lock-state lookup', () => {
  const block = lockoutSection();

  const brainGate = block.indexOf('if (brainSurfaceAllowed || settingsAllowed) return next()');
  const tryIndex = block.indexOf('try {');
  const lookup = block.indexOf('findActiveByUser(req.user.id)');

  assert.ok(brainGate >= 0, 'missing Brain/Settings recovery gate');
  assert.ok(tryIndex > brainGate, 'recovery gate must occur before protected lock-state work');
  assert.ok(lookup > brainGate, 'recovery gate must occur before Reckoning DB lookup');

  assert.match(block, /baseUrl\.endsWith\(['"]\/brain['"]\)/);
  assert.match(block, /pathName === ['"]\/settings['"]/);
  assert.match(block, /pathName === ['"]\/settings\/export['"]/);
  assert.match(block, /pathName === ['"]\/settings\/notifications['"]/);
});

test('server-side deferral is the only normal-use bypass after recovery surfaces', () => {
  const block = lockoutSection();

  assert.match(block, /active\.deferred_until/);
  assert.match(block, /new Date\(active\.deferred_until\)\.getTime\(\)/);
  assert.match(block, /if \(expiryMs > Date\.now\(\)\) return next\(\)/);
});

test('mandatory generation exemption cannot become a normal CBT generation exemption', () => {
  const block = lockoutSection();

  assert.match(block, /method === ['"]POST['"]/);
  assert.match(block, /pathName === ['"]\/generate['"] \|\| pathName === ['"]\/['"]/);
  assert.match(block, /req\.body\?\.is_reckoning \|\| req\.body\?\.reckoning_id/);
});

test('only the exact linked Reckoning exam can bypass global lockout', () => {
  const block = lockoutSection();

  assert.match(block, /active\.exam_session_id/);
  assert.match(block, /const firstSegment = pathName\.split\(['"]\/['"]\)\.filter\(Boolean\)\[0\] \|\| ['"]['"]/);
  assert.match(block, /String\(firstSegment\) === String\(active\.exam_session_id\)/);

  const exactGate = block.indexOf('String(firstSegment) === String(active.exam_session_id)');
  const locked = block.indexOf('res.status(423)');
  assert.ok(exactGate >= 0);
  assert.ok(locked > exactGate, 'all non-linked exam requests must fall through to 423');
});

test('lock verification failure fails closed while preserving recovery guidance', () => {
  const block = lockoutSection();

  const catchIndex = block.indexOf('catch (e)');
  const unavailable = block.indexOf('res.status(503)');
  assert.ok(catchIndex >= 0);
  assert.ok(unavailable > catchIndex);

  const catchBlock = block.slice(catchIndex);
  assert.doesNotMatch(catchBlock, /return next\(\)/);
  assert.match(catchBlock, /RECKONING_STATE_UNAVAILABLE/);
  assert.match(catchBlock, /Brain and Settings remain available/);
});

test('locked response advertises the approved recovery surfaces and failsafe state', () => {
  const block = lockoutSection();

  assert.match(block, /RECKONING_GLOBAL_LOCKED/);
  assert.match(block, /settings_available:\s*true/);
  assert.match(block, /brain_available:\s*true/);
  assert.match(block, /failure_count:\s*Number\(active\.failure_count\) \|\| 0/);
  assert.match(block, /failsafe_threshold:\s*RECKONING_FAILSAFE_FAILURES/);
});
