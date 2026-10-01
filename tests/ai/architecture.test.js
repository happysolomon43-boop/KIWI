'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registryPath = path.join(__dirname, '..', '..', 'services', 'ai', 'task-registry.js');
const registrySource = fs.readFileSync(registryPath, 'utf8');

test('task registry stays provider and model agnostic', () => {
  assert.doesNotMatch(registrySource, /gemini-|qwen\/|GROQ|GOOGLE|CLOUDFLARE|KROKI/i);
  assert.doesNotMatch(registrySource, /API_KEY|thinkingConfig|reasoning_effort/);
});

test('task registry expresses only capability, modality, reasoning, retry and execution requirements', () => {
  for (const required of ['AI_CAPABILITIES', 'AI_INPUT_MODALITIES', 'REASONING_LEVELS', 'RETRY_POLICIES', 'AI_EXECUTION_LANES']) {
    assert.match(registrySource, new RegExp(required));
  }
  assert.doesNotMatch(registrySource, /MODEL_IDS|MODEL_FAMILIES|QUALITY_FLOORS|TOP_STABLE_FLASH/);
});
