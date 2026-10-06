'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('database transactions retry PostgreSQL deadlock and serialization aborts', () => {
  const source = read('index.js');
  assert.match(source, /async function withTransaction\(fn, \{ maxAttempts = 3 \} = \{\}\)/);
  assert.match(source, /e\?\.code === '40P01' \|\| e\?\.code === '40001'/);
  assert.match(source, /ROLLBACK'\)\.catch\(\(\) => null\)/);
  assert.match(source, /client\.release\(\)/);
});

test('an approved Request whose first application aborted remains recoverable in the UI', () => {
  const source = read('public/teaching-d10.js');
  assert.match(source, /\['APPROVED','APPROVED_WITH_ADJUSTMENT'\]\.includes\(item\.state\)/);
  assert.match(source, /Apply approved change/);
  assert.match(source, /requests\/'\+encodeURIComponent\(item\.requestId\)\+'\/apply/);
});

test('Teaching uses the normal KIWI Syne and DM Sans type roles', () => {
  const html = read('public/teaching.html');
  const interaction = read('public/teaching-interaction-system.js');
  assert.match(html, /--font-display: "Syne", sans-serif/);
  assert.match(html, /--font-body: "DM Sans", sans-serif/);
  assert.match(interaction, /var\(--font-display,"Syne"\)/);
  assert.match(interaction, /var\(--font-body,"DM Sans"\)/);
});
