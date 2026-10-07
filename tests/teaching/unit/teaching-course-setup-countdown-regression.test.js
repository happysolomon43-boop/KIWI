'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../../public/teaching-d08.js'),
  'utf8'
);

test('Teaching D08 Course Setup countdown asset remains valid browser JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'teaching-d08.js' }));
});

test('Course Setup material analysis uses an immediate five-minute countdown in the second setup row', () => {
  assert.match(source, /const ANALYSIS_COUNTDOWN_MS = 5 \* 60 \* 1000;/);
  assert.match(source, /row\.dataset\.setupStep = key/);
  assert.match(source, /\{ key: 'material-analysis' \}/);
  assert.match(source, /\[data-setup-step="material-analysis"\]/);
  assert.match(source, /role', 'timer'/);
  assert.match(source, /5 min/);
  assert.match(source, /formatAnalysisCountdown\(remainingMs\)/);

  const clickCountdown = source.indexOf(
    'startAnalysisCountdown({ deadline: Date.now() + ANALYSIS_COUNTDOWN_MS });'
  );
  const auditRequest = source.indexOf(
    'await kiwiApiRequest(\`/teaching/courses/\${encodeURIComponent(course.course_id)}/curriculum-audit\`',
    clickCountdown
  );

  assert.ok(clickCountdown >= 0, 'countdown must start in the analysis button click handler');
  assert.ok(auditRequest > clickCountdown, 'countdown must start before the audit request is awaited');
});

test('Course Setup countdown follows the authoritative background job and disappears at terminal state', () => {
  assert.match(source, /setup\.backgroundAnalysis\?\.created_at/);
  assert.match(source, /backgroundCreatedAt \+ ANALYSIS_COUNTDOWN_MS/);
  assert.match(source, /backgroundEventId/);
  assert.match(source, /startAnalysisCountdown\(\{ deadline: countdownDeadline, eventId: backgroundEventId \}\)/);
  assert.match(source, /if \(backgroundAudit\.active\) \{[\s\S]*?\} else \{\s*stopAnalysisCountdown\(\);\s*\}/);
  assert.match(source, /body\.querySelector\('\[data-analysis-countdown\]'\)\?\.remove\(\)/);
  assert.match(source, /window\.setInterval\([\s\S]*?, 1000\)/);
});
