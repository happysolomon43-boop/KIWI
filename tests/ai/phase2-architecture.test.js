'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const aiDir = path.join(__dirname, '..', '..', 'services', 'ai');

function read(file) {
  return fs.readFileSync(path.join(aiDir, file), 'utf8');
}

test('provider model IDs are centralized in model-catalog.js', () => {
  const allowed = new Set(['model-catalog.js']);
  for (const file of fs.readdirSync(aiDir).filter((name) => name.endsWith('.js'))) {
    if (allowed.has(file)) continue;
    assert.doesNotMatch(
      read(file),
      /gemini-\d+(?:\.\d+)?-[a-z0-9-]+/i,
      `${file} must not hard-code a Gemini model ID`
    );
  }
});

test('Gemini HTTP endpoint exists only in gemini-transport.js', () => {
  for (const file of fs.readdirSync(aiDir).filter((name) => name.endsWith('.js'))) {
    const source = read(file);
    if (file === 'gemini-transport.js') {
      assert.match(source, /generativelanguage\.googleapis\.com/);
    } else {
      assert.doesNotMatch(source, /generativelanguage\.googleapis\.com/);
    }
  }
});

test('Gemini environment-key discovery exists only in project-pool.js', () => {
  for (const file of fs.readdirSync(aiDir).filter((name) => name.endsWith('.js'))) {
    const source = read(file);
    if (file === 'project-pool.js') {
      assert.match(source, /GEMINI_API_KEY/);
    } else {
      assert.doesNotMatch(source, /process\.env\.GEMINI_API_KEY/);
    }
  }
});
