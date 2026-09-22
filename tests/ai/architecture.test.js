'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registryPath = path.join(__dirname, '..', '..', 'services', 'ai', 'task-registry.js');
const registrySource = fs.readFileSync(registryPath, 'utf8');

test('task registry stays provider-agnostic', () => {
  assert.doesNotMatch(registrySource, /gemini-[0-9]/i);
  assert.doesNotMatch(registrySource, /GEMINI_API_KEY/);
  assert.doesNotMatch(registrySource, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(registrySource, /thinkingConfig/);
});

test('task registry contains only abstract model policies and reasoning requirements', () => {
  assert.match(registrySource, /TOP_STABLE_FLASH/);
  assert.match(registrySource, /VIP_STABLE_FLASH/);
  assert.match(registrySource, /TOP_STABLE_FLASH_LITE/);
  assert.match(registrySource, /REASONING_LEVELS/);
  assert.match(registrySource, /QUALITY_FLOORS/);
});
