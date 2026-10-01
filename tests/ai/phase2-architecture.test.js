'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const aiDir = path.join(__dirname, '..', '..', 'services', 'ai');
function read(file) { return fs.readFileSync(path.join(aiDir, file), 'utf8'); }

test('active provider model IDs are centralized in model-catalog while model-history is audit-only', () => {
  const allowed = new Set(['model-catalog.js', 'model-history.js']);
  for (const file of fs.readdirSync(aiDir).filter((name) => name.endsWith('.js'))) {
    if (allowed.has(file)) continue;
    assert.doesNotMatch(read(file), /gemini-\d+(?:\.\d+)?-[a-z0-9-]+/i, `${file} must not hard-code a Gemini model ID`);
  }
  assert.match(read('model-history.js'), /not consumed by production routing/i);
});

test('Google provider HTTP endpoint exists only in google-http-transport.js', () => {
  for (const file of fs.readdirSync(aiDir).filter((name) => name.endsWith('.js'))) {
    const source = read(file);
    if (file === 'google-http-transport.js') assert.match(source, /generativelanguage\.googleapis\.com/);
    else assert.doesNotMatch(source, /generativelanguage\.googleapis\.com/, `${file} must not bypass the raw Google HTTP transport`);
  }
});

test('provider credential environment discovery exists only in credential-registry.js', () => {
  for (const file of fs.readdirSync(aiDir).filter((name) => name.endsWith('.js'))) {
    const source = read(file);
    const contains = /GEMINI_API_KEY|GROQ_API_KEY|CLOUDFLARE_WORKERS_AI_API_TOKEN/.test(source);
    if (!contains) continue;
    assert.equal(file, 'credential-registry.js', `${file} must not discover provider credentials directly`);
  }
});
